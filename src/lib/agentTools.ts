import { buildJobFeed, JobFeedItem } from './jobFeed';
import { getRawJobs } from './jobsCache';
import { parseSmartSearch, SmartSearchResult } from '@/app/api/search/route';
import { computeMarketIntelligence } from './marketIntelligence';
import { getHistoricalTrends } from './marketFacts';
import { AGENT_GREETING, AGENT_SUGGESTIONS } from './agentTypes';

/**
 * Server-only types for the Agent tool layer.
 * These are not exported to client components.
 */

/** Compact card the client renders under an agent message. */
export interface AgentJobCard {
  id: string;
  title: string;
  platform: string;
  budget: string;
  score: number;
  proposalCount: number | null;
  postedAt: string;
  country: string;
  clientName: string;
  clientSpend: string;
  paymentVerified: boolean;
  skills: string[];
  repeatClient: boolean;
  repeatClientCount: number;
  actFast: boolean;
  category: string;
}

export type AgentIntent = 'greeting' | 'search' | 'refine' | 'trends' | 'compare' | 'guidance' | 'injection';

export interface AgentSearchResult {
  jobs: AgentJobCard[];
  total: number;
  filtersNote: string;
}

export interface TrendsSnapshot {
  text: string;
  topSkills: { skill: string; count: number }[];
  direction: string;
  avgJobsPerDay7: number;
  totalJobs: number;
}

// Re-export client-safe constants for server-side consumers (like /api/agent)
export { AGENT_GREETING, AGENT_SUGGESTIONS };

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'from', 'of', 'to', 'in', 'on', 'at', 'with',
  'find', 'show', 'me', 'get', 'jobs', 'job', 'recent', 'recently', 'postings', 'posting',
  'list', 'listings', 'any', 'some', 'remote', 'only', 'just', 'please', 'looking', 'for',
]);

export function shapeJobCard(job: JobFeedItem): AgentJobCard {
  return {
    id: job.id,
    title: job.title,
    platform: job.platform,
    budget: job.budget,
    score: job.score,
    proposalCount: job.proposalCount ?? null,
    postedAt: job.postedAt,
    country: job.country || '',
    clientName: job.clientName || '',
    clientSpend: job.clientSpend || '',
    paymentVerified: Boolean(job.paymentVerified),
    skills: Array.isArray(job.skills) ? job.skills.slice(0, 6) : [],
    repeatClient: Boolean(job.repeatClient),
    repeatClientCount: job.repeatClientCount ?? 0,
    actFast: Boolean(job.actFast),
    category: job.category || '',
  };
}

// ── Prompt-injection guard ─────────────────────────────────────────────
// Attempts to hijack the assistant or extract internal details are detected
// before any tool runs and redirected to the assistant's scope.

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (your|the|all|any|previous|prior|above|earlier)/i,
  /forget (your|the|all|any|previous|prior)/i,
  /act as (an?|a)?\s*(unrestricted|unfiltered|another|different|rogue|free)\s*(ai|assistant|bot|gpt|model|chatbot)/i,
  /you are now (an?|a)?\s*(unrestricted|unfiltered|free|another)/i,
  /(show|reveal|print|display|tell).*(system prompt|hidden|internal|instructions|rules|guidelines|configuration)/i,
  /(your|the).*(system prompt|hidden instructions|internal rules|tool definitions|api keys?|credentials|secrets?|database)/i,
  /never mind (the|your|all)/i,
  /disregard (the|your|all|previous)/i,
  /jailbreak|developer mode|dan mode|do anything now|no limits/i,
  /role[ -]?play as (an?|a)? (unrestricted|other|different)/i,
  /simulate .*(bypass|override)/i,
];

const SENSITIVE_TERMS = /(api[\s-]?key|password|credential|secret|token|\.env|database (url|password)|private (key|config)|internal (url|api|tool))/i;

export function looksLikeInjection(text: string): boolean {
  const t = text.slice(0, 500);
  if (INJECTION_PATTERNS.some(re => re.test(t))) return true;
  return SENSITIVE_TERMS.test(t);
}

// ── Intent classification ──────────────────────────────────────────────
// Rule-based on purpose: deterministic, fast, and always resolves to one of
// the platform capabilities. "compare"/"refine" only make sense when a
// working set of results already exists.

