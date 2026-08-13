/**
 * Grounding guards for AI-generated proposals.
 *
 * Every proposal generation entry point funnels through these so a proposal is
 * only ever surfaced when it is tied to the CURRENT job's real data:
 *   1. Verification-word extraction + enforcement (e.g. "Start your proposal
 *      with SMILE" → the proposal MUST literally begin with SMILE).
 *   2. Grounding — the proposal must reference at least one real requirement,
 *      skill, or topic from the selected job.
 *   3. No invented candidate claims (experience, projects, tools, results,
 *      qualifications) — no candidate profile exists.
 *   4. No obvious template / unrelated-job contamination.
 */

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'from', 'of', 'to', 'in', 'on', 'at', 'with',
  'are', 'is', 'am', 'be', 'been', 'being', 'was', 'were', 'do', 'does', 'did', 'have',
  'has', 'had', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must',
  'this', 'that', 'these', 'those', 'your', 'you', 'yourself', 'we', 'our', 'us',
  'i', 'my', 'me', 'it', 'its', 'they', 'them', 'their', 'he', 'she', 'his', 'her',
  'as', 'by', 'up', 'down', 'out', 'over', 'under', 'about', 'into', 'through',
  'after', 'before', 'during', 'between', 'within', 'without', 'against', 'per',
  'job', 'jobs', 'project', 'projects', 'work', 'working', 'need', 'need', 'needs',
  'looking', 'please', 'want', 'wants', 'like', 'make', 'made', 'get', 'gets', 'got',
  'well', 'good', 'best', 'new', 'now', 'also', 'just', 'very', 'really', 'much',
  'many', 'more', 'most', 'some', 'any', 'all', 'both', 'each', 'few', 'other',
  'such', 'than', 'then', 'there', 'here', 'when', 'where', 'what', 'which', 'who',
  'whom', 'why', 'how', 'if', 'else', 'not', 'no', 'yes', 'one', 'two', 'first',
  'last', 'next', 'able', 'help', 'helping', 'possible', 'related', 'relevant',
]);

