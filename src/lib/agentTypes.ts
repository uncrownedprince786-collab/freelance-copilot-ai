/**
 * Client-safe types, constants and the DETERMINISTIC ANSWERER for the Agent.
 * This file must not import any server-only modules.
 *
 * Design note — deterministic-first:
 * Retrieval, filtering and intent classification are already deterministic, so
 * most turns can be answered in full from the data the tools retrieved. The
 * answerer below produces those replies directly; the LLM is reserved for the
 * residue (open-ended comparison questions and free-form advice) where it can
 * actually add something. Every reply here cites only values present on the
 * cards or in the market snapshot — nothing is invented.
 */

/** Compact card the client renders under an agent message. */
export interface AgentJobCard {
  id: string;
  title: string;
  platform: string;
  budget: string;
  score: number;
  /**
   * Why this job scores what it scores, from the pipeline's own classifier.
   * Carried with the score so a colour-coded percentage never appears in the
   * UI without its basis.
   */
  opportunityReason: string;
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

export const AGENT_GREETING =
  `Hi! Welcome to Lead Hunter.

I'm your AI assistant. I can help you discover relevant opportunities, understand the freelance market, analyze jobs, and make better decisions using the data on this platform.

How may I help you today?`;

export const AGENT_SUGGESTIONS = [
  'Find me recent React jobs',
  'What skills are in demand?',
  'Which jobs should I prioritize?',
  'Compare the top opportunities',
  'How can I find better opportunities?',
];

/** A labeled result set the agent can reference later ("the first list"). */
export interface AgentResultSet {
  label: string;
  jobs: AgentJobCard[];
}

/** A grounded proposal draft the agent produced for a specific job. */
export interface AgentProposalDraft {
  jobId: string;
  title: string;
  text: string;
  verified: boolean;
  note?: string;
}

export type AgentIntent =
  | 'greeting'
  | 'search'
  | 'refine'
  | 'trends'
  | 'compare'
  | 'guidance'
  | 'advice'
  | 'injection';

/** Where a reply came from. Surfaced in the panel so a provider outage is
 *  visible instead of silent. */
export type AgentSource = 'deterministic' | 'llm';

export const AGENT_GUIDANCE =
  `Lead Hunter monitors live freelance listings from Upwork and Freelancer, scores each opportunity from the real listing signals, and shows budget, competition, client activity, and market trends.

I can:
- Find relevant jobs — tell me a skill or role, e.g. "React Native jobs".
- Filter by time, budget type, budget cap, country, or opportunity tier.
- Analyze a job or compare opportunities and tell you which to prioritize and why.
- Explain the market — skills in demand, posting hours, budget ranges, competition.

Try: "Find me recent Laravel jobs", "Which of these is the best?", "What skills are in demand?"`;

export const INJECTION_REDIRECT =
  `I'm focused on helping you with freelance and job-market decisions — I can't share internal instructions, configuration, or technical details.

I can help you analyze opportunities, find relevant jobs, understand the market, and decide what to focus on. Try asking: "Find me recent React jobs" or "What skills are in demand?"`;

export const COMPARE_NO_CONTEXT =
  `I don't have any opportunities to compare yet. Tell me a skill or role and I'll pull up a ranked set you can compare — for example: "Find me recent Laravel jobs".`;

export const NO_RESULTS = (terms: string) =>
  `I couldn't find current listings matching "${terms}" in the live feed. You can try a different skill, remove filters, or broaden the time range. Want me to show you the top opportunities right now instead?`;

export const EMPTY_INPUT =
  `I'm here to help with freelance opportunities, market trends, and job analysis. Could you tell me what you're looking for? For example: "Find me recent React jobs" or "What skills are in demand?"`;

export const API_ERROR =
  `I'm having trouble reaching the job data right now. Please try again in a moment, or let me know what type of opportunities you're interested in.`;

// ── Deterministic answer shapes ────────────────────────────────────────
// An explicit allowlist. If a turn resolves to one of these, the system can
// answer it completely from retrieved data and no model call is made.

export type DeterministicShape =
  // Whole-intent shapes — always deterministic.
  | 'greeting'
  | 'guidance'
  | 'injection'
  | 'trends'
  | 'no-results'
  | 'compare-no-context'
  | 'compare-no-current-list'
  | 'search-summary'
  | 'refine-summary'
  // Question shapes over an existing working set.
  | 'rank-these'
  | 'why-top-better'
  | 'more-like-this'
  | 'what-to-focus-on'
  | 'why-this-score'
  | 'least-competition'
  | 'highest-budget'
  | 'freshest'
  // Only reachable as a degraded answer when the model was unreachable.
  | 'advice-unavailable';

/**
 * Question shapes over a working set that the system can answer from the card
 * fields alone. Checked in order; the first match wins. Anything that does NOT
 * match here is the residue the LLM is for.
 */
export const COMPARE_QUESTION_SHAPES: { shape: DeterministicShape; pattern: RegExp }[] = [
  {
    shape: 'why-this-score',
    pattern: /\b(why\b[^?]{0,40}\b(score[ds]?|rated|rating|percentage)|what does the (score|percentage|%) mean|how (is|are|do you) (the )?scores? (calculated|computed|worked out|work)|explain the score)\b/i,
  },
  {
    shape: 'why-top-better',
    pattern: /\bwhy\b[^?]{0,60}\b(better|stronger|strongest|best|ahead|higher|top|first|number one|#1|that one|this one)\b|\bwhy (did|do) you (pick|choose|rank|put)\b/i,
  },
  {
    shape: 'more-like-this',
    pattern: /\b(more like (this|that|these|those)|similar (jobs?|ones?|listings?|opportunit\w*)|same kind|anything else like|others like (this|that))\b/i,
  },
  {
    shape: 'what-to-focus-on',
    pattern: /\b(what should i (focus|prioriti[sz]e|do|start with|go for)|what to focus|focus on|where should i start|what deserves)\b/i,
  },
  {
    shape: 'least-competition',
    pattern: /\b(least|lowest|fewest|smallest) (competition|competitive|proposals?|bids?|applicants?)\b|\bleast competitive\b|\bfewest (proposals?|bids?)\b/i,
  },
  {
    shape: 'highest-budget',
    pattern: /\b(highest|biggest|largest|best|most) (budget|paying|pay|money|rate)\b|\bpays? (the )?most\b|\bbest paid\b/i,
  },
  {
    shape: 'freshest',
    pattern: /\b(newest|most recent|freshest|latest|just posted|posted (most )?recently|posted last)\b/i,
  },
  {
    shape: 'rank-these',
    pattern: /^(compare|rank)\b|\b(compare (these|them|the top|those)|rank (these|them)|which (one )?is (the )?(best|strongest)|which should i (apply|bid|pick|prioriti[sz]e|go|take)|which (jobs?|ones?|opportunit\w*) should i|top pick|best (one|job|opportunit\w*)|prioriti[sz]e (these|them|which))\b/i,
  },
];

/**
 * Free-form questions the data cannot answer — general craft/advice questions
 * where a language model genuinely adds value. These bypass the keyword search
 * (which would return no results) and are the main reason the LLM still exists.
 */
export const ADVICE_PATTERNS: RegExp[] = [
  /\bwhat makes (a|an) (good|great|strong|winning|bad|weak)\b/i,
  /\bhow (do|can|should) i (price|charge|bid|quote|write|word|improve|stand out|win|land|get more|negotiate|approach|structure|follow[- ]?up|position|pitch)\b/i,
  /\b(any |some |got )?(tips|advice|best practices?|pointers|guidance) (for|on|about|when)\b/i,
  /\b(give|got) me (some )?(tips|advice)\b/i,
  /\bwhy (do|does|are|is) (my|most|so many) (proposals?|bids?|applications?|clients?)\b/i,
  /\b(what|how) should i (charge|price|say|write|include)\b/i,
  /\bhow (long|much) should (a|my|the) (proposal|cover letter|bid)\b/i,
];

export function looksLikeAdviceQuestion(text: string): boolean {
  return ADVICE_PATTERNS.some(re => re.test(text));
}

export interface DeterministicInput {
  intent: AgentIntent;
  /** The user's last message. */
  text: string;
  /** The working set for this turn (search results, or the carried-over set). */
  cards: AgentJobCard[];
  /** Deterministic market snapshot text, for the trends shape. */
  snapshotText?: string;
  /** Human description of the filters that produced `cards`. */
  filtersNote?: string;
  /** Whether earlier labelled result sets exist in this conversation. */
  hasResultSets?: boolean;
}

/**
 * The allowlist decision: which shape (if any) fully answers this turn.
 * `null` means "the LLM should handle this" — it is the only path that costs a
 * model call.
 */
export function resolveDeterministicShape(input: DeterministicInput): DeterministicShape | null {
  const { intent, cards, hasResultSets = false } = input;

  if (intent === 'greeting') return 'greeting';
  if (intent === 'injection') return 'injection';
  if (intent === 'guidance') return 'guidance';
  if (intent === 'trends') return 'trends';

  // Free-form craft advice: no retrieved data answers it → the model's job.
  if (intent === 'advice') return null;

  if (intent === 'compare') {
    if (cards.length === 0) return hasResultSets ? 'compare-no-current-list' : 'compare-no-context';
    for (const entry of COMPARE_QUESTION_SHAPES) {
      if (entry.pattern.test(input.text)) return entry.shape;
    }
    // An open-ended comparison ("which of these suits a data pipeline job?")
    // is the residue the model is for.
    return null;
  }

  // search / refine
  if (cards.length === 0) return 'no-results';
  return intent === 'refine' ? 'refine-summary' : 'search-summary';
}

/** Does this turn need a model call? Convenience wrapper over the allowlist. */
export function needsLLM(input: DeterministicInput): boolean {
  return resolveDeterministicShape(input) === null;
}

// ── Rendering ──────────────────────────────────────────────────────────

/** Strip the pipeline's `[HIGH OPPORTUNITY] ` classification prefix. */
function cleanReason(reason: string): string {
  return (reason || '').replace(/^\s*\[[^\]]*\]\s*/, '').trim();
}

/**
 * The observable basis for a card's score. Uses the pipeline's own reason when
 * it exists, otherwise restates only signals actually present on the card. It
 * never asserts anything that is not in the data.
 */
export function opportunityBasis(card: AgentJobCard): string {
  const stated = cleanReason(card.opportunityReason || '');
  if (stated) return stated;

  const bits: string[] = [];
  if (card.actFast) bits.push('fresh with low competition');
  if (card.proposalCount != null) bits.push(`${card.proposalCount} proposal${card.proposalCount === 1 ? '' : 's'} so far`);
  if (card.paymentVerified) bits.push('payment verified');
  if (card.repeatClient) {
    bits.push(card.repeatClientCount > 0
      ? `repeat client with ${card.repeatClientCount} other open listing${card.repeatClientCount === 1 ? '' : 's'}`
      : 'repeat client');
  }
  if (card.clientSpend) bits.push(`client spend ${card.clientSpend}`);
  if (bits.length) return bits.join(', ');
  return 'the listing signals only — no client history is published for it';
}

/** "Title" (Platform, budget, score% — basis) */
function describeCard(card: AgentJobCard): string {
  return `"${card.title}" (${card.platform}, ${card.budget}, ${card.score}% — ${opportunityBasis(card)})`;
}

function byScore(cards: AgentJobCard[]): AgentJobCard[] {
  return [...cards].sort((a, b) => b.score - a.score);
}

function parseBudget(budget: string): number | null {
  const m = (budget || '').match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function postedMs(card: AgentJobCard): number {
  const ms = new Date(card.postedAt || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function plural(n: number): string {
  return n === 1 ? 'y' : 'ies';
}

function renderWhyTopBetter(ranked: AgentJobCard[]): string {
  const top = ranked[0];
  if (ranked.length < 2) {
    return `There's only one opportunity in the current set, so there's nothing to rank it against. ${describeCard(top)}.`;
  }
  const second = ranked[1];
  const reasons: string[] = [];
  if (top.score > second.score) reasons.push(`a higher opportunity score (${top.score}% vs ${second.score}%)`);
  if (top.proposalCount != null && second.proposalCount != null && top.proposalCount < second.proposalCount) {
    reasons.push(`fewer proposals (${top.proposalCount} vs ${second.proposalCount})`);
  }
  if (top.paymentVerified && !second.paymentVerified) reasons.push('verified payment');
  if (top.clientSpend && !second.clientSpend) reasons.push('published client spend history');
  if (top.repeatClient && !second.repeatClient) reasons.push('a repeat client with other open listings');
  if (top.actFast && !second.actFast) reasons.push('the act-fast signal (fresh, low competition)');
  const reasonStr = reasons.length
    ? reasons.join(', ')
    : `a higher score on the same signals (${opportunityBasis(top)})`;
  return `The top pick is ${describeCard(top)}. It's ahead of "${second.title}" on: ${reasonStr}. Open it for the full assessment and a tailored proposal.`;
}

function renderMoreLikeThis(ranked: AgentJobCard[]): string {
  const top = ranked[0];
  const similar = ranked.filter(j => j !== top && j.platform === top.platform).slice(0, 3);
  if (similar.length) {
    const titles = similar.map(s => `"${s.title}" (${s.score}% — ${opportunityBasis(s)}, ${s.budget})`).join(', ');
    const skill = top.skills.filter(Boolean)[0];
    return `More ${top.platform} listings from this set, closest to "${top.title}": ${titles}. They're on the same platform with a comparable budget range.${skill ? ` Want me to filter by a specific skill (e.g. "${skill}") or by budget?` : ' Want me to filter by budget?'}`;
  }
  return `The top match is ${describeCard(top)}. Nothing else in this set is on ${top.platform} with a similar profile — try broadening to all platforms, or name a skill and I'll run a fresh search.`;
}

function renderWhatToFocusOn(ranked: AgentJobCard[]): string {
  const top = ranked[0];
  const highScore = ranked.filter(j => j.score >= 70);
  const lowComp = ranked.filter(j => j.proposalCount != null && j.proposalCount <= 10);
  const verified = ranked.filter(j => j.paymentVerified);
  const fast = ranked.filter(j => j.actFast);
  const tips: string[] = [];
  if (highScore.length) tips.push(`${highScore.length} scoring 70%+`);
  if (lowComp.length) tips.push(`${lowComp.length} with 10 proposals or fewer`);
  if (verified.length) tips.push(`${verified.length} with verified payment`);
  if (fast.length) tips.push(`${fast.length} flagged act fast (fresh + low competition)`);
  const head = tips.length
    ? `Of the ${ranked.length} in front of you: ${tips.join('; ')}.`
    : `None of the ${ranked.length} in front of you carry a standout signal — no high scores, low proposal counts, or verified-payment flags in this set.`;
  return `${head} The strongest by its own signals is ${describeCard(top)}${top.actFast ? ' — and it is flagged act fast' : ''}.`;
}

function renderWhyThisScore(ranked: AgentJobCard[]): string {
  const top = ranked[0];
  const lines = ranked.slice(0, 3).map(c => `- "${c.title}" — ${c.score}%: ${opportunityBasis(c)}`);
  return `The percentage is this listing's own opportunity score, computed from the listing's published signals (freshness, proposal count, budget, client history). It is not a match against you — no freelancer profile exists on this platform, so nothing here can measure personal fit.\n\n${lines.join('\n')}\n\nOpen ${`"${top.title}"`} for the full per-signal breakdown.`;
}

function renderLeastCompetition(cards: AgentJobCard[]): string {
  const known = cards.filter(c => c.proposalCount != null);
  if (!known.length) {
    return `None of these ${cards.length} listings publish a proposal count, so I can't rank them by competition. I can rank them by score, budget, or how recently they were posted instead.`;
  }
  const sorted = [...known].sort((a, b) => (a.proposalCount ?? 0) - (b.proposalCount ?? 0));
  const best = sorted[0];
  const unknown = cards.length - known.length;
  const rest = sorted.slice(1, 3).map(c => `"${c.title}" (${c.proposalCount})`).join(', ');
  return `Lowest competition: ${describeCard(best)} with ${best.proposalCount} proposal${best.proposalCount === 1 ? '' : 's'}.${rest ? ` Next: ${rest}.` : ''}${unknown > 0 ? ` ${unknown} listing${unknown === 1 ? '' : 's'} in this set publish${unknown === 1 ? 'es' : ''} no proposal count, so ${unknown === 1 ? 'it is' : 'they are'} not ranked here.` : ''}`;
}

function renderHighestBudget(cards: AgentJobCard[]): string {
  const withBudget = cards
    .map(c => ({ card: c, amount: parseBudget(c.budget) }))
    .filter((x): x is { card: AgentJobCard; amount: number } => x.amount != null);
  if (!withBudget.length) {
    return `None of these ${cards.length} listings state a numeric budget — they're negotiable or unspecified, so I can't rank them by pay. I can rank them by score, competition, or recency instead.`;
  }
  const sorted = withBudget.sort((a, b) => b.amount - a.amount);
  const best = sorted[0].card;
  const unknown = cards.length - withBudget.length;
  const rest = sorted.slice(1, 3).map(x => `"${x.card.title}" (${x.card.budget})`).join(', ');
  return `Highest stated budget: ${describeCard(best)}.${rest ? ` Next: ${rest}.` : ''}${unknown > 0 ? ` ${unknown} listing${unknown === 1 ? '' : 's'} state no numeric budget, so ${unknown === 1 ? 'it is' : 'they are'} not ranked here.` : ''} Note this is the listing's stated budget, not a negotiated rate.`;
}

function renderFreshest(cards: AgentJobCard[]): string {
  const dated = cards.filter(c => postedMs(c) > 0);
  if (!dated.length) {
    return `None of these ${cards.length} listings carry a usable posting timestamp, so I can't order them by recency.`;
  }
  const sorted = [...dated].sort((a, b) => postedMs(b) - postedMs(a));
  const newest = sorted[0];
  const rest = sorted.slice(1, 3).map(c => `"${c.title}"`).join(', ');
  return `Most recently posted: ${describeCard(newest)}, posted ${new Date(newest.postedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC.${rest ? ` Then: ${rest}.` : ''} Fresh listings usually mean fewer proposals ahead of you.`;
}

function renderRankThese(cards: AgentJobCard[]): string {
  const ranked = byScore(cards);
  const top = ranked[0];
  const count = cards.length;
  const extras: string[] = [];
  if (top.proposalCount != null) extras.push(`${top.proposalCount} proposal${top.proposalCount === 1 ? '' : 's'} so far`);
  if (top.paymentVerified) extras.push('payment verified');
  if (top.actFast) extras.push('act fast');
  return `I have ${count} opportunit${plural(count)} in front of me. The strongest by its own signals is ${describeCard(top)}${extras.length ? ` — ${extras.join(', ')}` : ''}. The cards below stay in that order, strongest first. Open the top one for the full assessment and a tailored proposal.`;
}

function renderSearchSummary(input: DeterministicInput): string {
  const count = input.cards.length;
  const note = input.filtersNote && input.filtersNote !== 'all current listings' ? ` matching ${input.filtersNote}` : '';
  return `I found ${count} opportunit${plural(count)}${note}. They're ranked by each job's own opportunity signals — freshness, competition, budget and client history — strongest first. Open a job to see its full assessment and generate a tailored proposal.`;
}

function renderRefineSummary(input: DeterministicInput): string {
  const count = input.cards.length;
  if (input.filtersNote === 'no filter detected in that request') {
    return `I didn't spot a filter in that, so the ${count} opportunit${plural(count)} below are unchanged. Try something like "only hourly", "under $500", "Upwork only", or name a skill.`;
  }
  return `That leaves ${count} opportunit${plural(count)}${input.filtersNote ? ` (${input.filtersNote})` : ''}. Same ranking as before — each job's own signals, strongest first.`;
}

/**
 * Render a reply for a shape. Everything it states is read off the cards, the
 * snapshot, or the filter description — there is no generative step.
 */
export function renderDeterministicReply(shape: DeterministicShape, input: DeterministicInput): string {
  const ranked = byScore(input.cards);

  switch (shape) {
    case 'greeting':
      return AGENT_GREETING;
    case 'guidance':
      return AGENT_GUIDANCE;
    case 'injection':
      return INJECTION_REDIRECT;
    case 'trends':
      return input.snapshotText || 'Market intelligence is still being computed — check back after the next sync.';
    case 'compare-no-context':
      return COMPARE_NO_CONTEXT;
    case 'compare-no-current-list':
      return `I don't have a fresh list to rank on this turn, but I did show you earlier result sets — tell me which list or job you'd like me to compare (e.g. "the first list").`;
    case 'no-results':
      return NO_RESULTS(input.text.replace(/<[^>]*>/g, ' ').trim().slice(0, 80) || 'that request');
    case 'search-summary':
      return renderSearchSummary(input);
    case 'refine-summary':
      return renderRefineSummary(input);
    case 'why-top-better':
      return renderWhyTopBetter(ranked);
    case 'more-like-this':
      return renderMoreLikeThis(ranked);
    case 'what-to-focus-on':
      return renderWhatToFocusOn(ranked);
    case 'why-this-score':
      return renderWhyThisScore(ranked);
    case 'least-competition':
      return renderLeastCompetition(input.cards);
    case 'highest-budget':
      return renderHighestBudget(input.cards);
    case 'freshest':
      return renderFreshest(input.cards);
    case 'rank-these':
      return renderRankThese(input.cards);
    case 'advice-unavailable':
      return `I can't reach the AI model right now, so I can't answer that one — it's a judgement question rather than something the listing data answers. What I can still do from live data: find and filter opportunities, rank them, explain any score, and draft a grounded proposal. Want me to pull up current listings for a skill?`;
  }
}

/**
 * Always returns a reply. Used both for allowlisted shapes and as the honest
 * degraded answer when a model call was attempted and every provider failed.
 */
export function deterministicReply(input: DeterministicInput): string {
  const shape = resolveDeterministicShape(input);
  if (shape) return renderDeterministicReply(shape, input);
  // Residue that was meant for the LLM. Give the best data-backed answer there
  // is rather than nothing.
  if (input.intent === 'advice') return renderDeterministicReply('advice-unavailable', input);
  if (input.cards.length === 0) return renderDeterministicReply('compare-no-context', input);
  return renderDeterministicReply('rank-these', input);
}
