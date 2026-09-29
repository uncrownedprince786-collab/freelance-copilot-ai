/**
 * Freshness — states, decay, and an honest account of how old the numbers are.
 *
 * Grounded in measured platform behaviour, not in a guess about what "fresh"
 * should mean. Over the 1,332 live rows:
 *
 *   capture lag (createdAt - postedAt)   Upwork avg 1.0h, Freelancer avg 2.3h
 *   proposals by age AT CAPTURE          Upwork 8 (<1h) → 16 (1-6h)
 *   proposals by CURRENT age             Freelancer 18 / 21 / 25 / 19 / 22 /
 *                                        22 / 22 / 21 across 1h → 5d+ buckets
 *   oldest row                           178h (7.4 days)
 *   rows older than 30 days              0
 *
 * Two things follow, and the second is the more important one.
 *
 * 1. Competition builds fast and early. Upwork listings roughly DOUBLE their
 *    proposal count between the first hour and the first six. So the decay
 *    curve has to be steep at the start; a linear "newer is better" ramp
 *    would badly understate how much of the advantage is gone by lunchtime.
 *
 * 2. `proposalCount` does not grow with a row's age — it is flat across every
 *    age bucket. Combined with a capture lag of one to two hours, that means
 *    the stored count is a SNAPSHOT TAKEN SHORTLY AFTER POSTING AND NEVER
 *    UPDATED. A five-day-old listing still shows the number of proposals it
 *    had two hours in.
 *
 *    This matters beyond scoring. The UI and the assistant currently say
 *    things like "only 3 proposals so far", which reads as a live figure. It
 *    is not. `competitionObservation` below exists so a caller can say how
 *    old the number is instead of implying it is current.
 */

export type FreshnessState =
  | 'just_posted'
  | 'fresh'
  | 'active'
  | 'aging'
  | 'stale'
  | 'expired'
  /** No usable source posting time. Not a freshness claim — an absence. */
  | 'unknown';

/**
 * State boundaries in hours.
 *
 * `just_posted` and `fresh` bracket the window where the measured doubling
 * happens. `expired` starts at 7 days because retention purges around there
 * and the oldest row ever observed is 7.4 days — beyond it, a listing being
 * in this table says nothing about it still being open.
 */
export const FRESHNESS_HOURS = {
  justPosted: 1,
  fresh: 6,
  active: 24,
  aging: 72,
  stale: 168,
} as const;

export function ageHours(postedAt: Date | null | undefined, now: Date = new Date()): number | null {
  if (!postedAt) return null;
  const ms = now.getTime() - postedAt.getTime();
  if (!Number.isFinite(ms)) return null;
  // A posting time slightly in the future is source clock skew, not an error
  // worth surfacing here; treat it as brand new.
  return Math.max(0, ms / 3_600_000);
}

export function freshnessState(
  postedAt: Date | null | undefined,
  now: Date = new Date(),
): FreshnessState {
  const h = ageHours(postedAt, now);
  if (h == null) return 'unknown';
  if (h < FRESHNESS_HOURS.justPosted) return 'just_posted';
  if (h < FRESHNESS_HOURS.fresh) return 'fresh';
  if (h < FRESHNESS_HOURS.active) return 'active';
  if (h < FRESHNESS_HOURS.aging) return 'aging';
  if (h < FRESHNESS_HOURS.stale) return 'stale';
  return 'expired';
}

/**
 * Half-life of an opportunity's freshness advantage, in hours.
 *
 * A judgement call, informed by two measurements rather than picked: the
 * measured doubling of competition inside six hours argues for a steep early
 * slope, and a median inventory age of ~3.5 days with a 7-day retention
 * window argues against a curve that writes off everything by lunchtime. 48
 * hours puts a one-day-old listing at 0.71 and a three-day-old one at 0.35,
 * which keeps the older half of the feed rankable instead of flattening it.
 *
 * Named and exported so it can be argued with and tuned.
 */
export const FRESHNESS_HALF_LIFE_HOURS = 48;

/** Never let freshness alone zero out an otherwise strong opportunity. */
export const FRESHNESS_FLOOR = 0.05;

/**
 * Continuous freshness factor in [FRESHNESS_FLOOR, 1]. Gradual by
 * construction — there is no cliff where a listing stops counting, which is
 * the failure mode of a "posted < 1 hour = good, > 1 hour = bad" rule.
 *
 * Returns null when there is no posting time. A caller must decide what to do
 * with an unknown age; this must not silently substitute a number.
 */
export function freshnessFactor(
  postedAt: Date | null | undefined,
  now: Date = new Date(),
): number | null {
  const h = ageHours(postedAt, now);
  if (h == null) return null;
  const decayed = Math.pow(0.5, h / FRESHNESS_HALF_LIFE_HOURS);
  return Math.max(FRESHNESS_FLOOR, Number(decayed.toFixed(4)));
}

/** Plain-language age, for a UI that must never imply real-time data. */
export function describeAge(postedAt: Date | null | undefined, now: Date = new Date()): string {
  const h = ageHours(postedAt, now);
  if (h == null) return 'posting time not published by the source';
  if (h < 1) {
    const mins = Math.max(1, Math.round(h * 60));
    return `posted ${mins} minute${mins === 1 ? '' : 's'} ago`;
  }
  if (h < 48) {
    const hours = Math.round(h);
    return `posted ${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.round(h / 24);
  return `posted ${days} day${days === 1 ? '' : 's'} ago`;
}

export interface CompetitionObservation {
  /** The stored proposal count, or null when the source published none. */
  count: number | null;
  /** When that count was captured — NOT now. */
  observedAt: Date | null;
  /** How old the observation is, in hours. */
  observationAgeHours: number | null;
  /** True once the number is old enough that presenting it as current would
   *  mislead. */
  outdated: boolean;
  /** A phrase a UI can show verbatim without overclaiming. */
  label: string;
}

/** Beyond this, a proposal count is history rather than a current reading. */
export const COMPETITION_FRESH_HOURS = 12;

/**
 * Describe the competition figure honestly.
 *
 * The stored count is whatever the source reported when the listing was
 * scraped, typically one to two hours after it was posted, and nothing
 * updates it afterwards. Saying "3 proposals so far" about a five-day-old
 * listing states something this system does not know.
 */
export function competitionObservation(
  count: number | null | undefined,
  observedAt: Date | null | undefined,
  now: Date = new Date(),
): CompetitionObservation {
  const c = typeof count === 'number' && Number.isFinite(count) ? count : null;
  const obsAge = observedAt ? Math.max(0, (now.getTime() - observedAt.getTime()) / 3_600_000) : null;

  if (c == null) {
    return {
      count: null,
      observedAt: observedAt ?? null,
      observationAgeHours: obsAge,
      outdated: false,
      label: 'no proposal count published by the source',
    };
  }

  const plural = c === 1 ? 'proposal' : 'proposals';
  if (obsAge == null) {
    return { count: c, observedAt: null, observationAgeHours: null, outdated: true,
      label: `${c} ${plural} when last checked` };
  }
  if (obsAge < COMPETITION_FRESH_HOURS) {
    return { count: c, observedAt: observedAt!, observationAgeHours: obsAge, outdated: false,
      label: `${c} ${plural} as of ${Math.max(1, Math.round(obsAge))}h ago` };
  }
  const days = obsAge / 24;
  const ago = days >= 1
    ? `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'} ago`
    : `${Math.round(obsAge)} hours ago`;
  return {
    count: c,
    observedAt: observedAt!,
    observationAgeHours: obsAge,
    outdated: true,
    label: `${c} ${plural} when this listing was checked ${ago} — not a current figure`,
  };
}
