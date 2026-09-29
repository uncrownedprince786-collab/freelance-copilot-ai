import { competitionObservation, freshnessFactor } from './freshness';

/**
 * Lead scoring — explainable, and scored only on what the source actually
 * published.
 *
 * The question this answers is not "is this a good job?" but "how useful is
 * this as a potential sales lead?". Every score comes with the reasons that
 * produced it and the risks that qualify it, because a bare "87" tells a user
 * nothing they can act on.
 *
 * Two design rules come straight from the measured data.
 *
 * ONLY EVALUABLE DIMENSIONS COUNT. Freelancer publishes no client signal at
 * all — 0 of 1,134 rows have spend, rating or jobs-posted — so a fixed-weight
 * model would dock 85% of inventory for a gap in the SOURCE's reporting
 * rather than anything about the job. Each dimension is scored only when its
 * inputs exist, and the total is normalised over the dimensions that could be
 * evaluated. What is missing is reported as a risk, not subtracted as a
 * penalty. `coverage` says how much of the model actually ran.
 *
 * BUDGETS ARE NOT COMPARABLE AS RAW NUMBERS. Measured: 437 rows priced in ₹
 * (average minimum ₹39,037), 334 in $ (average minimum $795), 51 in €, 24 in
 * £, and all 198 Upwork rows carry no currency field at all. Ranking on the
 * raw number would put a ₹39,000 job ~49x above a $795 one. Budgets are
 * therefore placed in coarse USD-equivalent bands using the approximate rates
 * below, and hourly rates are scored on their own scale — $23/h and a $541
 * fixed price are not the same kind of number.
 */

export type LeadBand = 'high' | 'promising' | 'moderate' | 'low' | 'insufficient_data';

export interface LeadAssessment {
  /** 0-100, or null when too little was published to score honestly. */
  score: number | null;
  band: LeadBand;
  /** Why it scored what it scored. Plain language, tied to real values. */
  reasons: string[];
  /** What qualifies the score. Never empty when a dimension was unavailable. */
  risks: string[];
  /** Share of the model's weight that could actually be evaluated, 0-1. */
  coverage: number;
}

export interface LeadScoreInput {
  platform: string;
  title: string;
  description: string;
  /** The stored budget string — a JSON blob for every live row. */
  budget: string;
  skills?: string | null;
  experienceLevel?: string | null;
  proposalCount?: number | null;
  /** When the proposal count was captured. Not now — see freshness.ts. */
  competitionObservedAt?: Date | null;
  clientSpend?: string | null;
  clientRating?: string | null;
  jobsPosted?: number | null;
  postedAt?: Date | null;
}

/**
 * Approximate units of USD per currency unit, as of September 2026.
 *
 * Deliberately coarse and used for ONE purpose: placing a budget in a band
 * that spans a factor of 4-5. A 20% FX drift does not move a budget between
 * bands, so these rates going stale degrades the model gently instead of
 * silently. No converted figure is ever displayed to a user, and nothing here
 * is presented as a source fact.
 *
 * A currency that is not listed makes the budget dimension unevaluable rather
 * than guessed.
 */
const APPROX_USD = new Map<string, number>([
  ['$', 1], ['usd', 1],
  ['€', 1.08], ['eur', 1.08],
  ['£', 1.27], ['gbp', 1.27],
  ['₹', 0.012], ['inr', 0.012],
  ['a$', 0.66], ['aud', 0.66],
  ['c$', 0.73], ['cad', 0.73],
]);

interface ParsedBudget {
  type: 'fixed' | 'hourly';
  /** Representative amount in approximate USD, or null when unknowable. */
  usd: number | null;
  /** True when the currency was absent and USD was assumed. */
  assumedUsd: boolean;
}

/**
 * Parse the stored budget blob.
 *
 * Upwork rows carry no currency at all (198 of 198). Upwork contracts are
 * denominated in USD, so USD is assumed there and the assumption is recorded
 * and surfaced as a risk. For any other source, a missing currency leaves the
 * budget unscored — assuming a currency for a Freelancer row would be
 * assuming away the exact 49x error this guards against.
 */
