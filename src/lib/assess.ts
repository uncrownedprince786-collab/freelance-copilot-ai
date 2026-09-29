import { assessAuthenticity, AuthenticityInput } from './authenticity';
import { LeadScoreInput, scoreLead } from './leadScore';

/**
 * One pass that turns a stored listing into the values the quality columns
 * hold: authenticity status + reason codes, and lead score + band + reasons +
 * risks.
 *
 * It exists so ingestion and the backfill script cannot drift apart. Both
 * call this; neither has its own copy of the mapping.
 *
 * Reason codes and prose are stored as JSON strings because the columns are
 * `String?` — the schema keeps them as text rather than as a relation, since
 * nothing queries inside them and a join per job card would be the wrong
 * trade on Neon Free.
 */

export interface AssessmentInput extends AuthenticityInput, LeadScoreInput {
  /** When the competition figure was captured. See freshness.ts — it is a
   *  snapshot taken shortly after posting and never refreshed. */
  competitionObservedAt?: Date | null;
}

export interface AssessmentFields {
  authenticityStatus: string;
  authenticitySignals: string;
  authenticityWarnings: string;
  leadScore: number | null;
  leadBand: string;
  leadReasons: string;
  leadRisks: string;
  leadScoredAt: Date;
}

export function assessListing(row: AssessmentInput, now: Date = new Date()): AssessmentFields {
  const authenticity = assessAuthenticity(row, now);
  const lead = scoreLead(row, now);
  return {
    authenticityStatus: authenticity.status,
    authenticitySignals: JSON.stringify(authenticity.signals),
    authenticityWarnings: JSON.stringify(authenticity.warnings),
    leadScore: lead.score,
    leadBand: lead.band,
    leadReasons: JSON.stringify(lead.reasons),
    leadRisks: JSON.stringify(lead.risks),
    leadScoredAt: now,
  };
}

/**
 * How far a stored lead score may drift before it is worth a write.
 *
 * The freshness term decays continuously, so every row's score changes a
 * little every hour. Re-writing 1,332 rows on every sync to move a score from
 * 71 to 70 would be the largest write load in the system and would buy
 * nothing — the bands are 15 points wide. A band change always writes; a
 * score change writes only once it exceeds this.
 */
export const LEAD_SCORE_WRITE_THRESHOLD = 3;

export interface StoredAssessment {
  authenticityStatus: string;
  authenticitySignals: string | null;
  authenticityWarnings: string | null;
  leadScore: number | null;
  leadBand: string | null;
  leadReasons: string | null;
  leadRisks: string | null;
}

/**
 * Is this assessment different enough from what is stored to write?
 *
 * `leadScoredAt` is excluded on purpose: it changes on every run by
 * definition, so including it would make every row always dirty and defeat
 * the whole check.
 */
export function assessmentChanged(stored: StoredAssessment, next: AssessmentFields): boolean {
  if (stored.authenticityStatus !== next.authenticityStatus) return true;
  if ((stored.authenticitySignals ?? '') !== next.authenticitySignals) return true;
  if ((stored.authenticityWarnings ?? '') !== next.authenticityWarnings) return true;
  if ((stored.leadBand ?? '') !== next.leadBand) return true;
  if ((stored.leadReasons ?? '') !== next.leadReasons) return true;
  if ((stored.leadRisks ?? '') !== next.leadRisks) return true;

  const before = stored.leadScore;
  const after = next.leadScore;
  if (before == null && after == null) return false;
  if (before == null || after == null) return true;
  return Math.abs(before - after) >= LEAD_SCORE_WRITE_THRESHOLD;
}
