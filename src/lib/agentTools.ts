import { buildJobFeed, JobFeedItem } from './jobFeed';
import { getRawJobs } from './jobsCache';
import { compareOpportunities } from './opportunityRanking';
import { parseSmartSearch, SmartSearchResult } from '@/app/api/search/route';
import { computeMarketIntelligence } from './marketIntelligence';
import { getHistoricalTrends } from './marketFacts';
import { AGENT_GREETING, AGENT_SUGGESTIONS } from './agentTypes';
import { generateGroundedProposal, validateProposal, extractJobInstructions } from './proposalGrounding';

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
  'actually', 'well', 'ok', 'okay', 'hmm', 'um', 'so', 'now', 'want', 'wants', 'need',
  'needs', 'something', 'some', 'but', 'care', 'anymore', 'anything', 'today', 'there',
  'here', 'really', 'would', 'could', 'should', 'which', 'what', 'why', 'how', 'about',
  'like', 'best', 'top', 'one', 'two', 'first', 'second', 'better', 'good', 'great',
  'think', 'thought', 'opinion', 'choice', 'prefer', 'preference', 'pick', 'choose',
  'value', 'decide', 'decision', 'fit', 'worth', 'interesting', 'thanks', 'thank',
  'look', 'looks', 'sound', 'sounds', 'focus', 'recommend', 'prioritize', 'prioritized',
  'strong', 'stronger', 'strongest', 'experience', 'skills', 'skill', 'budget', 'client',
  'proposals', 'competition', 'competitive', 'platform', 'hourly', 'fixed', 'remote',
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
  // Only an instruction/system override is a hijack — "ignore the budget",
  // "forget the platform filter" and similar constraint/removal phrases are
  // legitimate conversational refinements and must NOT be flagged here.
  /ignore (your|the|all|any|previous|prior|above|earlier).*(instructions?|rules?|guidelines?|prompts?|system)/i,
  /forget (your|all|any|previous|prior).*(instructions?|rules?|guidelines?|prompts?|system)/i,
  /act as (an?|a)?\s*(unrestricted|unfiltered|another|different|rogue|free)\s*(ai|assistant|bot|gpt|model|chatbot)/i,
  /you are now (an?|a)?\s*(unrestricted|unfiltered|free|another)/i,
  /(show|reveal|print|display|tell).*(system prompt|hidden|internal|instructions|rules|guidelines|configuration)/i,
  /(your|the).*(system prompt|hidden instructions|internal rules|tool definitions|api keys?|credentials|secrets?|database)/i,
  /never mind (your|the|all|any|previous|prior).*(instructions?|rules?|guidelines?|prompts?|system)/i,
  /disregard (your|the|all|any|previous|prior).*(instructions?|rules?|guidelines?|prompts?|system)/i,
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

