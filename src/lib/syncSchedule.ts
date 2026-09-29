import { prisma } from '@/lib/db';
import { getApifyBudgetRemaining, getApifyDailyBudget } from '@/lib/apifyBudget';
import {
  bestDiscoveryHours,
  discoverySlots,
  shouldSpendDiscoveryNow,
} from '@/lib/apifyAllocation';

/** Billed Apify runs one discovery pass costs.
 *
 *  This is 1, not 4: the provider batches its whole query list into a single
 *  Actor-Start. It stays configurable because the number is a property of how
 *  the provider calls the actor, and the two have to be tuned together. */
function getApifyQueriesPerRun(): number {
  const n = Number(process.env.APIFY_QUERIES_PER_RUN);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

// Adaptive sync cadence. The schedulers (GitHub Actions + Vercel cron) fire
// frequently; the sync route itself decides whether a full fetch is due using
// the real distribution of job posting times, so we never hammer the source
// APIs off-peak and never hardcode arbitrary "peak hours".
export const PEAK_INTERVAL_MS = 45 * 60 * 1000;      // ~every 45 min during peak activity
export const OFF_PEAK_INTERVAL_MS = 4 * 60 * 60 * 1000; // ~every 4 h otherwise
const ANALYSIS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;   // live-window lookback (7 days)
const HISTORICAL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // persisted-aggregate lookback (14 days)
const MIN_SAMPLES = 30;                               // below this, no peak assumption

export type { PrismaClient } from '@prisma/client';

function utcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Posting-time distribution of the live window (raw listings).
 *
 * This used to `findMany` every row in the window selecting `rawPayload`,
 * then JSON.parse each blob in application code to recover the posting time —
 * roughly 1,300 rows and 1,300 parses on every scheduling decision, which
 * runs on every sync tick. The posting time is now a real indexed column, so
 * the database can group by hour and return 24 rows.
 *
 * `postedAt` holds UTC wall-clock (Prisma's convention for a `timestamp`
 * without time zone), so EXTRACT gives the UTC hour with no conversion. Rows
 * whose source published no posting time fall back to the first-seen anchor,
 * which is what the previous implementation did.
 */
async function liveHourCounts(): Promise<{ counts: number[]; total: number }> {
  const since = new Date(Date.now() - ANALYSIS_WINDOW_MS);
  const rows = await prisma.$queryRaw<Array<{ hour: number; n: bigint }>>`
    SELECT EXTRACT(HOUR FROM COALESCE("postedAt", "createdAt"))::int AS hour,
           COUNT(*)::bigint AS n
      FROM "opportunities"
     WHERE "createdAt" >= ${since}
     GROUP BY 1
  `;
  const counts = new Array<number>(24).fill(0);
  let total = 0;
  for (const row of rows) {
    const hour = Number(row.hour);
    const n = Number(row.n);
    if (Number.isInteger(hour) && hour >= 0 && hour < 24 && Number.isFinite(n)) {
      counts[hour] += n;
      total += n;
    }
  }
  return { counts, total };
}

/** Posting-time distribution from persisted MarketFact 'hour' aggregates —
 *  longer window, still real collected data. Degrades to empty on failure
 *  (e.g. the table is not deployed yet). */
async function historicalHourCounts(): Promise<{ counts: number[]; total: number }> {
  try {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - Math.ceil(HISTORICAL_WINDOW_MS / 86400000) + 1);
    const rows = await prisma.marketFact.findMany({
      where: { date: { gte: utcDayKey(since) }, dimension: 'hour' },
      select: { key: true, value: true },
    });
    const counts = new Array<number>(24).fill(0);
    let total = 0;
    for (const r of rows) {
      const hour = Number(r.key);
      if (Number.isInteger(hour) && hour >= 0 && hour < 24) {
        counts[hour] += r.value;
        total += r.value;
      }
    }
    return { counts, total };
  } catch {
    return { counts: new Array<number>(24).fill(0), total: 0 };
  }
}

// An hour of the day (UTC) is "peak" when its posting volume is above the
// per-hour average. Live listings (7 days) are the primary signal; when at
// least MIN_SAMPLES of historical data exists it is blended in (14 days) so
// the cadence stays stable even as individual listings age out of the store.
export async function getPeakHours(): Promise<Set<number>> {
  try {
    const live = await liveHourCounts();
    const historical = await historicalHourCounts();

    const sampleCount = live.total;
    if (sampleCount < MIN_SAMPLES) return new Set();

    const useHistory = historical.total >= MIN_SAMPLES;
    const counts = new Array<number>(24).fill(0);
    for (let h = 0; h < 24; h++) {
      // Weight the longer window at half the live window's weight, so recent
      // activity dominates but quieter week-to-week hours still contribute.
      counts[h] = live.counts[h] + (useHistory ? historical.counts[h] * 0.5 : 0);
    }
    const total = counts.reduce((a, b) => a + b, 0);
    const average = total / 24;

    const peak = new Set<number>();
    for (let h = 0; h < 24; h++) {
      if (counts[h] > average) peak.add(h);
    }
    return peak;
  } catch {
    // On any failure, fall back to the conservative off-peak cadence.
    return new Set();
  }
}

