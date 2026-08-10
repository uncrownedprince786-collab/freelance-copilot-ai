import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { JobPipeline } from '../../../providers/JobPipeline';
import { prisma } from '@/lib/db';
import { isAdminRequest } from '@/lib/adminAuth';

const LOCK_KEY = 'sync_lock';
const LOCK_TTL_MS = 15 * 60 * 1000; // 15 minutes; release-on-finally plus TTL safety net

// Cooldown between production cron fetches. The cron runs every minute (per
// vercel.json) but we only need to hit Upwork/Freelancer every ~10 min; the
// rest of those runs perform lightweight session cleanup + heartbeat work.
const SYNC_TS_KEY = 'last_sync_successful';
const SYNC_COOLDOWN_MS = 10 * 60 * 1000;

function timingSafeSecretEqual(a: string, b: string): boolean {
  const aHash = crypto.createHash('sha256').update(a).digest();
  const bHash = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

// Prevent overlapping sync runs (Vercel cron every minute and GitHub Actions
// every 4h can coincide). Uses SystemKv with a TTL so a crashed run cannot
// wedge the pipeline permanently.
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

      // Cooldown: avoid hammering Upwork/Freelancer on every 1-min tick.
      const now = Date.now();
      if (!force) {
        let lastSync = 0;
        try {
          const rec = await prisma.systemKv.findUnique({ where: { key: SYNC_TS_KEY } });
          if (rec?.value) lastSync = JSON.parse(rec.value).at ?? 0;
        } catch { /* ignore corrupt record */ }

        if (lastSync && now - lastSync < SYNC_COOLDOWN_MS) {
          const nextRunIn = Math.ceil((SYNC_COOLDOWN_MS - (now - lastSync)) / 1000);
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
      const jobs = await pipeline.execute();
      const newJobs = jobs.length;

      // Record successful sync timestamp (for cooldown enforcement).
      await prisma.systemKv.upsert({
        where: { key: SYNC_TS_KEY },
        update: { value: JSON.stringify({ at: now }) },
        create: { key: SYNC_TS_KEY, value: JSON.stringify({ at: now }) },
      }).catch(() => {});

      // Clear trends cache so next visit gets fresh AI analysis
      await prisma.systemKv.delete({ where: { key: 'trends_cache' } }).catch(() => {});

      // Retention: delete non-applied opportunities older than 40 days.
      // Runs here (the cron/sync path) instead of on every public jobs GET.
      const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      await prisma.opportunity.deleteMany({
        where: {
          createdAt: { lt: fortyDaysAgo },
          applied: false,
        },
      }).catch(() => {});

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
