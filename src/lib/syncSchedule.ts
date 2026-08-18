import { prisma } from '@/lib/db';

// Adaptive sync cadence. The schedulers (GitHub Actions + Vercel cron) fire
// frequently; the sync route itself decides whether a full fetch is due using
// the real distribution of job posting times, so we never hammer the source
// APIs off-peak and never hardcode arbitrary "peak hours".
export const PEAK_INTERVAL_MS = 20 * 60 * 1000;       // ~every 20 min during peak activity
export const OFF_PEAK_INTERVAL_MS = 4 * 60 * 60 * 1000; // ~every 4 h otherwise
const ANALYSIS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;   // live-window lookback (7 days)
const HISTORICAL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // persisted-aggregate lookback (14 days)
const MIN_SAMPLES = 30;                               // below this, no peak assumption

export type { PrismaClient } from '@prisma/client';

function utcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Posting-time distribution of the live window (raw listings). */
async function liveHourCounts(): Promise<{ counts: number[]; total: number }> {
  const since = new Date(Date.now() - ANALYSIS_WINDOW_MS);
  const rows = await prisma.opportunity.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, rawPayload: true },
  });
  const counts = new Array<number>(24).fill(0);
  for (const row of rows) {
    // Prefer the preserved source posting time (rawPayload.postedAt) so the
    // cadence reflects real posting hours; fall back to the first-seen anchor.
    let ts = row.createdAt.getTime();
    try {
      const payload = row.rawPayload ? JSON.parse(row.rawPayload) : null;
      const srcMs = typeof payload?.postedAt === 'string' ? new Date(payload.postedAt).getTime() : NaN;
      if (Number.isFinite(srcMs) && srcMs > 0 && srcMs <= Date.now()) ts = srcMs;
    } catch { /* keep createdAt */ }
    counts[new Date(ts).getUTCHours()]++;
  }
  return { counts, total: rows.length };
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
  if (peak.size === 0) return 'Every 4 hours';
  const hours = [...peak].sort((a, b) => a - b);
  const fmt = (h: number) => {
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${h < 12 ? ' AM' : ' PM'} UTC`;
  };
  return `Peak (${hours.map(fmt).join(', ')}): ~20 min · Off-peak: ~4 h`;
}