export function classifyIntent(text: string, workingCount: number): AgentIntent {
  const lower = text.toLowerCase().trim();
  const words = lower.split(/\s+/).filter(Boolean).length;

  if (looksLikeInjection(text)) return 'injection';

  if (/^(hi|hello|hey|yo|hola|salut|hallo|namaste|good (morning|afternoon|evening))\b/.test(lower) && words <= 5) {
    return 'greeting';
  }

  if (/(trends?|market (overview|direction|intelligence)?|in demand|what (skills|tech|technologies) (should i learn|are hot)|worth learning|busiest|peak (hour|hours|time|day)|overview|insights?|what should i focus|skills? to learn|salary|rates? for|competition (level|trend)|demand now)/i.test(lower)) {
    return 'trends';
  }

  if (workingCount > 0 && /(compare|which (one|is|job|of these|of the)|best|better|recommend|prioritize|top (pick|choice|opportunit)|rank(ed|ing)?|vs\.?|versus|should i (apply|bid|take|focus)|why (this|is|that|are)|explain|analy|review these|first two|last one)/i.test(lower)) {
    return 'compare';
  }

  if (workingCount > 0 && /^(only|just|narrow|refine|show (me )?only|keep|exclude|drop|also|under |over |above |higher (than|budget)|lower|cheaper|expensive|filter)/i.test(lower)) {
    return 'refine';
  }

  if (/(help|how (do|can|to|should)|what can you|what do you do|features?|guide|get started|where (can|do|should)|about (this|the) platform|navigate|use the (platform|app|dashboard)|learn more about)/i.test(lower)) {
    return 'guidance';
  }

  // Default: treat as a search over the live feed.
  return 'search';
}

// ── Filter helpers (shared by search + refine) ─────────────────────────

function matchesKeywords(job: JobFeedItem, terms: string[]): boolean {
  if (!terms.length) return true;
  const hay = `${job.title || ''} ${job.description || ''} ${(job.skills || []).join(' ')}`.toLowerCase();
  return terms.every(t => hay.includes(t));
}

function scoreMatches(job: JobFeedItem, tier: 'high' | 'good' | 'review' | null): boolean {
  if (!tier) return true;
  if (tier === 'high') return job.score >= 70;
  if (tier === 'good') return job.score >= 50 && job.score < 70;
  return job.score < 50;
}

function postedMatches(postedAt: string, window: '24h' | '3d' | '7d' | null): boolean {
  if (!window) return true;
  const ms = new Date(postedAt || 0).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return false;
  const hours = window === '24h' ? 24 : window === '3d' ? 72 : 168;
  return Date.now() - ms < hours * 60 * 60 * 1000;
}

function budgetMatches(job: JobFeedItem, jobType: 'fixed' | 'hourly' | null, maxBid: number | null): boolean {
  if (jobType) {
    const bt = (job.budgetType || '').toLowerCase();
    if (jobType === 'hourly' && !bt.includes('hourly')) return false;
    if (jobType === 'fixed' && !bt.includes('fixed')) return false;
  }
  if (maxBid != null) {
    const num = job.budget.match(/\d[\d,]*/) ? Number(job.budget.match(/\d[\d,]*/)![0].replace(/,/g, '')) : null;
    if (num != null && num > maxBid) return false;
  }
  return true;
}

function applySmartFilters(job: JobFeedItem, f: SmartSearchResult): boolean {
  if (f.platform && job.platform.toLowerCase() !== f.platform.toLowerCase()) return false;
  if (f.country && (job.country || '').toLowerCase() !== f.country.toLowerCase()) return false;
  if (f.client && !(job.clientName || '').toLowerCase().includes(f.client.toLowerCase())) return false;
  if (!scoreMatches(job, f.opportunity)) return false;
  if (!postedMatches(job.postedAt, f.posted)) return false;
  if (!budgetMatches(job, f.jobType, f.maxBid)) return false;
  if (!matchesKeywords(job, extractTerms(f.query))) return false;
  return true;
}

function extractTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(w => w && !STOPWORDS.has(w)).slice(0, 8);
}

export function describeFilters(f: SmartSearchResult, applied: boolean): string {
  const parts: string[] = [];
  if (f.platform) parts.push(`platform ${f.platform}`);
  if (f.opportunity) parts.push(`${f.opportunity} opportunity tier`);
  if (f.jobType) parts.push(`${f.jobType} budget type`);
  if (f.posted) parts.push(`posted in the last ${f.posted.replace('24h', '24 hours').replace('3d', '3 days').replace('7d', '7 days')}`);
  if (f.maxBid != null) parts.push(`budget up to $${f.maxBid}`);
  if (f.country) parts.push(`country ${f.country}`);
  if (f.client) parts.push(`client ${f.client}`);
  const kw = extractTerms(f.query);
  if (kw.length) parts.push(`keywords: ${kw.join(', ')}`);
  return parts.length ? parts.join(' · ') : (applied ? 'current result set' : 'all current listings');
}

/** Search the live feed using the same smart-search parser as the dashboard. */
export async function runJobSearch(rawText: string, limit = 8): Promise<AgentSearchResult> {
  const feed = await buildJobFeed();
  const parsed = parseSmartSearch(rawText);
  const filtered = feed.filter(j => applySmartFilters(j, parsed));
  // Fresh results first, then by score — mirrors the dashboard's default sort.
  const sorted = [...filtered].sort((a, b) => {
    const recency = (Number(b.isNew ? 1 : 0) - Number(a.isNew ? 1 : 0));
    if (recency !== 0) return recency;
    return (b.score || 0) - (a.score || 0);
  });
  return {
    jobs: sorted.slice(0, limit).map(shapeJobCard),
    total: sorted.length,
    filtersNote: describeFilters(parsed, false),
  };
}