// Cooldown to enforce before the next full source fetch, based on whether the
// current UTC hour is a real peak hour.
export async function getSyncCooldownMs(): Promise<number> {
  const hour = new Date().getUTCHours();
  const peak = await getPeakHours();
  return peak.has(hour) ? PEAK_INTERVAL_MS : OFF_PEAK_INTERVAL_MS;
}

// Human-readable schedule string for the UI, derived from the same data.
export async function getScheduleLabel(): Promise<string> {
  const peak = await getPeakHours();
  const peakMin = Math.round(PEAK_INTERVAL_MS / 60000);
  const offPeakH = Math.round(OFF_PEAK_INTERVAL_MS / 3600000);
  if (peak.size === 0) return `Every ${offPeakH} hours`;
  const hours = [...peak].sort((a, b) => a - b);
  const fmt = (h: number) => {
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${h < 12 ? ' AM' : ' PM'} UTC`;
  };
  return `Peak (${hours.map(fmt).join(', ')}): ~${peakMin} min · Off-peak: ~${offPeakH} h`;
}

/**
 * Observed discovery yield per UTC hour, from the recorded run history.
 *
 * Refresher runs are excluded: they add no new jobs by design, so counting
 * them would drag every hour they touch toward zero and make the
 * distribution meaningless. (Mis-reading those runs as wasted was the first
 * conclusion drawn from this table, and it was wrong.)
 *
 * Aggregated in SQL — 24 rows back, not the whole log.
 */
export async function discoveryYieldByHour(): Promise<
  Array<{ hour: number; avgNewJobs: number; runs: number }>
> {
  try {
    const rows = await prisma.$queryRaw<Array<{ hour: number; runs: bigint; avg_new: number | null }>>`
      SELECT EXTRACT(HOUR FROM "timestamp")::int AS hour,
             COUNT(*)                            AS runs,
             AVG("newJobsAdded")                 AS avg_new
        FROM "cron_logs"
       WHERE "sourceSummary" NOT LIKE 'refresher%'
       GROUP BY 1
    `;
    return rows.map(r => ({
      hour: Number(r.hour),
      runs: Number(r.runs),
      avgNewJobs: r.avg_new == null ? 0 : Number(r.avg_new),
    }));
  } catch {
    // No history is a reason not to concentrate spend, never a reason to
    // stop scraping. The caller treats an empty list as "no basis".
    return [];
  }
}

/**
 * Should this run spend billed Apify queries on new-job discovery?
 *
 * Measured yield varies from 3.4 new jobs per run at 03:00 UTC to 20.8 at
 * 06:00 — a factor of six at the same price — while the daily budget only
 * covers four discovery runs. Concentrating spend in the richest hours is
 * the difference between buying the 06:00 hour and buying the 03:00 one.
 *
 * Fails OPEN. If the history cannot be read or the budget cannot be
 * checked, discovery proceeds on the normal cadence: a telemetry problem
 * must never silently stop ingestion.
 */
export async function shouldRunApifyDiscovery(
  now: Date = new Date(),
): Promise<{ allowed: boolean; reason: string }> {
  try {
    const [remaining, history] = await Promise.all([
      getApifyBudgetRemaining(),
      discoveryYieldByHour(),
    ]);
    const queriesPerRun = getApifyQueriesPerRun();
    const slots = discoverySlots(getApifyDailyBudget(), queriesPerRun);
    const topHours = bestDiscoveryHours(history, slots);
    const hour = now.getUTCHours();

    const allowed = shouldSpendDiscoveryNow({
      hour,
      topHours,
      remaining,
      queriesPerRun,
      hoursLeftToday: 24 - hour,
    });

    if (allowed) return { allowed: true, reason: 'ok' };
    if (remaining < queriesPerRun) {
      return { allowed: false, reason: `daily Apify budget too low for a full run (${remaining} left)` };
    }
    return {
      allowed: false,
      reason: `hour ${hour}:00 UTC is outside the ${slots} highest-yield hours and the budget is reserved for them`,
    };
  } catch {
    return { allowed: true, reason: 'schedule check unavailable; proceeding on the normal cadence' };
  }
}