export function classifyIntent(text: string, workingCount: number, hasPriorSets = false): AgentIntent {
  const lower = text.toLowerCase().trim();
  const words = lower.split(/\s+/).filter(Boolean).length;

  if (looksLikeInjection(text)) return 'injection';

  if (/^(hi|hello|hey|yo|hola|salut|hallo|namaste|good (morning|afternoon|evening))\b/.test(lower) && words <= 5) {
    return 'greeting';
  }

  if (/(trends?|market (overview|direction|intelligence)?|in demand|what (skills|tech|technologies) (should i learn|are hot)|worth learning|busiest|peak (hour|hours|time|day)|overview|insights?|what should i focus|skills? to learn|salary|rates? for|competition (level|trend)|demand now)/i.test(lower)) {
    return 'trends';
  }

  if ((workingCount > 0 || hasPriorSets) && /(compare|versus|vs\.?|rank(ed|ing)?|best|better|recommend|prioritize|strong(est|er)?|top (pick|choice|opportunit)|should i (apply|bid|take|focus|pick|go)|would you (pick|choose|apply|bid|take|go|prioritize|consider)|what would you|why (this|is|that|are|would)|explain|analy|review (these|them)|these two|the (first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|next|last|previous|other|one that|top|one)\b|which (one|of these|of the|would|is (the|a)|job|opportunit)|(what|how) about (the|that|them|it)|go (back to|with)\b|this (one|job|opportunit)|that (one|job|opportunit)|more like th(?:is|at|ose)|another (one like|option|one|choice|alternative|opportunity)|(the|that|this) (previous|earlier|first|last) (list|search|set)|from (the )?(previous|earlier|first|last) (list|search|set)|the (marketing|upwork|freelancer|trends?) list|worth (it|applying|applied|a try|my time|while)|is (this|it|that) worth|apply(?:ing)? to (it|this|that|the|\d|which)|a good fit|good fit|least (competition|proposals|budget|competitive)|most (proposals|competitive))/i.test(lower)) {
    return 'compare';
  }

  const stripped = lower.replace(/^(actually|well,|ok|okay|hmm|um|so|now|just)\b[,.!;]*\s*/i, '');
  if (workingCount > 0 && /^(only|just|narrow|refine|show (me )?only|keep|exclude|drop|also|under |over |above |higher (than|budget)|lower|cheaper|expensive|filter|forget (the|about|budget|date|country|platform|skills|filter)|ignore (the|budget|date|country|platform)|stop (looking|filtering|showing|using)|clear (the|all)|remove|never mind|skip|ditch|trim|tighten|limit)/i.test(stripped)) {
    return 'refine';
  }

  // No search signal at all ("What do you think?", "Worth it?", "Anything
  // interesting?") but a working set exists → treat as advice/compare over that
  // set rather than a keyword search that would return NO_RESULTS.
  if (workingCount > 0) {
    const kw = lower.split(/\s+/).filter(w => w && !STOPWORDS.has(w) && !/[\d$€£%]/.test(w)).length;
    if (kw === 0) return 'compare';
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

function parseBudgetAmount(budget: string): number | null {
  const m = (budget || '').match(/\d[\d,]*/);
  return m ? Number(m[0].replace(/,/g, '')) : null;
}

function budgetMatches(job: JobFeedItem, jobType: 'fixed' | 'hourly' | null, maxBid: number | null, minBid: number | null): boolean {
  if (jobType) {
    const bt = (job.budgetType || '').toLowerCase();
    if (jobType === 'hourly' && !bt.includes('hourly')) return false;
    if (jobType === 'fixed' && !bt.includes('fixed')) return false;
  }
  const num = parseBudgetAmount(job.budget);
  if (maxBid != null && num != null && num > maxBid) return false;
  if (minBid != null && num != null && num < minBid) return false;
  return true;
}

function proposalCountMatches(job: JobFeedItem, maxProposals: number | null, lowCompetition: boolean | null): boolean {
  const pc = job.proposalCount;
  if (maxProposals != null && pc != null && pc > maxProposals) return false;
  if (lowCompetition === true && pc != null && pc >= 10) return false;
  if (lowCompetition === false && (pc == null || pc < 10)) return false;
  return true;
}

function excludeMatches(job: JobFeedItem, exclude: string[]): boolean {
  if (!exclude.length) return false;
  const hay = `${job.title || ''} ${job.description || ''} ${(job.skills || []).join(' ')}`.toLowerCase();
  return exclude.some(t => hay.includes(t));
}

function applySmartFilters(job: JobFeedItem, f: SmartSearchResult): boolean {
  if (f.platform && job.platform.toLowerCase() !== f.platform.toLowerCase()) return false;
  if (f.country && (job.country || '').toLowerCase() !== f.country.toLowerCase()) return false;
  if (f.client && !(job.clientName || '').toLowerCase().includes(f.client.toLowerCase())) return false;
  if (!scoreMatches(job, f.opportunity)) return false;
  if (!postedMatches(job.postedAt, f.posted)) return false;
  if (!budgetMatches(job, f.jobType, f.maxBid, f.minBid)) return false;
  if (!proposalCountMatches(job, f.maxProposals, f.lowCompetition)) return false;
  if (excludeMatches(job, f.exclude)) return false;
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
  if (f.minBid != null) parts.push(`budget at least $${f.minBid}`);
  if (f.maxProposals != null) parts.push(`under ${f.maxProposals} proposals`);
  if (f.lowCompetition != null) parts.push(f.lowCompetition ? 'low competition' : 'high competition');
  if (f.country) parts.push(`country ${f.country}`);
  if (f.client) parts.push(`client ${f.client}`);
  if (f.exclude.length) parts.push(`excluding ${f.exclude.join(', ')}`);
  const kw = extractTerms(f.query);
  if (kw.length) parts.push(`keywords: ${kw.join(', ')}`);
  return parts.length ? parts.join(' · ') : (applied ? 'current result set' : 'all current listings');
}

/** Search the live feed using the same smart-search parser as the dashboard. */
export async function runJobSearch(rawText: string, limit = 8): Promise<AgentSearchResult> {
  const feed = await buildJobFeed();
  const parsed = parseSmartSearch(rawText);
  const filtered = feed.filter(j => applySmartFilters(j, parsed));
  // Same underlying opportunity intelligence as the main product: freshest
  // first, lower known competition within a comparable-freshness tier, then
  // existing opportunity signals (see src/lib/opportunityRanking.ts).
  const sorted = [...filtered].sort(compareOpportunities);
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

// ── Result-set memory ──────────────────────────────────────────────────
// The client keeps the last few labeled result sets so cross-set references
// ("the second one from the marketing list", "the previous list") can be
// resolved instead of failing as a fresh search.

export interface AgentResultSet {
  label: string;
  jobs: AgentJobCard[];
}

export function serializeResultSetsForLLM(sets: AgentResultSet[], currentCards: AgentJobCard[], max = 8): string {
  const blocks: string[] = [];
  sets.slice(-3).forEach((set, i) => {
    const label = set.label || `List ${i + 1}`;
    const jobs = set.jobs.slice(0, max);
    const lines = jobs.length
      ? jobs.map((c, j) => `#${j + 1} "${c.title}" (${c.platform}, ${c.budget}, score=${c.score}, proposals=${c.proposalCount ?? 'n/a'})`)
      : ['(empty)'];
    blocks.push(`LIST "${label}":\n${lines.join('\n')}`);
  });
  if (currentCards.length) {
    blocks.push(`CURRENT WORKING LIST (most recent):\n${serializeJobsForLLM(currentCards, max)}`);
  }
  return blocks.join('\n\n');
}

// ── Proposal tool ──────────────────────────────────────────────────────
// Drafts a grounded cover letter for a resolved job and supports a small set
// of deterministic edits. Proposals are ONLY ever grounded in the job's real
// listing data — never fabricated candidate experience.

export interface AgentProposalDraft {
  jobId: string;
  title: string;
  text: string;
  verified: boolean;
  note?: string;
}

const PROPOSAL_ASK =
  /(write|draft|create|generate|prepare|compose|start|make|send|submit|help me (with a|write|prepare|draft))\b.{0,50}?\b(proposal|cover letter|bid|pitch|application|intro)/i;

export function isProposalAsk(text: string): boolean {
  return PROPOSAL_ASK.test(text);
}

export type ProposalEdit = 'shorter' | 'longer' | 'professional' | 'rewrite' | 'trimEnd' | 'add' | 'tone' | 'generic';

export function detectProposalEdit(text: string): ProposalEdit | null {
  const t = text.toLowerCase();
  if (/(shorter|shorten|brief|briefer|condense|concise|tighten|trim|cut down|too long|make it (shorter|briefer|concise))/i.test(t)) return 'shorter';
  if (/(longer|expand|elaborate|add more|more detail|more detailed|make it (longer|more detailed|more in-depth))/i.test(t)) return 'longer';
  if (/(remove|delete|drop|cut)\b.{0,30}\b(sentence|line|paragraph|last|closing)|remove that (last )?sentence|take out/i.test(t)) return 'trimEnd';
  if (/(add|include|mention|highlight|emphasize)\b/i.test(t)) return 'add';
  if (/(more professional|more formal|professional|formal|polish|tone)/i.test(t)) return 'professional';
  if (/(more natural|sound natural|natural|human|casual|less formal|friendlier|conversational)/i.test(t)) return 'tone';
  if (/(rewrite|start over|regenerate|redo|try again|fresh|another version)/i.test(t)) return 'rewrite';
  if (/(edit|change|update|tweak|adjust|modify|revise|improve|make it)/i.test(t)) return 'generic';
  return null;
}

export function resolveProposalTarget(text: string, cards: AgentJobCard[]): AgentJobCard | null {
  if (!cards.length) return null;
  const t = text.toLowerCase();

  const ranked = [...cards].sort((a, b) => b.score - a.score);
  const ordMatch = t.match(/(?:the\s+|#\s*)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|next|last|top|strongest|best|highest|lowest)\b/);
  if (ordMatch) {
    const o = ordMatch[1];
    if (o === 'first' || o === '1st') return cards[0] ?? null;
    if (o === 'second' || o === '2nd') return cards[1] ?? null;
    if (o === 'third' || o === '3rd') return cards[2] ?? null;
    if (o === 'fourth' || o === '4th') return cards[3] ?? null;
    if (o === 'fifth' || o === '5th') return cards[4] ?? null;
    if (o === 'next') return cards[1] ?? null;
    if (o === 'last') return cards[cards.length - 1] ?? null;
    if (o === 'top' || o === 'strongest' || o === 'best' || o === 'highest') return ranked[0] ?? null;
    if (o === 'lowest') return ranked[ranked.length - 1] ?? null;
  }

  // numeric reference: "job #2", "#3", "the 2nd"
  const numMatch = t.match(/#\s*(\d+)|(?:job|one|number|#)\s*(\d+)\b/);
  const n = numMatch ? parseInt(numMatch[1] || numMatch[2] || '', 10) : NaN;
  if (Number.isFinite(n) && n >= 1 && n <= cards.length) return cards[n - 1] ?? null;

  // pronoun reference ("it", "that one", "this one", "the job") → the strongest
  // current opportunity, named in the reply so the user can redirect if needed.
  if (/(\bit\b|that one|this one|the (job|one|listing|opportunit)\b)/.test(t)) return ranked[0] ?? null;

  // title substring (only when the card title is long enough to be specific)
  const byTitle = cards.find(c => {
    const title = c.title.toLowerCase();
    return title.split(/\s+/).length >= 2 && t.includes(title);
  });
  return byTitle ?? null;
}

export async function generateAgentProposal(card: AgentJobCard): Promise<AgentProposalDraft> {
  const feed = await buildJobFeed();
  const job = feed.find(j => j.id === card.id);
  if (!job) {
    return { jobId: card.id, title: card.title, text: '', verified: false, note: 'The job data for this listing is not available right now.' };
  }
  const instructions = extractJobInstructions(job.description || '');
  const verificationWord = instructions.openingWord || '';
  const text = generateGroundedProposal(job.title, job.description || '', {
    clientName: job.clientName,
    skills: job.skills,
    verificationWord: verificationWord || undefined,
    instructions,
  });
  const validation = validateProposal(text, { title: job.title, skills: job.skills, description: job.description }, verificationWord, instructions);
  return {
    jobId: card.id,
    title: card.title,
    text,
    verified: validation.ok,
    note: validation.ok ? undefined : validation.issues[0],
  };
}

/** Deterministic, grounded proposal edits. Longer/professional edits cannot
 *  invent content, so they return the draft unchanged and the caller explains. */
export function applyProposalEdit(draft: AgentProposalDraft, edit: ProposalEdit): AgentProposalDraft {
  if (edit === 'shorter') {
    const sentences = draft.text.split(/(?<=[.!?])\s+/).filter(s => s.trim());
    const head = sentences.slice(0, 2).join(' ').trim();
    const tail = sentences.length > 2 ? sentences[sentences.length - 1].trim() : '';
    const text = tail ? `${head} ${tail}` : head;
    return { ...draft, text };
  }
  if (edit === 'trimEnd') {
    const sentences = draft.text.split(/(?<=[.!?])\s+/).filter(s => s.trim());
    if (sentences.length > 1) {
      return { ...draft, text: sentences.slice(0, -1).join(' ').trim() };
    }
    return { ...draft };
  }
  return { ...draft };
}
