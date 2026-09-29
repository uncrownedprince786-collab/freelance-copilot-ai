import { getRawJobs, getAppliedSet } from './jobsCache';
import { clientKeyOf } from './marketFacts';
import { compareOpportunities } from './opportunityRanking';
import {
  CompetitionObservation,
  competitionObservation,
  describeAge,
  FreshnessState,
  freshnessFactor,
  freshnessState,
} from './freshness';

/**
 * FRESHNESS MODEL (single source of truth for timestamps):
 *
 * - createdAt  = the moment THIS database first stored the row (Opportunity's
 *   immutable first-seen anchor). Set once at insert and never rewritten on
 *   update, so a listing's DB age is stable for its lifetime. ALL retention
 *   purges (in-memory and DB, JobPipeline + sync route) are keyed on it: a job
 *   is never deleted before it has been in the database 7 days (40 days once
 *   applied), regardless of the source's posting timestamp.
 * - postedAt   = the SOURCE's posting time for the listing (provider
 *   publishTime / submitdate), clamped to never be in the future. Preserved in
 *   Opportunity.rawPayload.postedAt at insert and returned by getRawJobs() for
 *   display / activity charts / adaptive sync cadence. When the source omits it
 *   (or the row predates preservation), createdAt is used.
 * - fetchedAt  = the provider fetch time for that listing. Currently computed
 *   per fetch but NOT persisted; used only during a single pipeline run.
 * - updatedAt  = NOT persisted on Opportunity (schema has no such column).
 *   Because of this, API/UI code must never treat createdAt as "last updated":
 *   a 5-hour-old postedAt does not imply its competition data is 5 h stale.
 * - lastSyncedAt = time of the last successful, non-skipped /api/sync fetch,
 *   stored in SystemKv 'last_sync_successful' and exposed by /api/sync/status.
 *
 * Competition signals (proposalCount / interviewingCount / hiresCount) are the
 * only mutable fields. They are written only when the provider returns a usable
 * value; a missing value never overwrites a stored one (see JobPipeline and
 * ActiveJobRefresher).
 */

/**
 * Enriched job feed shared by the jobs API and the AI agent. Both consumers get
 * the exact same signals (repeat-client, act-fast, budget formatting, etc.) so
 * the agent never reasons over data the dashboard doesn't show.
 */

export interface JobFeedItem {
  id: string;
  title: string;
  description: string;
  url: string;
  platform: string;
  budget: string;
  budgetType?: string;
  score: number;
  viewed: boolean;
  applied: boolean;
  postedAt: string;
  isNew?: boolean;
  country?: string;
  clientName?: string;
  clientSpend?: string;
  clientReviews?: string;
  paymentVerified?: boolean;
  jobsPosted?: number | null;
  memberSince?: string;
  connections?: number;
  proposalCount?: number | null;
  interviewingCount?: number;
  hiresCount?: number;
  category?: string;
  opportunityReason?: string;
  skills?: string[];
  experienceLevel?: string;
  duration?: string;
  clientKey?: string | null;
  repeatClient?: boolean;
  repeatClientCount?: number;
  actFast?: boolean;

  // -- Quality layer ---------------------------------------------------
  //
  // SOURCE FACT vs DERIVED. Everything above this line is either published
  // by the source (title, budget, proposalCount, clientSpend) or a trivial
  // reformat of it. Everything below is this system's own assessment, and
  // the UI must present it that way -- never as something the source said.
  //
  //   leadScore / leadBand    heuristic  (lib/leadScore.ts)
  //   authenticityStatus      heuristic  (lib/authenticity.ts)
  //   duplicateStatus         derived    (lib/duplicates.ts)
  //   freshnessState          derived    (lib/freshness.ts)
  //
  // Reason and risk lists are the explanation for the number beside them.
  // A score must never be rendered without access to them.

  /** 0-100, or null when too little was published to score honestly. */
  leadScore: number | null;
  /** high | promising | moderate | low | insufficient_data */
  leadBand: string;
  leadReasons: string[];
  leadRisks: string[];

