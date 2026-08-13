/**
 * Shared opportunity ranking — single source of truth for "what shows first".
 *
 * Composite, freshness-weighted score. Every job gets ONE rank score computed
 * from the three live signals; lower score ranks first. This replaces the old
 * hard freshness-tier buckets, which silently made 1-5 minute age differences
 * meaningless (any two jobs in the same bucket ignored freshness entirely).
 *
 *   rankScore = FRESHNESS * ageMinutes
 *              + PROPOSAL  * proposalCount
 *              + SCORE     * (MAX_SCORE - score)
 *
 * All three share one unit ("minutes equivalent") so the weights are
 * comparable and easy to reason about:
 *
 *  - Freshness dominates at LARGE gaps: the combined proposal + score swing is
 *    bounded by PROPOSAL_WEIGHT*50 + SCORE_WEIGHT*100 = 10 + 20 = 30 min, so any
 *    freshness gap larger than ~30 minutes can never be overturned by proposal
 *    count or assessment score. A 1-minute-old job therefore always beats a
 *    2-hour-old job.
 *  - Small differences still matter: a 1 vs 5-minute age gap is a 4-minute
 *    freshness edge, which is comparable to a few proposals or a few score
 *    points, so it meaningfully affects ordering instead of being discarded.
 *  - When freshness is close, fewer proposals and a higher assessment win.
 *  - Unknown/null proposal counts are treated as worst-in-class (50), never as 0,
 *    so a confirmed 0-proposal job always outranks one with an unknown count.
 *  - Unknown postedAt (Infinity age) sorts last regardless of other signals.
 *
 * The score is derived purely from current DB fields, so it recalculates on every
 * getRawJobs() read — whenever sync/refresh changes freshness, proposal count,
 * assessment score, or adds new jobs.
 */

export interface OpportunityLike {
  id: string;
  postedAt?: string | null;
  proposalCount?: number | null;
  score?: number | null;
  actFast?: boolean;
  budget?: string;
  repeatClient?: boolean;
}

// Weights in "minutes-equivalent" so all three signals are comparable.
// Freshness gap must exceed the bounded proposal+score swing (30 min) to be
// "major" enough to always dominate — a 2h gap (120 min) always does.
const FRESHNESS_WEIGHT = 1.0; // minutes of age
const PROPOSAL_WEIGHT = 0.2;   // minutes added per proposal (max 50 -> +10 min)
const SCORE_WEIGHT = 0.2;      // minutes added per missing score point (max 100 -> +20 min)
const MAX_PROPOSALS = 50;      // Upwork "50+" band normalizes here
const MAX_SCORE = 100;

function ageMinutes(j: OpportunityLike): number {
  const ms = new Date(j.postedAt || 0).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return Infinity; // unknown age -> last
  const age = (Date.now() - ms) / 60000;
  return age < 0 ? 0 : age; // defensive: postedAt is clamped, but never negative-score
}

function proposalMinutes(j: OpportunityLike): number {
  const n = j.proposalCount;
  if (typeof n !== 'number') return MAX_PROPOSALS * PROPOSAL_WEIGHT; // unknown -> worst
  return n * PROPOSAL_WEIGHT; // more proposals = larger penalty
}

function scoreMinutes(j: OpportunityLike): number {
  const s = typeof j.score === 'number' ? j.score : 0;
  return (MAX_SCORE - s) * SCORE_WEIGHT; // higher score = smaller penalty
}

/** Lower rankScore ranks first. */
export function rankScore(j: OpportunityLike): number {
  return FRESHNESS_WEIGHT * ageMinutes(j) + proposalMinutes(j) + scoreMinutes(j);
}

export function compareOpportunities(a: OpportunityLike, b: OpportunityLike): number {
  const sa = rankScore(a);
  const sb = rankScore(b);
  if (sa !== sb) return sa - sb; // lower score first
  // Stable, deterministic tiebreak so the feed never appears random across syncs.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