export function parseBudget(raw: string, platform: string): ParsedBudget | null {
  if (!raw || !raw.trim().startsWith('{')) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const type = String(obj.type || 'fixed').toLowerCase() === 'hourly' ? 'hourly' : 'fixed';
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const min = num(obj.min);
  const max = num(obj.max);
  const amount = num(obj.amount);
  // The midpoint of a range, or the single figure when that is all there is.
  const native = amount ?? (min != null && max != null ? (min + max) / 2 : (min ?? max));
  if (native == null || native <= 0) return { type, usd: null, assumedUsd: false };

  const currency = String(obj.currency ?? '').trim().toLowerCase();
  if (!currency) {
    if (platform.toLowerCase() === 'upwork') {
      return { type, usd: native, assumedUsd: true };
    }
    return { type, usd: null, assumedUsd: false };
  }
  const rate = APPROX_USD.get(currency);
  if (rate == null) return { type, usd: null, assumedUsd: false };
  return { type, usd: native * rate, assumedUsd: false };
}

/** Dimension weights. Named so the model can be argued with. */
export const LEAD_WEIGHTS = {
  budget: 25,
  client: 25,
  competition: 20,
  clarity: 15,
  freshness: 15,
} as const;

export const LEAD_BANDS = { high: 75, promising: 60, moderate: 40 } as const;

/** Below this much evaluable weight, a number would be a guess. */
export const MIN_COVERAGE = 0.4;

/** Coarse USD bands. Each spans a factor of ~4, so FX drift does not reband. */
function budgetScore(b: ParsedBudget): number | null {
  if (b.usd == null) return null;
  if (b.type === 'hourly') {
    if (b.usd >= 75) return 1;
    if (b.usd >= 45) return 0.85;
    if (b.usd >= 25) return 0.6;
    if (b.usd >= 15) return 0.35;
    return 0.15;
  }
  if (b.usd >= 10_000) return 1;
  if (b.usd >= 2_000) return 0.85;
  if (b.usd >= 500) return 0.6;
  if (b.usd >= 100) return 0.35;
  return 0.15;
}

function money(n: number): string {
  return n >= 1000 ? `$${Math.round(n / 100) / 10}k` : `$${Math.round(n)}`;
}