  /** verified | supported | uncertain | suspicious | stale | rejected.
   *  The "verified" state is currently unreachable -- lib/authenticity.ts
   *  explains why, and a test enforces it. */
  authenticityStatus: string;
  authenticitySignals: string[];
  authenticityWarnings: string[];

  /** canonical | duplicate | possible_duplicate | independent | unknown */
  duplicateStatus: string;
  duplicateClusterId: string | null;
  /** The cluster member this system treats as the primary record. */
  canonicalJobId: string | null;
  duplicateConfidence: number | null;
  /** Which rule chose the canonical member. Shown instead of asserting
   *  "this is the original job", which cannot be known. */
  canonicalReason: string | null;

  /** just_posted | fresh | active | aging | stale | expired | unknown */
  freshnessState: FreshnessState;
  /** Continuous 0-1 decay, or null when the source published no posting
   *  time. Used for ranking, not for display. */
  freshnessFactor: number | null;
  /** "posted 3 hours ago" -- never implies real-time data. */
  ageLabel: string;
  /**
   * The proposal count WITH the age of the observation. The count is captured
   * shortly after posting and never refreshed, so rendering it bare as
   * "3 proposals so far" states something this system does not know.
   */
  competition: CompetitionObservation;
}

export async function buildJobFeed(): Promise<JobFeedItem[]> {
  const rawJobs = await getRawJobs(500);
  const appliedSet = await getAppliedSet();

  // Repeat-client signal: jobs sharing the same stable client key in the
  // current store. A client posting multiple listings is an active buyer
  // worth prioritizing (and one whose other listings are discoverable).
  // Client names are anonymized by Upwork, so we fall back to a composite
  // fingerprint of spend + jobs-posted count to identify repeat buyers.
  const clientCounts = new Map<string, number>();
  const clientKeys = new Map<string, string | null>();
  for (const job of rawJobs) {
    const nameKey = clientKeyOf(job);
    const spend = typeof job.client === 'object' && job.client?.totalSpent ? String(job.client.totalSpent) : (job.clientSpend || '');
    const posted = typeof job.client === 'object' && job.client?.jobsPosted ? String(job.client.jobsPosted) : '';
    // Composite key: name if available, else spend+posted fingerprint
    const key = nameKey || (spend && posted ? `sp:${spend}:${posted}` : null);
    const jid = job.id || job.url || '';
    if (jid) clientKeys.set(jid, key);
    if (key) clientCounts.set(key, (clientCounts.get(key) || 0) + 1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jobs = rawJobs.map((job: any): JobFeedItem => {
    const jobId = job.id || job.url;
    const isApplied = Boolean(job.applied) || appliedSet.has(jobId) || appliedSet.has(job.url);
    const clientObj = job.client || {};
    const clientKey = clientKeys.get(jobId) || null;
    const totalForClient = clientKey ? (clientCounts.get(clientKey) || 0) : 0;
    const postedMs = new Date(job.postedAt || job.postedDate || 0).getTime();
    const isFresh = Number.isFinite(postedMs) && postedMs > 0 && Date.now() - postedMs < 24 * 60 * 60 * 1000;
    const postedDate = Number.isFinite(postedMs) && postedMs > 0 ? new Date(postedMs) : null;
    // When the proposal count was captured. Never refreshed afterwards, so
    // the observation age is part of the figure's meaning.
    const observedMs = new Date(job.competitionObservedAt || 0).getTime();
    const observedAt = Number.isFinite(observedMs) && observedMs > 0 ? new Date(observedMs) : null;

    // --- Country: only show real countries, never "Remote" or generic
    const rawCountry = job.country || clientObj.country || job.location || '';
    const countryVal = (rawCountry && rawCountry.toLowerCase() !== 'remote') ? rawCountry : '';

    // --- Client name: filter out generic placeholders
    const rawClientName = job.clientName || clientObj.name || job.company || '';
    const genericNames = ['freelancer client', 'upwork client', 'client', ''];
    const clientNameVal = (!rawClientName || genericNames.includes(rawClientName.toLowerCase())) ? '' : rawClientName;

    // --- Budget: handle object vs string. Use the provider's real currency
    // symbol when present; default to "$" (Upwork has no currency field).
    let budgetStr = 'Negotiable';
    if (typeof job.budget === 'object' && job.budget) {
      const sym = job.budget.currency || '$';
      // Trim float noise from source values ("30.0" → "30") without inventing.
      const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
      const rate = job.budget.type === 'hourly' ? '/hr' : '';
      const bMin = Number(job.budget.min);
      const bMax = Number(job.budget.max);
      const bAmt = Number(job.budget.amount);
      const hasMin = Number.isFinite(bMin);
      const hasMax = Number.isFinite(bMax);
      const hasAmt = Number.isFinite(bAmt) && bAmt > 0;
      if (hasAmt) budgetStr = `${sym}${fmt(bAmt)}${rate}`;
      else if (hasMin && hasMax && bMin !== bMax) budgetStr = `${sym}${fmt(bMin)}–${sym}${fmt(bMax)}${rate}`;
      else if (hasMin) budgetStr = `${sym}${fmt(bMin)}${rate}`;
      else if (job.budget.type === 'hourly') budgetStr = 'Hourly';
    } else if (typeof job.budget === 'string' && job.budget) {
      budgetStr = job.budget;
    }

    // --- Budget type label
    const budgetType = (typeof job.budget === 'object' && job.budget?.type)
      ? (job.budget.type === 'hourly' ? 'Hourly Rate' : 'Fixed Price')
      : '';

    // --- Experience Level: clean up "IntermediateLevel" → "Intermediate"
    const expRaw = typeof job.experienceLevel === 'string' ? job.experienceLevel : '';
    const experienceLevel = expRaw
      ? expRaw.replace('Level', '').replace(/([A-Z])/g, ' $1').trim()
      : '';

    // --- Client spend
    let clientSpend = '';
    if (job.clientSpend) clientSpend = job.clientSpend;
    else if (clientObj.totalSpent && clientObj.totalSpent > 0) clientSpend = `$${clientObj.totalSpent.toLocaleString()}`;

    // --- Client rating
    const clientRating = clientObj.rating ? Number(clientObj.rating).toFixed(1) : '';

    // --- Payment verified
    const paymentVerified = clientObj.paymentVerified === true;

    // --- Jobs posted by client
    const jobsPosted = clientObj.jobsPosted || null;

    // --- Member since (from lastActivityAt or fetchedAt as fallback — not available in this data)
    const memberSince = clientObj.memberSince || '';
    // --- Lead category & opportunity reason (derived from pipeline score + client signals)
    const category =
      job.score >= 70 ? 'High'
      : job.score >= 50 ? 'Good'
      : job.score >= 30 ? 'Review'
      : 'Skip';
    const opportunityReason = clientObj.opportunityReason || '';

    return {
      id: jobId,
      title: job.title || '',
      description: job.description || '',
      url: job.url,
      platform: job.platform || (job.source === 'upwork' ? 'Upwork' : job.source === 'freelancer' ? 'Freelancer' : 'Upwork'),
      budget: budgetStr,
      budgetType,
      score: job.score ?? (job.score === 0 ? 0 : 70),
      viewed: job.viewed || false,
      applied: isApplied,
      // Provider posting time. Empty string (not "now") when unknown, so the
      // UI can honestly say "Time unknown" instead of fabricating "Just now".
      postedAt: job.postedAt || job.postedDate || '',
      // Location
      country: countryVal,
      // Client
      clientName: clientNameVal,
      clientSpend,
      clientReviews: clientRating ? `${clientRating}★` : '',
      paymentVerified,
      jobsPosted,
      memberSince,
      category,
      opportunityReason,
      // --- Repeat-client + act-fast signals
      clientKey,
      repeatClient: totalForClient >= 2,
      repeatClientCount: Math.max(totalForClient - 1, 0),
      actFast: isFresh && typeof job.proposalCount === 'number' && job.proposalCount <= 5,
      // Job specifics
      connections: job.connectsRequired || job.connections || 0,
      skills: Array.isArray(job.skills) ? job.skills : [],
      experienceLevel,
      duration: job.duration || '',
      proposalCount: typeof job.proposalCount === 'number' ? job.proposalCount : null,
      interviewingCount: job.interviewingCount || 0,
      hiresCount: job.hiresCount || 0,
      // Meta — "New" badge only for genuinely recent listings (posted within
      // the last 24 h), never for every row.
      isNew: new Date(job.postedAt || job.postedDate || 0).getTime() > Date.now() - 24 * 60 * 60 * 1000,

      // -- Quality layer, straight through from the stored assessment.
      leadScore: typeof job.leadScore === 'number' ? job.leadScore : null,
      leadBand: job.leadBand || 'insufficient_data',
      leadReasons: Array.isArray(job.leadReasons) ? job.leadReasons : [],
      leadRisks: Array.isArray(job.leadRisks) ? job.leadRisks : [],
      authenticityStatus: job.authenticityStatus || 'uncertain',
      authenticitySignals: Array.isArray(job.authenticitySignals) ? job.authenticitySignals : [],
      authenticityWarnings: Array.isArray(job.authenticityWarnings) ? job.authenticityWarnings : [],
      duplicateStatus: job.duplicateStatus || 'unknown',
      duplicateClusterId: job.duplicateClusterId ?? null,
      canonicalJobId: job.canonicalJobId ?? null,
      duplicateConfidence: typeof job.duplicateConfidence === 'number' ? job.duplicateConfidence : null,
      canonicalReason: job.canonicalReason ?? null,

      // -- Freshness, computed at read time because it decays continuously.
      freshnessState: freshnessState(postedDate),
      freshnessFactor: freshnessFactor(postedDate),
      ageLabel: describeAge(postedDate),
      competition: competitionObservation(
        typeof job.proposalCount === 'number' ? job.proposalCount : null,
        observedAt,
      ),
    };
  });

  // Canonical ranking: freshest jobs first, lower known competition within a
  // comparable-freshness tier, then existing opportunity signals. Every
  // consumer (dashboard, filters, pagination, AI agent) inherits the same order.
  return jobs.sort(compareOpportunities);
}

/**
 * Chronological order, and nothing else.
 *
 * "Latest" has to mean latest. The moment it is quietly blended with a
 * quality signal, a user who wants to see what just appeared cannot get it,
 * and the two views collapse into one. Rows whose source published no
 * posting time sort last: an unknown age is not a recent one.
 */
export function byLatest(jobs: JobFeedItem[]): JobFeedItem[] {
  return [...jobs].sort((a, b) => {
    const ta = new Date(a.postedAt || 0).getTime() || 0;
    const tb = new Date(b.postedAt || 0).getTime() || 0;
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Opportunity order: ranked by the explainable lead score.
 *
 * Unscored rows sort last rather than being dropped. A listing the model
 * could not assess is not a bad listing — it is one the source published too
 * little about — and hiding it would be the silent-omission failure the
 * whole quality layer exists to avoid.
 *
 * Ties break on freshness and then on id, so the order is stable across
 * requests. Duplicates are NOT filtered here: that is a view-level decision,
 * and the caller has duplicateStatus to make it.
 */
export function byLeadPotential(jobs: JobFeedItem[]): JobFeedItem[] {
  return [...jobs].sort((a, b) => {
    const sa = a.leadScore ?? -1;
    const sb = b.leadScore ?? -1;
    if (sa !== sb) return sb - sa;
    const fa = a.freshnessFactor ?? -1;
    const fb = b.freshnessFactor ?? -1;
    if (fa !== fb) return fb - fa;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Collapse a duplicate cluster to its canonical member.
 *
 * Only high-confidence duplicates are collapsed. A `possible_duplicate` stays
 * visible, because an uncertain duplicate decision must never silently remove
 * an opportunity — the removed one could be the repost with the better
 * budget. Callers that want everything simply do not call this.
 */
export function collapseDuplicates(jobs: JobFeedItem[]): JobFeedItem[] {
  const present = new Set(jobs.map(j => j.id));
  return jobs.filter(j => {
    if (j.duplicateStatus !== 'duplicate') return true;
    // Keep it if its canonical member is not in this result set, otherwise
    // filtering would drop the opportunity entirely.
    return !j.canonicalJobId || !present.has(j.canonicalJobId);
  });
}
