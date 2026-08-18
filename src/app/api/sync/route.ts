import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { JobPipeline } from '../../../providers/JobPipeline';
import { prisma } from '@/lib/db';
import { isAdminRequest } from '@/lib/adminAuth';
import { getSyncCooldownMs } from '@/lib/syncSchedule';
import { pruneMarketFacts } from '@/lib/marketFacts';

const LOCK_KEY = 'sync_lock';
const LOCK_TTL_MS = 15 * 60 * 1000; // 15 minutes; release-on-finally plus TTL safety net

// Cooldown between production sync fetches is adaptive: ~20 minutes during
// real peak posting hours and ~4 hours otherwise (see lib/syncSchedule).
// GitHub Actions is the single authoritative scheduler: cron-sync.yml fires
// every 20 minutes; the cooldown decides whether a tick actually fetches from
// the sources or is skipped. force=true is reserved for the admin UI.
const SYNC_TS_KEY = 'last_sync_successful';

function timingSafeSecretEqual(a: string, b: string): boolean {
  const aHash = crypto.createHash('sha256').update(a).digest();
  const bHash = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

// Prevent overlapping sync runs (scheduled ticks and admin-triggered runs all
// share this lock). Uses SystemKv with a TTL so a crashed run cannot wedge the
// pipeline permanently.
async function acquireSyncLock(): Promise<boolean> {
  try {
    const now = Date.now();
    const existing = await prisma.systemKv.findUnique({ where: { key: LOCK_KEY } });
    if (existing) {
      try {
        const parsed = JSON.parse(existing.value) as { startedAt: number };
        if (now - parsed.startedAt < LOCK_TTL_MS) return false;
      } catch { /* treat corrupt/stale record as free */ }
    }
    await prisma.systemKv.upsert({
      where: { key: LOCK_KEY },
      update: { value: JSON.stringify({ startedAt: now }) },
      create: { key: LOCK_KEY, value: JSON.stringify({ startedAt: now }) },
    });
    return true;
  } catch {
    // If lock infrastructure fails, fail-open rather than blocking sync entirely.
    return true;
  }
}

async function releaseSyncLock(): Promise<void> {
  await prisma.systemKv.delete({ where: { key: LOCK_KEY } }).catch(() => {});
}

async function cleanupStaleSessions(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - 48 * 24 * 60 * 60 * 1000);
    const res = await prisma.userSession.deleteMany({
      where: { lastSeen: { lt: cutoff } },
    });
    return res.count;
  } catch {
    return 0;
  }
}

async function runSync(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const expectedSecret = process.env.CRON_SECRET;

    // Fail-closed: authorize only with a valid Bearer CRON_SECRET (Vercel cron /
    // GitHub Actions) or a valid admin session cookie (manual sync from the UI).
    let authorized = false;
    if (authHeader && expectedSecret) {
      const providedSecret = authHeader.replace(/^Bearer\s+/i, '').trim();
      authorized = timingSafeSecretEqual(providedSecret, expectedSecret);
    }
    if (!authorized && (await isAdminRequest())) {
      authorized = true;
    }
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    // `force=true` is only sent by the admin UI to bypass the cooldown for a
    // manual refresh. The cron never sends it.
    const force = url.searchParams.get('force') === 'true';

    if (!(await acquireSyncLock())) {
      return NextResponse.json({ error: 'Sync already in progress' }, { status: 429 });
    }

    try {
      // Lightweight housekeeping runs on every cron tick.
      const sessionsCleaned = await cleanupStaleSessions();
      void pruneMarketFacts();

      // Cooldown: avoid hammering Upwork/Freelancer. The interval adapts to
      // real posting activity (peak hours ≈ 20 min, otherwise ≈ 4 h).
      const now = Date.now();
      if (!force) {
        let lastSync = 0;
        try {
          const rec = await prisma.systemKv.findUnique({ where: { key: SYNC_TS_KEY } });
          if (rec?.value) lastSync = JSON.parse(rec.value).at ?? 0;
        } catch { /* ignore corrupt record */ }

        const cooldownMs = await getSyncCooldownMs();
        if (lastSync && now - lastSync < cooldownMs) {
          const nextRunIn = Math.ceil((cooldownMs - (now - lastSync)) / 1000);
          return NextResponse.json({
            success: true,
            skipped: true,
            cached: true,
            nextRunIn,
            sessionsCleaned,
            newJobs: 0,
          });
        }
      }

      const pipeline = new JobPipeline();
      const { jobs, newJobsAdded } = await pipeline.execute();
      const newJobs = newJobsAdded;

      // Record successful sync timestamp (for cooldown enforcement).
      await prisma.systemKv.upsert({
        where: { key: SYNC_TS_KEY },
        update: { value: JSON.stringify({ at: now }) },
        create: { key: SYNC_TS_KEY, value: JSON.stringify({ at: now }) },
      }).catch(() => {});

      // Clear trends cache so next visit gets fresh AI analysis
      await prisma.systemKv.delete({ where: { key: 'trends_cache' } }).catch(() => {});

      // Retention: delete all opportunities older than 7 days.
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await prisma.opportunity.deleteMany({
        where: {
          createdAt: { lt: cutoff },
        },
      }).catch(() => {});

      // Safety cap: if count still exceeds 5000, delete oldest rows first.
      const totalAfterRetention = await prisma.opportunity.count();
      if (totalAfterRetention > 5000) {
        const excess = totalAfterRetention - 4500;
        const ids = await prisma.opportunity.findMany({
          orderBy: { createdAt: 'asc' },
          take: excess,
          select: { id: true },
        });
        if (ids.length > 0) {
          await prisma.opportunity.deleteMany({
            where: { id: { in: ids.map(i => i.id) } },
          });
        }
      }

      return NextResponse.json({
        success: true,
        newJobs,
        jobs,
        sessionsCleaned,
      });
    } finally {
      await releaseSyncLock();
    }
  } catch (err) {
    console.error('API sync error:', err);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return runSync(req);
}

// Vercel Cron invokes the configured path with a GET request and sends
// `Authorization: Bearer <CRON_SECRET>` when the CRON_SECRET env var is set.
export async function GET(req: NextRequest) {
  return runSync(req);
}