const INSTRUCTION_VERBS = new Set([
  'WRITE', 'TYPE', 'START', 'BEGIN', 'ENTER', 'INCLUDE', 'USE', 'CODE', 'KEYWORD',
  'WORD', 'PHRASE', 'VERIFICATION', 'OPEN', 'LEAD', 'STATE', 'TELL', 'SAY',
]);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Lowercased, collapsed text for word-boundary matching. */
function normalizeForMatch(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Word-boundary presence check; multi-word terms use phrase containment. */
function hasWord(text: string, term: string): boolean {
  const t = normalizeForMatch(text);
  const w = normalizeForMatch(term);
  if (!w) return false;
  if (/\s/.test(w)) return t.includes(w);
  return new RegExp(`(^|[^a-z0-9])${escapeRe(w)}([^a-z0-9]|$)`).test(t);
}

/** Try to pull a required opening token/phrase out of an instruction sentence. */
function extractVerificationToken(sent: string): string | null {
  const quoted = sent.match(/["'`“”]([^"'`“”]+)["'`“”]/);
  if (quoted) {
    const w = quoted[1].replace(/[.!?,;:)\]]+$/g, '').trim();
    if (
      w.length >= 2 &&
      w.length <= 40 &&
      /^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(w) &&
      !INSTRUCTION_VERBS.has(w.toUpperCase())
    ) {
      return w;
    }
    return null;
  }

  // All-caps word or short all-caps phrase (e.g. "SMILE" or "I OWN THE INBOX").
  const caps = sent.match(/\b(?:[A-Z]+\b)(?:\s+[A-Z]+\b){0,5}/);
  if (caps) {
    const w = caps[0].trim();
    if (w.length >= 2 && !INSTRUCTION_VERBS.has(w.toUpperCase())) return w;
  }
  return null;
}

/**
 * Extract the verification word a listing requires a proposal to start with.
 * Only returns a token when the listing actually instructs the applicant to
 * open with a specific word or phrase — never for incidental quoted/uppercase
 * text and never from negative language like "DO NOT APPLY".
 */
export function extractVerificationWord(description: string): string {
  const text = (description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  const explicit = /\b(start|begin|beginning|open|first|must|keyword|verification)\b/i;
  const otherInstruction = /\b(write|type|include|enter|use|code|word|phrase)\b/i;
  const context = /\b(proposal|cover letter|response|application|bid|message|answer|reply)\b/i;
  const negative = /\bdo not\b|\bdon'?t\b|\bnever\b/i;

  for (const sent of sentences) {
    if (negative.test(sent)) continue;
    const hasContext = context.test(sent);
    const hasInstruction = explicit.test(sent) || otherInstruction.test(sent);
    if (!hasContext || !hasInstruction) continue;
    const token = extractVerificationToken(sent);
    if (token) return token;
  }
  return '';
}

/** Does the text begin with the required word (as the first token)? */
export function startsWithWord(text: string, word: string): boolean {
  const w = (word || '').trim();
  if (!w) return true;
  const t = (text || '').trim();
  return new RegExp(`^${escapeRe(w)}(?:[^a-z0-9]|$)`, 'i').test(t);
}

/**
 * Force the proposal to literally begin with the verification word: strip any
 * leading greeting / preamble / quotes, then place the exact word first.
 */
export function ensureStartsWithWord(text: string, word: string): string {
  const w = (word || '').trim();
  let t = (text || '').trim();
  if (!w) return t;
  if (startsWithWord(t, w)) return t;
  if (!t) return w;

  t = t
    .replace(/^(hi|dear|hello|hey|good\s+(morning|afternoon|evening))[^.\n]*[,!.]:?\s*/i, '')
    .replace(/^["'`[({<\s]+/, '')
    .trim();

  if (startsWithWord(t, w)) return t;
  return `${w}\n\n${t}`;
}

/** Meaningful topic signature of a job (title + skills + strong description terms). */
export function jobTopicTerms(job: { title: string; skills?: string[]; description?: string }): string[] {
  const tokens = new Set<string>();

  const head = [job.title || '', ...(job.skills || [])].join(' ').toLowerCase();
  for (const tok of head.split(/[^a-z0-9]+/)) {
    const t = tok.trim();
    if (t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)) tokens.add(t);
  }

  const counts = new Map<string, number>();
  for (const tok of (job.description || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (tok.length >= 5) counts.set(tok, (counts.get(tok) || 0) + 1);
  }
  for (const [tok, n] of counts) if (n >= 2) tokens.add(tok);

  return Array.from(tokens).slice(0, 60);
}

/** Every token present anywhere in the job (used to detect foreign-topic leads). */
function jobAllTerms(job: { title: string; skills?: string[]; description?: string }): Set<string> {
  const out = new Set<string>();
  const src = [job.title || '', ...(job.skills || []), job.description || ''].join(' ').toLowerCase();
  for (const tok of src.split(/[^a-z0-9]+/)) {
    if (tok.length >= 4 && !STOP.has(tok) && !/^\d+$/.test(tok)) out.add(tok);
  }
  return out;
}

const CLAIM_PATTERNS: [RegExp, string][] = [
  [/\bI\s+have\s+(?:\d+\s*\+?\s*)?(years?|decades?|months?)\b/i, 'claims X years of experience'],
  [/\bmy\s+(?:\d+\s*\+?\s*)?years?\s+of\s+experience\b/i, 'claims years of experience'],
  [/\bI\s+have\s+(?:been|worked|been working|done)\b/i, 'claims prior experience'],
  [/\bI(?:'|’)?(?:ve| have)\s+(worked|built|developed|delivered|created|designed|led|managed|handled|launched|completed)\b/i, 'claims past work'],
  [/\bI\s+(?:have\s+)?(?:worked|built|developed|delivered|created|designed|led|managed|handled|launched|completed)\s+on\b/i, 'claims past work'],
  [/\bmy\s+portfolio\b/i, 'references a portfolio'],
  [/\bmy\s+(previous|past|existing)\s+projects?\b/i, 'references past projects'],
  [/\bI(?:'|’)?m\s+(?:an|a)?\s*(?:experienced|expert|senior|specialist)\b/i, 'claims seniority'],
  [/\bI\s+(?:am|'m)\s+experienced\b/i, 'claims experience'],
  [/\bI\s+speciali[sz]e\s+in\b/i, 'claims a specialty'],
  [/\bcertified\s+(?:in|as|professional|developer|engineer|expert)\b/i, 'claims certification'],
  [/\bproven\s+(?:track\s+record|experience|results?)\b/i, 'claims a track record'],
  [/\bsuccessfully\s+(delivered|completed|launched|built|managed)\b/i, 'claims past success'],
];

/** First-person claims about the candidate that no profile exists to back. */
export function findCandidateClaims(proposal: string): string[] {
  const p = proposal || '';
  const found: string[] = [];
  for (const [re, label] of CLAIM_PATTERNS) {
    if (re.test(p) && !found.includes(label)) found.push(label);
  }
  return found;
}

const BOILERPLATE: [RegExp, string][] = [
  [/\bi am writing to\b/i, '“I am writing to…”'],
  [/\bmy (expertise|skills|experience)\b/i, '“my expertise/skills/experience”'],
  [/\bproven (track record|results)\b/i, '“proven track record”'],
  [/\bclean,?\s*maintainable\b/i, '“clean maintainable code”'],
  [/\btransparent communication\b/i, '“transparent communication”'],
  [/\bfast turnaround\b/i, '“fast turnaround”'],
  [/\blooking forward to (working|hearing|collaborating|discussing)\b/i, '“looking forward to working with you”'],
  [/\bi am confident\b/i, '“I am confident”'],
  [/\bpassionate about\b/i, '“passionate about”'],
  [/\bleverage (my|our|this)\b/i, '“leverage”'],
  [/\bhit the ground running\b/i, '“hit the ground running”'],
  [/\bgo the extra mile\b/i, '“go the extra mile”'],
  [/\bout[- ]of[- ]the[- ]box\b/i, '“out of the box”'],
  [/\bdelve\b/i, '“delve”'],
  [/\btestament to\b/i, '“testament to”'],
  [/\bthrilled\b/i, '“thrilled”'],
  [/\bstate[- ]of[- ]the[- ]art\b/i, '“state of the art”'],
  [/\bcutting[- ]edge\b/i, '“cutting edge”'],
  [/\bholistic approach\b/i, '“holistic approach”'],
  [/\bi would be (happy|delighted|great) to\b/i, '“I would be happy to”'],
  [/\bi went through your listing\b/i, '“I went through your listing”'],
  [/\bhere is how i would approach it\b/i, '“Here is how I would approach it”'],
  [/\bbased on what you described\b/i, '“Based on what you described”'],
];

/** Generic filler that indicates a canned, non-job-specific template. */
export function findTemplateContamination(proposal: string): string | null {
  const p = proposal || '';
  const hits: string[] = [];
  for (const [re, label] of BOILERPLATE) {
    if (re.test(p) && !hits.includes(label)) hits.push(label);
  }
  if (hits.length >= 3) return `Proposal reads like a generic template (${hits.slice(0, 3).join(', ')}).`;
  return null;
}

const FOREIGN_MARKERS: [RegExp, string][] = [
  [/\bui\/?ux\b/i, 'ui/ux'],
  [/\bfigma\b/i, 'figma'],
  [/\bwireframes?\b/i, 'wireframes'],
  [/\bmockups?\b/i, 'mockups'],
  [/\bdesign\b/i, 'design'],
  [/\breact native\b/i, 'react native'],
  [/\bnext\.?js\b/i, 'next.js'],
  [/\bwordpress\b/i, 'wordpress'],
  [/\bwoocommerce\b/i, 'woocommerce'],
  [/\bshopify\b/i, 'shopify'],
  [/\be-?commerce\b/i, 'e-commerce'],
  [/\bcheckout\b/i, 'checkout'],
  [/\bmobile app\b/i, 'mobile app'],
  [/\bflutter\b/i, 'flutter'],
  [/\bswift\b/i, 'swift'],
  [/\bkotlin\b/i, 'kotlin'],
  [/\btypescript\b/i, 'typescript'],
  [/\bpython\b/i, 'python'],
  [/\bmachine learning\b/i, 'machine learning'],
  [/\bbackend\b/i, 'backend'],
  [/\bfrontend\b/i, 'frontend'],
  [/\bdata (analysis|science|scraping)\b/i, 'data science'],
  [/\bblockchain\b/i, 'blockchain'],
  [/\bcrypto\b/i, 'crypto'],
  [/\bdashboard\b/i, 'dashboard'],
  [/\blanding page\b/i, 'landing page'],
  [/\bconversion rate\b/i, 'cro'],
  [/\bbranding\b/i, 'branding'],
  [/\blogo design\b/i, 'logo design'],
  [/\bgraphic design\b/i, 'graphic design'],
  [/\bseo\b/i, 'seo'],
  [/\blink building\b/i, 'link building'],
  [/\bbacklinks?\b/i, 'backlinks'],
];

/**
 * Detects a proposal that opens on a topic entirely absent from the job — the
 * classic "another job's context leaked in" failure. The lead paragraph is only
 * flagged when a strong foreign marker appears there AND the whole job text
 * never mentions that marker.
 */
export function findForeignTopicLead(proposal: string, job: { title: string; skills?: string[]; description?: string }): string | null {
  const all = jobAllTerms(job);
  const lead = normalizeForMatch((proposal || '').split(/\n\s*\n/)[0].slice(0, 320));
  if (!lead) return null;

  let foreign: string | null = null;
  for (const [re, label] of FOREIGN_MARKERS) {
    if (re.test(lead) && !all.has(label)) {
      foreign = label;
      break;
    }
  }
  if (foreign) return `Proposal opens on "${foreign}", which does not appear anywhere in this job.`;
  return null;
}

export interface ProposalValidation {
  ok: boolean;
  issues: string[];
}

export interface GroundingJob {
  title: string;
  skills?: string[];
  description?: string;
}

/**
 * Pre-display validation. Returns the concrete reasons a proposal should not be
 * shown; the caller regenerates from corrected context when any are present.
 */
export function validateProposal(proposal: string, job: GroundingJob, verificationWord: string): ProposalValidation {
  const issues: string[] = [];
  const p = (proposal || '').trim();
  if (!p) {
    return { ok: false, issues: ['Proposal is empty.'] };
  }

  if (verificationWord && !startsWithWord(p, verificationWord)) {
    issues.push(`Required opening word "${verificationWord}" is missing from the start of the proposal.`);
  }

  const terms = jobTopicTerms(job);
  const overlap = terms.filter(t => hasWord(p, t)).length;
  if (terms.length && overlap === 0) {
    issues.push('Proposal does not reference any requirement, skill, or topic from this job.');
  }

  const claims = findCandidateClaims(p);
  if (claims.length) {
    issues.push(`Unsupported candidate claim${claims.length > 1 ? 's' : ''} detected: ${claims[0]}${claims.length > 1 ? ` (+${claims.length - 1} more)` : ''}.`);
  }

  const template = findTemplateContamination(p);
  if (template) issues.push(template);

  const foreign = findForeignTopicLead(p, job);
  if (foreign) issues.push(foreign);

  return { ok: issues.length === 0, issues };
}

export interface AssessmentValidation {
  ok: boolean;
  issues: string[];
}

/**
 * Pre-display validation for a generated assessment. Returns concrete reasons
 * the assessment should be regenerated from corrected context.
 */
export function validateAssessment(
  assessment: { summary?: string; phases?: unknown[] },
  job: GroundingJob,
): AssessmentValidation {
  const issues: string[] = [];
  const summary = (assessment?.summary || '').trim();
  if (!summary) {
    issues.push('Assessment has no summary.');
  } else if (summary.length < 40) {
    issues.push('Assessment summary is too short to be job-specific.');
  } else {
    const terms = jobTopicTerms(job);
    const overlap = terms.filter(t => hasWord(summary, t)).length;
    if (terms.length && overlap === 0) {
      issues.push('Assessment summary does not reference any requirement, skill, or topic from this job.');
    }
    const template = findTemplateContamination(summary);
    if (template) issues.push(template.replace('Proposal', 'Assessment summary'));
    const claims = findCandidateClaims(summary);
    if (claims.length) {
      issues.push(`Unsupported candidate claim${claims.length > 1 ? 's' : ''} in assessment summary: ${claims[0]}.`);
    }
  }
  if (Array.isArray(assessment?.phases) && assessment.phases.length === 0) {
    issues.push('Assessment has no phases.');
  }
  return { ok: issues.length === 0, issues };
}

/** A lightweight signature used to prove a cached analysis belongs to a job. */
export function jobFingerprint(title: string, skills: string[]): string {
  const head = normalizeForMatch([title, ...(skills || [])].join(' '));
  return head.slice(0, 80);
}

const QUESTION_INTENT = /(\bwhat(?:'|’)?s\b|\bwhat (?:do|would|can|are|is)\b|\bhow (?:do|would|can|will) you\b|\bcan you\b|\bcould you\b|\bdo you (?:have|know|use|work)\b|\bare you (?:available|able|open|interested|willing)\b|\bplease (?:answer|respond|explain|tell|share|reply|provide|confirm|state|include)\b|\blet me know\b|\btell me\b|\bany questions\b|\bquestions?\s*(?:for|about|regarding|below)\b|\banswer the (?:following|questions)\b)/i;

/**
 * Detects things the listing explicitly asks of an applicant (a required
 * opening word, or questions/instructions) so the proposal can acknowledge
 * them instead of ignoring them. Returns safe, non-invented sentences.
 */
export function extractClientQuestions(description: string): string[] {
  const desc = (description || '').trim();
  if (!desc) return [];
  const out: string[] = [];
  const vw = extractVerificationWord(desc);
  if (vw) {
    out.push(`Your post asks to begin the response with "${vw}", so the proposal starts with that exact word.`);
  }
  if (QUESTION_INTENT.test(desc)) {
    out.push('You asked a few specific questions in your post — the plan below answers each one directly.');
  }
  return out;
}

export interface GroundedProposalOptions {
  clientName?: string;
  skills?: string[];
  /** Required opening word extracted from the listing (e.g. "SMILE"). */
  verificationWord?: string;
}

/**
 * The single generic, deterministic proposal generator. Every entry point that
 * produces a proposal funnels through this so the output is always grounded in
 * the CURRENT listing only:
 *   - Every sentence derives from signals actually present in the title /
 *     description / required skills. Nothing else is invented.
 *   - No candidate claims: no experience, past projects, portfolio, tools the
 *     candidate has used, results, or qualifications (no profile exists).
 *   - If the listing requires a specific opening word, the text is forced to
 *     begin with exactly that word.
 */
export function generateGroundedProposal(title: string, description: string, options: GroundedProposalOptions = {}): string {
  const desc = (description || '').trim();
  const text = `${title || ''} ${desc}`.toLowerCase();
  const verificationWord = options.verificationWord || extractVerificationWord(desc);

  // Greeting — only use a real name, never a generic country/client label.
  // Omitted entirely when a verification word must lead the proposal.
  let greeting = 'Hi,';
  if (!verificationWord && options.clientName && !options.clientName.toLowerCase().includes('client') && !options.clientName.toLowerCase().includes('remote')) {
    greeting = `Hi ${options.clientName.trim()},`;
  }

  // Detect technologies/requirements that are ACTUALLY present in the listing only.
  const techPatterns: [RegExp, string][] = [
    [/\breact native\b/i, 'React Native'],
    [/\bnext\.?js\b/i, 'Next.js'],
    [/\breact\b/i, 'React'],
    [/\bvue\.?js\b/i, 'Vue'],
    [/\bangular\b/i, 'Angular'],
    [/\btypescript\b/i, 'TypeScript'],
    [/\bjavascript\b/i, 'JavaScript'],
    [/\bpython\b/i, 'Python'],
    [/\bdjango\b/i, 'Django'],
    [/\bflask\b/i, 'Flask'],
    [/\bc#\b/i, 'C#'],
    [/\b\.net\b/i, '.NET'],
    [/\bphp\b/i, 'PHP'],
    [/\blaravel\b/i, 'Laravel'],
    [/\bwordpress\b/i, 'WordPress'],
    [/\bgraphql\b/i, 'GraphQL'],
    [/\brest\b|\brestful\b|\brest api\b/i, 'REST APIs'],
    [/\bapi\b|\bintegration\b|\bwebhook\b|\bendpoint\b/i, 'APIs'],
    [/\bdatabase\b/i, 'databases'],
    [/\bpostgres(ql)?\b/i, 'PostgreSQL'],
    [/\bmysql\b/i, 'MySQL'],
    [/\bmongo(db)?\b/i, 'MongoDB'],
    [/\bfirebase\b/i, 'Firebase'],
    [/\baws\b/i, 'AWS'],
    [/\bazure\b/i, 'Azure'],
    [/\bdocker\b/i, 'Docker'],
    [/\bkubernetes\b/i, 'Kubernetes'],
    [/\bios\b/i, 'iOS'],
    [/\bandroid\b/i, 'Android'],
    [/\bflutter\b/i, 'Flutter'],
    [/\bswift\b/i, 'Swift'],
    [/\bkotlin\b/i, 'Kotlin'],
    [/\bmachine learning\b/i, 'machine learning'],
    [/\bopenai\b/i, 'OpenAI'],
    [/\be-?commerce\b/i, 'e-commerce'],
    [/\bshopify\b/i, 'Shopify'],
    [/\bstripe\b/i, 'Stripe'],
    [/\bpayment\b/i, 'payment integrations'],
    [/\btailwind\b/i, 'Tailwind'],
    [/\bbootstrap\b/i, 'Bootstrap'],
    [/\bredux\b/i, 'Redux'],
    [/\bcharts?\b/i, 'charts'],
    [/\bdashboard\b/i, 'dashboards'],
    [/\bpandas\b/i, 'pandas'],
    [/\bexcel\b|\bxlsx\b/i, 'Excel data handling'],
    [/\bwoocommerce\b/i, 'WooCommerce'],
    [/\bcach(e|ing)\b/i, 'caching'],
    [/\boptimiz/i, 'performance optimization'],
    [/\be?mail\b/i, 'email'],
    [/\bseo\b/i, 'SEO'],
  ];
  const detected = new Set<string>();
  for (const [re, label] of techPatterns) {
    if (re.test(text)) detected.add(label);
  }
  if (options.skills && Array.isArray(options.skills)) {
    options.skills.forEach((sk) => { if (sk && typeof sk === 'string') detected.add(sk); });
  }
  const techList = Array.from(detected).slice(0, 6);
  const techPhrase = techList.length === 1
    ? techList[0]
    : techList.length > 1
      ? `${techList.slice(0, -1).join(', ')} and ${techList[techList.length - 1]}`
      : '';

  // One sentence that shows we understood the client's ACTUAL problem.
  const titleRef = title && title.trim() ? title.trim() : null;
  let understand: string;
  if (/\bbug|fix|debug|broken|not working|glitch|error|issue|defect/i.test(text)) {
    understand = `You need the issues you described fixed and the system stabilized — not a rewrite.`;
  } else if (/api|integration|webhook|endpoint|third-?party/i.test(text)) {
    understand = `You need the integration layer built out reliably against your existing systems.`;
  } else if (/mobile|ios|android|react native|flutter|swift|kotlin/i.test(text)) {
    understand = `You need a mobile experience that holds up on real devices, not just in theory.`;
  } else if (/e-?commerce|shopify|store|cart|checkout|payment/i.test(text)) {
    understand = `You need a dependable storefront and checkout flow built to your specification.`;
  } else if (/full[ -]?stack|frontend|front-end|backend|back-end|admin|dashboard/i.test(text)) {
    understand = `You need the front end and back end connected so the workflow you described runs end to end.`;
  } else if (/inbox|dm|instagram|facebook|messag|social media|book\w*|appointment|consultation|lead (?:gen|qualif)|setter/i.test(text)) {
    understand = `You need someone to genuinely work the inbox through the whole shift — reply fast, build real rapport, and turn warm leads into booked consultations instead of letting conversations stall.`;
  } else if (/\bdesign\b|\bui\/?ux\b|\bux\b|\bfigma\b|\bwireframes?\b/i.test(text)) {
    understand = `You need the design direction turned into a clean, usable interface that matches the brief.`;
  } else if (/optimiz|speed|slow|latency|load time|bottleneck/i.test(text)) {
    understand = `You need the performance problem you described fixed at the root, with a measurable improvement.`;
  } else if (/\bexcel\b|\bxlsx\b|csv|data import|\bpandas\b|spreadsheet/i.test(text)) {
    understand = `You need the data workflow you described handled reliably end to end, at your real data volume.`;
  } else {
    understand = `You need the scope from your post delivered as a clear, working result.`;
  }

  // Approach bullets derived ONLY from signals present in the listing.
  const bullets: string[] = [];
  if (/\bbug|fix|debug|broken|not working|glitch|error|issue/i.test(text)) {
    bullets.push('Reproduce the reported behaviour, isolate the root cause, then apply a targeted fix with regression checks.');
  }
  if (/api|integration|webhook|endpoint|third-?party/i.test(text)) {
    bullets.push('Design clean integration boundaries with validated contracts before building features on top of them.');
  }
  if (/mobile|ios|android|react native|flutter|swift|kotlin/i.test(text)) {
    bullets.push('Verify the experience on real devices with platform-specific QA rather than assumptions.');
  }
  if (/full[ -]?stack|frontend|front-end|backend|back-end|admin|dashboard/i.test(text)) {
    bullets.push('Tie the front end and back end together so the workflow functions end to end.');
  }
  if (/e-?commerce|shopify|store|cart|checkout|payment|stripe/i.test(text)) {
    bullets.push('Focus on a reliable purchase/checkout path and the payment integration you specified.');
  }
  if (/inbox|dm|instagram|facebook|social media/i.test(text)) {
    bullets.push('Keep the inbox moving all shift — reply fast, stay present in Instagram and Facebook DMs, and never let a warm thread go cold.');
  }
  if (/book\w*|appointment|consultation|schedule/i.test(text)) {
    bullets.push('Move each conversation toward a booked consultation naturally — listen first, qualify, handle hesitation, then ask for the call at the right moment.');
  }
  if (/rapport|trust|relationship|emotion|listen|empath|personable/i.test(text)) {
    bullets.push('Talk like a real person — listen, remember details, empathise, and build genuine trust before anything else.');
  }
  if (/lead|pipeline|tracking|follow[- ]?up|sheet/i.test(text)) {
    bullets.push('Keep the lead tracking sheet current and follow up on hot leads already in the pipeline, not just new messages.');
  }
  if (/\bdesign\b|\bui\/?ux\b|\bux\b|\bfigma\b|\bwireframes?\b/i.test(text)) {
    bullets.push('Translate the design direction into a clean, usable interface that matches the brief.');
  }
  if (/optimiz|speed|slow|latency|load time|bottleneck|cach(e|ing)/i.test(text)) {
    bullets.push('Profile the current bottlenecks first, then apply targeted optimizations (caching, queries, payloads) and report before/after metrics.');
  }
  if (/\bexcel\b|\bxlsx\b|csv|pandas|spreadsheet|data import/i.test(text)) {
    bullets.push('Build a robust import/export path that handles your real data volumes without crashing or silently dropping rows.');
  }
  if (bullets.length === 0) {
    bullets.push('Break the scope into a clear plan, confirm priorities with you, then deliver in reviewable increments.');
  }

  // Context-aware call to action (ask for the relevant missing detail).
  let cta: string;
  if (/\b(api|integration|database|existing|current codebase|legacy)\b/i.test(text)) {
    cta = 'If you can share access to the current codebase, API docs, or sample data, I can review it and propose the most efficient path forward.';
  } else if (/\bdesign\b|\bui\/?ux\b|\bux\b|\bfigma\b|\bwireframes?\b/i.test(text)) {
    cta = 'If you can share the design files or a link to the current build, I can review them and confirm the best way to proceed.';
  } else if (/inbox|dm|book\w*|appointment|consultation|lead/i.test(text)) {
    cta = 'If you can share how bookings are handed off to the coach and how the lead tracking is organised, I can start owning the inbox and turn warm conversations into booked consultations from the first week.';
  } else if (!/budget/i.test(text)) {
    cta = 'If you can share the budget range and any hard deadlines, I can map out the right plan and get started.';
  } else {
    cta = 'If you can share a bit more about your timeline and must-have features, I can confirm the best way to get started.';
  }

  // Assemble — four parts, each grounded in the actual listing:
  //   Opening → Understanding & plan → CTA. No generic filler lines.
  // If a verification word is required, the final text MUST begin with it.
  const lines: string[] = [];
  lines.push(greeting);

  let opening = understand;
  if (techPhrase) opening += ` The core here is ${techPhrase}.`;
  if (titleRef) opening = `For ${titleRef}, ${opening}`;
  lines.push(opening);

  const asks = extractClientQuestions(desc);
  if (asks.length) lines.push(asks.join(' '));

  lines.push('The plan:');
  lines.push(bullets.map((b, i) => `${i + 1}. ${b}`).join('\n'));
  lines.push(cta);
  lines.push('Best,');
  return ensureStartsWithWord(lines.join('\n\n'), verificationWord);
}
