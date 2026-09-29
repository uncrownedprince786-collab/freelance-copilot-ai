import { NextRequest, NextResponse } from 'next/server';
import { JobPipeline } from '../../../providers/JobPipeline';
import { prisma } from '@/lib/db';
import { isAdminRequest } from '@/lib/adminAuth';
import { hasValidCronBearer } from '@/lib/cronAuth';
import { acquireLock, releaseLock } from '@/lib/runLock';
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


// Overlap prevention lives in lib/runLock: a single-statement conditional
// insert, so two ticks arriving together cannot both win. It fails CLOSED —
// a sync that cannot prove it holds the lock does not run, because a
// concurrent run would spend the Apify budget twice.

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
    // Fail-closed: authorize only with a valid Bearer CRON_SECRET (Vercel cron /
    // GitHub Actions) or a valid admin session cookie (manual sync from the UI).
    const authorized = hasValidCronBearer(req) || (await isAdminRequest());
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    // `force=true` is only sent by the admin UI to bypass the cooldown for a
    // manual refresh. The cron never sends it.
    const force = url.searchParams.get('force') === 'true';

    const lock = await acquireLock(LOCK_KEY, LOCK_TTL_MS);
    if (!lock) {
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
      await releaseLock(lock);
    }
  } catch (err) {
    console.error('API sync error:', err);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return runSync(req);
}

// GET is reachable by CSRF: SameSite=Lax sends cookies on a cross-site
// top-level GET navigation, so an admin merely clicking a link could trigger
// `?force=true` — draining the day's Apify budget and running the retention
// deleteMany. GET is therefore accepted ONLY with a valid Bearer secret (how
// schedulers call it); a cookie session cannot authorize it.
export async function GET(req: NextRequest) {
  if (!hasValidCronBearer(req)) {
    return NextResponse.json(
      { error: 'Use POST for interactive sync.' },
      { status: 405, headers: { Allow: 'POST' } },
    );
  }
  return runSync(req);
}
