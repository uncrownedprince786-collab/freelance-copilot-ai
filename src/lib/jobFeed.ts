import { getRawJobs, getAppliedSet } from './jobsCache';
import { clientKeyOf } from './marketFacts';

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
}

export async function buildJobFeed(): Promise<JobFeedItem[]> {
  const rawJobs = await getRawJobs(500);
  const appliedSet = await getAppliedSet();

  // Repeat-client signal: jobs sharing the same stable client key in the
  // current store. A client posting multiple listings is an active buyer
  // worth prioritizing (and one whose other listings are discoverable).
  const clientCounts = new Map<string, number>();
  const clientKeys = new Map<string, string | null>();
  for (const job of rawJobs) {
    const key = clientKeyOf(job);
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
    };
  });

  return jobs;
}
