/**
 * How the daily Apify query budget is divided.
 *
 * `apifyBudget.ts` answers "how many billed runs are left today". This module
 * answers "who may spend them", which the measurements say matters more than
 * the size of the budget.
 *
 * What the live data shows:
 *
 *   Upwork      198 rows,  131 useful leads (66.2%), avg lead score 64.1, 0 dupes
 *   Freelancer  1,134 rows, 115 useful leads (10.1%), avg lead score 42.8, 28 dupes
 *
 * Upwork produces MORE useful leads than Freelancer from one sixth of the
 * volume. Upwork is also the only source that costs Apify budget, and it is
 * the one being starved: 211 of 800 recorded runs reported `Apify (0)`, and
 * the stored budget state says `daily Apify query budget exhausted (skipped 4
 * query(s))`.
 *
 * The arithmetic behind that. Discovery issues 4 queries per sync run and the
 * default budget is 16 billed runs a day, so the budget covers four sync runs
 * — but the cron fires roughly ten times a day, and the active-job refresher
 * draws from the same pool in between. Whoever asks first wins, which is not
 * a policy.
 *
 * Two rules here, both deliberately boring:
 *
 *   1. Discovery has a reserved floor. Refresh may only spend what is above
 *      it, so re-checking listings already in the database can never consume
 *      the budget needed to find new ones. Finding a lead is worth more than
 *      updating a proposal count — especially since the counts are measured
 *      not to move (see freshness.ts).
 *
 *   2. Discovery spends in the hours that actually yield. Recorded run
 *      history shows new jobs per run varying from 3.4 at 03:00 UTC to 20.8
 *      at 06:00 — a factor of six. Spreading a fixed budget evenly across the
 *      day buys the 03:00 hour at the same price as the 06:00 one.
 *
 * Nothing here tries to exceed the free tier or work around it. It divides a
 * fixed allowance better.
 */

/** Billed runs kept back for new-job discovery. Configurable rather than a
 *  magic number, per the free-tier survival rules. */
export function getDiscoveryReserve(): number {
  const n = Number(process.env.APIFY_DISCOVERY_RESERVE);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 8;
}

export type ApifyPurpose = 'discovery' | 'refresh';

/**
 * How many billed runs `purpose` may still spend, given what is left today.
 *
 * Discovery gets everything. Refresh gets only what is above the reserve, so
 * it degrades to zero before discovery loses a single query.
 */
export function spendableBudget(
  purpose: ApifyPurpose,
  remaining: number,
  reserve: number = getDiscoveryReserve(),
): number {
  const left = Math.max(0, Math.floor(remaining));
  if (purpose === 'discovery') return left;
  return Math.max(0, left - Math.max(0, Math.floor(reserve)));
}

/** Convenience: may this purpose launch at least one more billed run? */
export function canSpend(
  purpose: ApifyPurpose,
  remaining: number,
  reserve?: number,
): boolean {
  return spendableBudget(purpose, remaining, reserve) > 0;
}

/**
 * The UTC hours discovery should spend its budget in, richest first.
 *
 * `yieldByHour[h]` is the average number of NEW jobs a run starting in that
 * hour has historically produced. Hours with too few observations are
 * ignored rather than guessed at — one lucky run at 04:00 must not win the
 * whole budget.
 *
 * Returns at most `slots` hours, where `slots` is how many discovery runs the
 * budget affords. With an empty or too-sparse history it returns null,
 * meaning "no basis to concentrate — run on the normal cadence". A null is an
 * honest absence, not an instruction to stop scraping.
 */
export function bestDiscoveryHours(
  yieldByHour: Array<{ hour: number; avgNewJobs: number; runs: number }>,
  slots: number,
  minRuns = 5,
): Set<number> | null {
  if (slots <= 0) return null;
  const usable = yieldByHour.filter(
    h => h.runs >= minRuns && Number.isInteger(h.hour) && h.hour >= 0 && h.hour < 24,
  );
  // Below a handful of usable hours there is no distribution to exploit.
  if (usable.length < slots + 2) return null;

  const ranked = [...usable].sort(
    (a, b) => b.avgNewJobs - a.avgNewJobs || a.hour - b.hour,
  );
  return new Set(ranked.slice(0, slots).map(h => h.hour));
}

/**
 * How many discovery runs today's budget affords.
 * Each discovery run issues `queriesPerRun` separately billed Apify runs.
 */
export function discoverySlots(dailyBudget: number, queriesPerRun: number): number {
  if (queriesPerRun <= 0) return 0;
  return Math.floor(Math.max(0, dailyBudget) / queriesPerRun);
}