/** Deterministic, explainable lead assessment. */
export function scoreLead(row: LeadScoreInput, now: Date = new Date()): LeadAssessment {
  const reasons: string[] = [];
  const risks: string[] = [];
  let earned = 0;
  let available = 0;

  // ── Budget
  const budget = parseBudget(row.budget, row.platform);
  const bScore = budget ? budgetScore(budget) : null;
  if (budget && bScore != null) {
    available += LEAD_WEIGHTS.budget;
    earned += LEAD_WEIGHTS.budget * bScore;
    const unit = budget.type === 'hourly' ? '/hr' : '';
    if (bScore >= 0.85) reasons.push(`Strong stated budget (about ${money(budget.usd!)}${unit})`);
    else if (bScore >= 0.6) reasons.push(`Meaningful stated budget (about ${money(budget.usd!)}${unit})`);
    else risks.push(`Low stated budget (about ${money(budget.usd!)}${unit})`);
    if (budget.assumedUsd) {
      risks.push('Currency not stated by the source; USD assumed for comparison');
    }
  } else {
    risks.push('Budget could not be compared — the source stated no amount or no currency');
  }

  // ── Client quality. Absent on every Freelancer row.
  const spend = (row.clientSpend || '').trim();
  const rating = parseFloat((row.clientRating || '').trim());
  const posted = typeof row.jobsPosted === 'number' ? row.jobsPosted : null;
  const hasClient = Boolean(spend) || Number.isFinite(rating) || (posted != null && posted > 0);
  if (hasClient) {
    available += LEAD_WEIGHTS.client;
    let c = 0;
    if (spend) {
      c += 0.4;
      reasons.push(`Client has a published spend history (${spend})`);
    }
    if (Number.isFinite(rating)) {
      if (rating >= 4.5) {
        c += 0.3;
        reasons.push(`Client rated ${rating} by previous freelancers`);
      } else if (rating >= 3.5) {
        c += 0.15;
        reasons.push(`Client rated ${rating}`);
      } else {
        risks.push(`Client rated only ${rating}`);
      }
    }
    if (posted != null && posted > 0) {
      if (posted >= 5) {
        c += 0.3;
        reasons.push(`Repeat hirer — ${posted} jobs posted, so there may be follow-on work`);
      } else {
        c += 0.15;
        reasons.push(`Client has posted ${posted} job${posted === 1 ? '' : 's'}`);
      }
    }
    earned += LEAD_WEIGHTS.client * Math.min(1, c);
  } else {
    // Not a penalty. The dimension simply did not run.
    risks.push('No client history published by this source, so client quality is unassessed');
  }

  // ── Competition
  const comp = competitionObservation(row.proposalCount, row.competitionObservedAt, now);
  if (comp.count != null) {
    available += LEAD_WEIGHTS.competition;
    const n = comp.count;
    let c: number;
    if (n <= 5) c = 1;
    else if (n <= 15) c = 0.7;
    else if (n <= 30) c = 0.4;
    else c = 0.15;
    earned += LEAD_WEIGHTS.competition * c;
    if (c >= 0.7) reasons.push(`Low competition — ${comp.label}`);
    else risks.push(`Heavy competition — ${comp.label}`);
    if (comp.outdated) {
      risks.push('That proposal count is a snapshot from when the listing was scraped and is not refreshed');
    }
  } else {
    risks.push('No proposal count published, so competition is unassessed');
  }

  // ── Clarity of the brief
  const desc = (row.description || '').trim();
  available += LEAD_WEIGHTS.clarity;
  let clarity = 0;
  if (desc.length >= 800) clarity += 0.6;
  else if (desc.length >= 300) clarity += 0.4;
  else if (desc.length >= 120) clarity += 0.2;
  if ((row.skills || '').trim()) clarity += 0.2;
  if ((row.experienceLevel || '').trim()) clarity += 0.2;
  earned += LEAD_WEIGHTS.clarity * Math.min(1, clarity);
  if (clarity >= 0.6) reasons.push('Clear, detailed brief');
  else if (clarity <= 0.2) risks.push('Thin brief — the requirement is not spelled out');

  // ── Freshness
  const fresh = freshnessFactor(row.postedAt, now);
  if (fresh != null) {
    available += LEAD_WEIGHTS.freshness;
    earned += LEAD_WEIGHTS.freshness * fresh;
    if (fresh >= 0.7) reasons.push('Recently posted');
    else if (fresh <= 0.3) risks.push('Posted a while ago — later applicants are usually at a disadvantage');
  } else {
    risks.push('No posting time published, so freshness is unassessed');
  }

  // ── Total
  const totalWeight = Object.values(LEAD_WEIGHTS).reduce((a, b) => a + b, 0);
  const coverage = Number((available / totalWeight).toFixed(2));
  if (coverage < MIN_COVERAGE) {
    // An unscored row must be null, never a fabricated default.
    return { score: null, band: 'insufficient_data', reasons, risks, coverage };
  }

  const score = Math.round((earned / available) * 100);
  const band: LeadBand =
    score >= LEAD_BANDS.high ? 'high'
      : score >= LEAD_BANDS.promising ? 'promising'
        : score >= LEAD_BANDS.moderate ? 'moderate'
          : 'low';

  if (coverage < 0.8) {
    risks.push(
      `Scored on ${Math.round(coverage * 100)}% of the model — the rest of the signals were not published`,
    );
  }

  return { score, band, reasons, risks, coverage };
}
