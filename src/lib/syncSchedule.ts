import { prisma } from '@/lib/db';

// Adaptive sync cadence. The schedulers (GitHub Actions + Vercel cron) fire
// frequently; the sync route itself decides whether a full fetch is due using
// the real distribution of job posting times, so we never hammer the source
// APIs off-peak and never hardcode arbitrary "peak hours".
export const PEAK_INTERVAL_MS = 20 * 60 * 1000;       // ~every 20 min during peak activity
export const OFF_PEAK_INTERVAL_MS = 4 * 60 * 60 * 1000; // ~every 4 h otherwise
const ANALYSIS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;   // look at the last 7 days
const MIN_SAMPLES = 30;                               // below this, no peak assumption

export type { PrismaClient } from '@prisma/client';

// An hour of the day (UTC) is "peak" when its posting volume in the last 7
// days is above the per-hour average. createdAt holds the provider posting
// time (saveStore maps postedAt → createdAt), so this is real source data.
export async function getPeakHours(): Promise<Set<number>> {
  try {
    const since = new Date(Date.now() - ANALYSIS_WINDOW_MS);
    const rows = await prisma.opportunity.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
    });
    if (rows.length < MIN_SAMPLES) return new Set();

    const counts = new Array<number>(24).fill(0);
    for (const row of rows) counts[new Date(row.createdAt).getUTCHours()]++;
    const average = rows.length / 24;

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
