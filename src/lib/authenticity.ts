import { isSafeExternalUrl } from './safeUrl';

/**
 * Authenticity assessment — deterministic, transparent, and deliberately
 * unwilling to overclaim.
 *
 * No model is involved. Every verdict is a function of fields that are
 * present on the row, and every verdict carries the reason codes that
 * produced it, so the UI can answer "why does this say that?" without
 * guessing.
 *
 * Measured field coverage across the 1,332 live rows, which is what this is
 * built on rather than on what the sources theoretically expose:
 *
 *                          Freelancer (1,134)   Upwork (198)
 *   paymentVerified true            0                0
 *   real client name                0                0
 *   client spend                    0              106
 *   client rating                   0               97
 *   client jobs posted              0               98
 *   country                         0              198
 *   skills                          0              191
 *   experience level                0              198
 *   proposal count                1,134            167
 *   budget stated                 1,134            198
 *   offsite contact in text         36                9
 *   posted in the future             0                0
 *   older than 30 days               0                0
 *
 * Three consequences, each of which shapes a rule below:
 *
 * 1. `paymentVerified` is false on every single row. It is mapped from
 *    `item.clientPaymentVerified` in the Apify adapter, and no stored row has
 *    it true. Whether the actor omits the field or every sampled client is
 *    genuinely unverified cannot be determined from what is stored, because
 *    `rawPayload` keeps only six curated keys and discards the source payload.
 *    So its absence is recorded as "the source did not publish it", NEVER as
 *    "this client is unverified". Treating a field the pipeline may simply be
 *    failing to read as a negative signal would manufacture suspicion.
 *
 * 2. Freelancer rows carry no client signal whatsoever. An assessment that
 *    needs client history to say anything positive would rate 85% of the
 *    inventory as doubtful for a reason that is about the SOURCE, not the job.
 *    Client evidence therefore strengthens a verdict and its absence is a
 *    stated warning, not a penalty.
 *
 * 3. Nothing is ever returned as `verified`. That status is reserved for a
 *    listing whose source URL was actually fetched and found to still exist
 *    and still match. This system does not do that yet — it would cost a
 *    request per listing — so claiming it would be a lie. `supported` is the
 *    strongest verdict this evidence can honestly carry.
 */

export type AuthenticityStatus =
  /** Source URL re-fetched and confirmed. NOT REACHABLE YET — see above. */
  | 'verified'
  /** Coherent, corroborated by more than one independent signal. */
  | 'supported'
  /** Nothing wrong, nothing corroborating. The honest default. */
  | 'uncertain'
  /** At least one active negative signal. */
  | 'suspicious'
  /** Coherent but too old to be a live opportunity. */
  | 'stale'
  /** Structurally unusable — should never reach a job card. */
  | 'rejected';

export type AuthenticitySignal =
  | 'source_native_id'
  | 'resolvable_url'
  | 'coherent_posting_time'
  | 'substantive_description'
  | 'stated_budget'
  | 'competition_data'
  | 'client_spend'
  | 'client_rating'
  | 'client_history'
  | 'skills_listed';

export type AuthenticityWarning =
  | 'missing_title'
  | 'missing_description'
  | 'unusable_url'
  | 'no_source_id'
  | 'future_posting_time'
  | 'no_posting_time'
  | 'short_description'
  | 'offsite_contact_request'
  | 'unstated_budget'
  | 'no_competition_data'
  | 'no_client_data_published'
  | 'payment_verification_not_published'
  | 'proposal_count_at_source_cap'
  | 'stale_posting';

export interface AuthenticityInput {
  title: string;
  description: string;
  url: string;
  budget: string;
  platform: string;
  sourceJobId?: string | null;
  postedAt?: Date | null;
  proposalCount?: number | null;
  clientSpend?: string | null;
  clientRating?: string | null;
  jobsPosted?: number | null;
  skills?: string | null;
  paymentVerified?: boolean | null;
}

export interface AuthenticityAssessment {
  status: AuthenticityStatus;
  signals: AuthenticitySignal[];
  warnings: AuthenticityWarning[];
}

export const AUTHENTICITY_RULES = {
  /** Below this, a description cannot be assessed as substantive. The live
   *  median is well above it: only 20 of 1,332 rows are under 200 chars. */
  substantialDescriptionChars: 200,
  shortDescriptionChars: 120,
  /** Source clocks drift; a listing an hour "ahead" is not a forgery. */
  futureToleranceMs: 60 * 60_000,
  staleDays: 30,
  /** Both sources stop counting here, so the ceiling is a reporting artefact
   *  and not a real competition measurement. */
  proposalCap: 50,
  /**
   * How many CORROBORATING signals lift a listing above `uncertain`.
   *
   * Counting all signals does not work: every well-formed row has a usable
   * URL, a coherent posting time, a substantive description and a stated
   * budget, so any threshold over the full list rates 96.5% of the table
   * `supported` and discriminates nothing. Those four are baseline
   * coherence — the absence of a problem, not evidence for the listing.
   *
   * Corroboration is the evidence that is NOT universal: a source-native id,
   * a competition count, published skills, or any client history. Two of
   * them is the bar.
   */
  corroboratingSignals: 2,
} as const;