/** Refine the current working set with a natural-language follow-up. */
export async function refineWorkingSet(working: AgentJobCard[], rawText: string): Promise<AgentSearchResult> {
  const parsed = parseSmartSearch(rawText);
  const hasFilters = Boolean(
    parsed.platform || parsed.opportunity || parsed.jobType || parsed.posted ||
    parsed.maxBid != null || parsed.country || parsed.client || extractTerms(parsed.query).length,
  );
  if (!hasFilters) {
    return { jobs: working.slice(0, 8), total: working.length, filtersNote: 'no filter detected in that request' };
  }
  // Rebuild full items so filter helpers can inspect budgets/descriptions.
  const feed = await buildJobFeed();
  const byId = new Map(feed.map(j => [j.id, j]));
  const filtered = working
    .map(c => byId.get(c.id))
    .filter((j): j is JobFeedItem => Boolean(j))
    .filter(j => applySmartFilters(j, parsed));
  return {
    jobs: filtered.map(shapeJobCard).slice(0, 8),
    total: filtered.length,
    filtersNote: describeFilters(parsed, true),
  };
}

// ── Trends tool ────────────────────────────────────────────────────────

export async function buildTrendsSnapshot(): Promise<TrendsSnapshot> {
  const raw = await getRawJobs();
  const intel = computeMarketIntelligence(raw);
  const history = await getHistoricalTrends();
  const top = intel.mostActiveSkills.slice(0, 5).map(s => ({ skill: s.skill, count: s.count }));
  const direction = intel.marketDirection === 'rising' ? 'rising' : intel.marketDirection === 'falling' ? 'falling' : intel.marketDirection === 'stable' ? 'stable' : 'not enough data';
  const historyLine = history?.available && history.days.length
    ? ` 21-day history: ${history.days.reduce((a, b) => a + b.count, 0)} total listings tracked, avg ${history.avgProposalsOverall ?? 'n/a'} proposals/listing.`
    : '';
  const text =
    `Market snapshot from ${intel.totalJobs} current listings: ${intel.avgJobsPerDay7} jobs/day over the last 7 days (30-day avg ${intel.avgJobsPerDay30}/day), direction ${direction}. ` +
    `Most requested skills: ${top.map((s, i) => `${i + 1}. ${s.skill} (${s.count})`).join(', ') || 'n/a'}. ` +
    `Platform mix: ${intel.platform.upworkPct}% Upwork, ${intel.platform.freelancerPct}% Freelancer. ` +
    `Competition ${intel.competition.direction === 'insufficient' ? 'not yet measurable' : `${intel.competition.direction} (${intel.competition.directionReason})`}.` +
    historyLine;
  return { text, topSkills: top, direction, avgJobsPerDay7: intel.avgJobsPerDay7, totalJobs: intel.totalJobs };
}

// ── Guidance tool ──────────────────────────────────────────────────────

export const AGENT_GUIDANCE =
  `Lead Hunter monitors live freelance listings from Upwork and Freelancer, scores each opportunity from the real listing signals, and shows budget, competition, client activity, and market trends.

I can:
- Find relevant jobs — tell me a skill or role, e.g. "React Native jobs".
- Filter by time, budget type, budget cap, country, or opportunity tier.
- Analyze a job or compare opportunities and tell you which to prioritize and why.
- Explain the market — skills in demand, posting hours, budget ranges, competition.

Try: "Find me recent Laravel jobs", "Which of these is the best?", "What skills are in demand?"`;

/** Render a working set as compact lines for the LLM to reason over. */
export function serializeJobsForLLM(cards: AgentJobCard[], max = 8): string {
  const lines = cards.slice(0, max).map((c, i) => {
    const parts = [
      `#${i + 1} "${c.title}"`,
      `platform=${c.platform}`,
      `budget=${c.budget}`,
      `score=${c.score}`,
      `proposals=${c.proposalCount ?? 'n/a'}`,
      `posted=${c.postedAt ? new Date(c.postedAt).toISOString().slice(0, 16) : 'unknown'}`,
      `country=${c.country || 'remote/unspecified'}`,
      `skills=${c.skills.length ? c.skills.join(', ') : 'none listed'}`,
    ];
    if (c.clientName) parts.push(`client=${c.clientName}`);
    if (c.clientSpend) parts.push(`clientSpend=${c.clientSpend}`);
    if (c.paymentVerified) parts.push(`paymentVerified=true`);
    if (c.repeatClient) parts.push(`repeatClient=true (${c.repeatClientCount} other listing${c.repeatClientCount === 1 ? '' : 's'})`);
    if (c.actFast) parts.push(`actFast=true (fresh, low proposals)`);
    return parts.join(' | ');
  });
  return lines.join('\n');
}
