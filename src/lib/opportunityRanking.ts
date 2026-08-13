/**
 * Shared opportunity ranking — single source of truth for "what shows first".
 *
 * Business philosophy (freshness-first):
 *   1. FRESHEST jobs first, bucketed into natural freshness tiers derived from
 *      the real postedAt age. A proposal refresh NEVER re-ages a job (postedAt
 *      is the source posting time, persisted and never rewritten).
 *   2. Within a comparable-freshness tier: LOWER KNOWN competition first. A
 *      confirmed 0 proposals is a real low-competition signal; unknown/null
 *      proposal counts are NOT treated as 0 and go last.
 *   3. Stronger opportunity score (existing signal).
 *   4. Fresher exact posting time (residual tiebreak inside a tier).
 *   5. Act-fast signal, then budget, then repeat-client signal.
 *   6. Stable id tiebreak so the feed never appears random across syncs.
 *
 * Used by the dashboard (Recommended), the /api/jobs feed, and the AI agent
 * search — the whole product orders opportunities the same way.
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

// Natural freshness tiers (minutes since posting). General business windows —
// fresher work always leads, competition only breaks ties within a tier.
const TIER_MIN = [
  30,    // < 30 min
  60,    // < 1 h
  120,   // < 2 h
  240,   // < 4 h
  480,   // < 8 h
  720,   // < 12 h
  1440,  // < 24 h
  4320,  // < 3 d
  10080, // < 7 d
];

function postedTimeOf(j: OpportunityLike): number {
  return new Date(j.postedAt || 0).getTime();
}

function freshnessTier(j: OpportunityLike): number {
  const ms = postedTimeOf(j);
  if (!Number.isFinite(ms) || ms <= 0) return TIER_MIN.length; // unknown age last
  const ageMin = (Date.now() - ms) / 60000;
  for (let i = 0; i < TIER_MIN.length; i++) {
    if (ageMin < TIER_MIN[i]) return i;
  }
  return TIER_MIN.length;
}

function compKey(n: number | null | undefined): number {
  return typeof n === 'number' ? n : Number.MAX_SAFE_INTEGER;
}

function budgetNumber(s: string | undefined): number {
  const m = String(s || '').match(/\$?([\d,]+)/);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
}

export function compareOpportunities(a: OpportunityLike, b: OpportunityLike): number {
  const ta = freshnessTier(a);
  const tb = freshnessTier(b);
  if (ta !== tb) return ta - tb;

  const ca = compKey(a.proposalCount);
  const cb = compKey(b.proposalCount);
  if (ca !== cb) return ca - cb;

  const sa = a.score ?? 0;
  const sb = b.score ?? 0;
  if (sb !== sa) return sb - sa;

  const at = postedTimeOf(a);
  const bt = postedTimeOf(b);
  if (bt !== at) return bt - at;

  const fa = a.actFast ? 1 : 0;
  const fb = b.actFast ? 1 : 0;
  if (fb !== fa) return fb - fa;

  const ba = budgetNumber(a.budget);
  const bb = budgetNumber(b.budget);
  if (bb !== ba) return bb - ba;

  const ra = a.repeatClient ? 1 : 0;
  const rb = b.repeatClient ? 1 : 0;
  if (rb !== ra) return rb - ra;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