/** Signals every well-formed listing has. Their presence means "nothing is
 *  wrong", which is not the same as "this is corroborated". */
const BASELINE_SIGNALS = new Set<AuthenticitySignal>([
  'resolvable_url',
  'coherent_posting_time',
  'substantive_description',
  'stated_budget',
]);

/**
 * Text asking the reader to take the conversation off-platform.
 *
 * This is the one negative signal with real support in the data: 45 of 1,332
 * descriptions match. It is a warning, not a verdict on the client — some
 * legitimate posts mention a tool by name — so it downgrades to `suspicious`
 * rather than `rejected`, and the listing stays visible with its reason shown.
 */
const OFFSITE_CONTACT =
  /\b(whats\s?app|telegram|skype|wechat|signal\s+me)\b|@(gmail|yahoo|hotmail|outlook)\.|(\bcontact\s+me\s+(at|on|via)\b)|\+\d[\d\s().-]{8,}/i;

/** Deterministic authenticity verdict for one listing. */
export function assessAuthenticity(
  row: AuthenticityInput,
  now: Date = new Date(),
): AuthenticityAssessment {
  const signals: AuthenticitySignal[] = [];
  const warnings: AuthenticityWarning[] = [];

  const title = (row.title || '').trim();
  const description = (row.description || '').trim();

  // ── Structural rejection. A row that fails here is not a judgement call:
  // it cannot be presented as an opportunity at all.
  if (!title) warnings.push('missing_title');
  if (!description) warnings.push('missing_description');
  if (!isSafeExternalUrl(row.url)) warnings.push('unusable_url');
  if (warnings.length > 0) {
    return { status: 'rejected', signals, warnings };
  }
  signals.push('resolvable_url');

  // ── Identity
  if (row.sourceJobId) signals.push('source_native_id');
  else warnings.push('no_source_id');

  // ── Time
  let stale = false;
  if (!row.postedAt) {
    warnings.push('no_posting_time');
  } else {
    const ageMs = now.getTime() - row.postedAt.getTime();
    if (ageMs < -AUTHENTICITY_RULES.futureToleranceMs) {
      warnings.push('future_posting_time');
    } else {
      signals.push('coherent_posting_time');
      if (ageMs > AUTHENTICITY_RULES.staleDays * 86_400_000) {
        warnings.push('stale_posting');
        stale = true;
      }
    }
  }

  // ── Content
  if (description.length >= AUTHENTICITY_RULES.substantialDescriptionChars) {
    signals.push('substantive_description');
  } else if (description.length < AUTHENTICITY_RULES.shortDescriptionChars) {
    warnings.push('short_description');
  }
  if (OFFSITE_CONTACT.test(description)) warnings.push('offsite_contact_request');

  // ── Commercial fields
  const budgetStated = Boolean(row.budget) && !/^\s*(negotiable|undetermined)\s*$/i.test(row.budget);
  if (budgetStated) signals.push('stated_budget');
  else warnings.push('unstated_budget');

  if (typeof row.proposalCount === 'number') {
    signals.push('competition_data');
    if (row.proposalCount >= AUTHENTICITY_RULES.proposalCap) {
      warnings.push('proposal_count_at_source_cap');
    }
  } else {
    warnings.push('no_competition_data');
  }

  if ((row.skills || '').trim()) signals.push('skills_listed');

  // ── Client evidence. Absent on every Freelancer row, so its absence is
  // reported and never scored against the listing.
  const spend = (row.clientSpend || '').trim();
  const rating = (row.clientRating || '').trim();
  if (spend) signals.push('client_spend');
  if (rating) signals.push('client_rating');
  if (typeof row.jobsPosted === 'number' && row.jobsPosted > 0) signals.push('client_history');
  if (!spend && !rating && !(typeof row.jobsPosted === 'number' && row.jobsPosted > 0)) {
    warnings.push('no_client_data_published');
  }
  if (row.paymentVerified !== true) {
    // Deliberately phrased as a publishing gap, not as a finding about the
    // client. No stored row has ever had this true.
    warnings.push('payment_verification_not_published');
  }

  // ── Verdict
  if (warnings.includes('offsite_contact_request') || warnings.includes('future_posting_time')) {
    return { status: 'suspicious', signals, warnings };
  }
  // There is deliberately no "thin text + no budget = spam" rule. It reads
  // plausibly, but zero of the 1,332 live rows have an unstated budget, so
  // such a rule would be a guess dressed as a finding and could only ever
  // fire on shapes nobody has observed. Those rows land in `uncertain`, which
  // is precisely what `uncertain` is for, with both warnings attached.
  if (stale) return { status: 'stale', signals, warnings };

  const corroborating = signals.filter(s => !BASELINE_SIGNALS.has(s)).length;
  return {
    status:
      corroborating >= AUTHENTICITY_RULES.corroboratingSignals ? 'supported' : 'uncertain',
    signals,
    warnings,
  };
}
