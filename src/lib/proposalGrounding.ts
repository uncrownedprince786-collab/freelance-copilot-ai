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

/** Words too generic to be a client-required keyword on their own. */
const GENERIC_TOKENS = new Set([
  'a','an','the','and','or','of','to','in','on','at','with','for','from','by','as','is','are','was','were',
  'your','you','yourself','my','me','i','we','our','us','it','its','this','that','these','those','there','here',
  'please','must','will','would','could','should','can','may','might','do','does','did','not','no','yes','so','then','than','if','but',
  'be','been','being','have','has','had','very','just','also','only','one','two','first','last','next','word','phrase','keyword','code','verification',
  'start','begin','end','open','include','type','write','enter','use','with','say','tell','state','lead','question','questions','answer','reply',
  'proposal','cover','letter','response','application','bid','message','submission','applicant','job','project','work',
]);

const TOKEN_CHARSET = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;
const TOKEN_TAIL = /[.!?,;:)\]"'`]+$/;
/** Words that signal the client is requiring an ENDING word/phrase. */
const END_MARKER = /\b(end|ending|finish|conclude|close|last|sign[- ]off)\b/i;
/** Sentences that state a format/application instruction (subject line, format, attachment, apply-via, etc.). */
const FORMAT_RE = /\b(subject (?:line)?|in the subject|format(?:ted)? (?:as|in|like)|in (?:a |the )?[a-z ]{0,24}format|attach(?:ed)?|\.pdf|word count|minimum words?|apply (?:only )?(?:through|via)|to apply|how to apply|application instructions?|answer the following)\b/i;

/**
 * Pull a required token/phrase out of an instruction sentence. Accepts quoted
 * tokens, all-caps runs, "the word/phrase/keyword X" markers, and a capitalized
 * token after "with/use". Returns null when the sentence does not clearly name
 * a specific token — so "end with a question" or "start with a greeting" never
 * produce a fake keyword.
 */
function extractInstructionToken(sent: string): string | null {
  const quoted = sent.match(/["'`“”]([^"'`“”]+)["'`“”]/);
  if (quoted) {
    const w = quoted[1].replace(TOKEN_TAIL, '').trim();
    if (
      w.length >= 2 &&
      w.length <= 40 &&
      TOKEN_CHARSET.test(w) &&
      !INSTRUCTION_VERBS.has(w.toUpperCase())
    ) {
      return w;
    }
  }

  // All-caps word or short all-caps phrase (e.g. "SMILE", "I READ YOUR LISTING").
  const caps = sent.match(/\b(?:[A-Z]{2,}\b|I\b)(?:\s+(?:[A-Z]{2,}|[AI])\b){0,5}/);
  if (caps) {
    const w = caps[0].trim();
    const hasStrong = w.split(/\s+/).some(tok => /[A-Z]{2,}/.test(tok));
    if (hasStrong && w.length >= 2 && !INSTRUCTION_VERBS.has(w.toUpperCase())) return w;
  }

  // "the word X" / "code word X" / "phrase X" / "keyword X" — capture the named
  // token only (bounded, so trailing prose like "in your proposal" never leaks).
  const marked = sent.match(/\b(?:the\s+)?(?:code\s+)?(?:word|phrase|keyword)\s+["'`“”]?([A-Za-z0-9][A-Za-z0-9 _-]*?)["'`“”]?(?=\s+(?:in|to|of|and|as|for|on|at|with|somewhere|anywhere|when|if|please|must|should|the|your|you|then|from|during|by|before|after|first|end|start|we|so|also)\b|[.!?;,]$|$)/i);
  if (marked) {
    const w = marked[1].replace(TOKEN_TAIL, '').trim();
    const lower = w.toLowerCase();
    if (
      w.length >= 2 &&
      w.length <= 40 &&
      TOKEN_CHARSET.test(w) &&
      !INSTRUCTION_VERBS.has(w.toUpperCase()) &&
      !GENERIC_TOKENS.has(lower)
    ) {
      return w;
    }
  }

  // Capitalized token at the end after with/use: "Start your proposal with Hello".
  const title = sent.match(/\b(?:with|use)\s+(?:the\s+(?:word|phrase|keyword)\s+)?([A-Z][A-Za-z0-9-]{1,39})\s*[.;,!]?$/i);
  if (title) {
    const w = title[1].trim();
    if (w.length >= 2 && !INSTRUCTION_VERBS.has(w.toUpperCase()) && !GENERIC_TOKENS.has(w.toLowerCase())) return w;
  }

  return null;
}

export type InstructionKind =
  | 'openingWord'
  | 'endingWord'
  | 'keyword'
  | 'question'
  | 'experience'
  | 'action'
  | 'format';

export interface ClientInstruction {
  kind: InstructionKind;
  /** The instruction sentence as the client wrote it (trimmed). */
  raw: string;
  /** Human-readable requirement, safe to paste into an AI prompt. */
  requirement: string;
  /** Significant tokens of the requirement, used for cheap compliance checks. */
  tokens?: string[];
}

export interface ExtractedInstructions {
  openingWord: string;
  endingWord: string;
  keywords: string[];
  questions: string[];
  experiences: string[];
  actions: string[];
  formats: string[];
  list: ClientInstruction[];
}

function cleanSentence(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Meaningful (non-stop, non-generic) tokens of a phrase, for compliance checks. */
function significantTokens(phrase: string): string[] {
  const out: string[] = [];
  for (const tok of phrase.toLowerCase().split(/[^a-z0-9]+/)) {
    if (tok.length >= 4 && !STOP.has(tok) && !GENERIC_TOKENS.has(tok)) out.push(tok);
  }
  return out;
}

function extractExperiencePhrase(sent: string): string | null {
  const m = sent.match(/\b((?:\d+\+?|\d+-\d+)\s*(?:years?|yrs)\s*(?:\+|more|of)?\s+(?:of\s+)?(?:hands-on\s+|relevant\s+)?experience[^.!?]{0,80})/i)
    || sent.match(/\b((?:experience|expertise|background|hands-on)\s+(?:working\s+|building\s+|developing\s+|with\s+)?[^.!?\n]{0,80})/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

/**
 * Detect every explicit instruction the listing gives to an applicant — the
 * required opening word, required ending word, keywords to include, questions
 * to answer, a stated experience bar, requested actions, and format or
 * application requirements. Reads the whole description so an instruction at
 * the end is honored as reliably as one at the top.
 */
export function extractJobInstructions(description: string): ExtractedInstructions {
  const empty: ExtractedInstructions = {
    openingWord: '', endingWord: '', keywords: [], questions: [], experiences: [], actions: [], formats: [], list: [],
  };
  const text = (description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return empty;

  const out: ExtractedInstructions = { ...empty };
  const add = (ins: ClientInstruction) => { out.list.push(ins); };

  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map(cleanSentence).filter(Boolean);
  const negative = /\bdo not\b|\bdon'?t\b|\bnever\b|\bavoid\b/i;
  const applicantContext = /\b(proposal|cover letter|response|application|bid|message|answer|reply|submission|applicant)\b/i;

  for (const sent of sentences) {
    if (negative.test(sent)) continue;

    // ── Required opening word ──
    if (!out.openingWord) {
      const startPos = /\b(start|begin|beginning|open|first|very first|1st|leading|to begin|to start)\b/i.test(sent);
      const instrVerb = /\b(start|begin|open|first|must|keyword|verification|type|write|enter|include|use|code|word|phrase)\b/i.test(sent);
      const startMarker = /\b(first (word|line|sentence|letter)|to begin|to start|start off)\b/i.test(sent);
      if (startPos && instrVerb && (applicantContext.test(sent) || startMarker)) {
        const token = extractInstructionToken(sent);
        if (token) {
          out.openingWord = token;
          add({ kind: 'openingWord', raw: sent, requirement: `Start the proposal with the word "${token}" — it must be the very first text.`, tokens: significantTokens(token) });
          // Deliberately no continue: the same sentence can also require an
          // ending word ("start with X and end with Y").
        }
      }
    }

    // ── Required ending word ──
    if (!out.endingWord) {
      const endPos = END_MARKER.test(sent);
      if (applicantContext.test(sent) && endPos) {
        // Extract from the END-CLAUSE (last end-marker onward) so a compound
        // sentence like "start with X and end it with Y" yields Y here, not X.
        let endIdx = -1;
        const endRe = /\b(end|ending|finish|conclude|close|last|sign[- ]off)\b/gi;
        let m: RegExpExecArray | null;
        while ((m = endRe.exec(sent)) !== null) endIdx = m.index;
        const clause = endIdx >= 0 ? sent.slice(endIdx) : sent;
        const token = extractInstructionToken(clause);
        if (token) {
          out.endingWord = token;
          add({ kind: 'endingWord', raw: sent, requirement: `End the proposal with the word "${token}" — it must be the final text.`, tokens: significantTokens(token) });
          // Deliberately no continue: the same sentence can also carry other
          // instructions (keyword/question) after the ending clause.
        }
      }
    }

    // ── Keyword anywhere in the proposal ──
    const notPositioned = !/\b(first (word|line|sentence)|to begin|to start|start|begin)\b/i.test(sent)
      && !/\b(end|finish|conclude|close|last|sign[- ]off)\b/i.test(sent);
    if (out.keywords.length < 3 && applicantContext.test(sent) && notPositioned
      && /\b(include|contain|keyword|mention|put|enter|write|type|use|add|somewhere|anywhere)\b/i.test(sent)
      && !FORMAT_RE.test(sent)) {
      const token = extractInstructionToken(sent);
      if (token) {
        out.keywords.push(token);
        add({ kind: 'keyword', raw: sent, requirement: `Include the word "${token}" in the proposal.`, tokens: significantTokens(token) });
        // Deliberately no continue: a keyword sentence can also ask a question
        // ("include the word X and tell us about ...").
      }
    }

    // ── Applicant-directed question ──
    if (out.questions.length < 5) {
      const trimmed = sent.trim();
      const isQuestion = (/[?]\s*$/.test(trimmed) && /\b(you|your|yours)\b/i.test(trimmed))
        || (/\b(tell|share|describe|explain|answer|send|provide|mention|state|list|give|include)\s+(us|me)\b/i.test(trimmed) && /\byour\b/i.test(trimmed));
      if (isQuestion) {
        out.questions.push(trimmed);
        add({ kind: 'question', raw: trimmed, requirement: `Answer this question the client asked in the proposal: "${trimmed}"`, tokens: significantTokens(trimmed) });
        continue;
      }
    }

    // ── Required experience bar ──
    if (out.experiences.length < 2) {
      const requireSignal = /\b(?:must have|need(s|ed)?|require(s|d)?|looking for|seeking|wanted|ideally|experience with|experienced in|experienced with|familiar with|background in|expertise in|should have)\b/i.test(sent);
      const expSignal = /\b(?:experience|experienced|expertise|familiar(?:ity)?|background|skilled|hands[- ]on|years?|yrs)\b/i.test(sent);
      if (requireSignal && expSignal) {
        const phrase = extractExperiencePhrase(sent);
        if (phrase && phrase.length <= 110) {
          out.experiences.push(phrase);
          add({ kind: 'experience', raw: sent, requirement: `The client requires "${phrase}". Acknowledge that stated experience bar in the proposal WITHOUT claiming you personally have that experience.`, tokens: significantTokens(phrase) });
          continue;
        }
      }
    }

    // ── Requested action ──
    if (out.actions.length < 3) {
      const action = /\b(send|share|include|attach|submit|provide|paste|email|message|upload|give|link|forward|mention)\b[^.!?\n]{0,70}\b(your|a link|links?|portfolio|github|resume|cv|samples?|examples?|work samples|application)\b/i.test(sent)
        && !/\b(word|phrase|keyword)\b/i.test(sent);
      if (action) {
        out.actions.push(sent);
        add({ kind: 'action', raw: sent, requirement: `The client asked applicants to "${sent}" — address this naturally in the proposal.` });
      }
    }

    // ── Format / application instruction ──
    if (out.formats.length < 3) {
      if (FORMAT_RE.test(sent)) {
        out.formats.push(sent);
        add({ kind: 'format', raw: sent, requirement: `The client stated a format/application instruction: "${sent}" — follow it in the proposal.` });
      }
    }
  }

  return out;
}

/** Natural-language lines describing every detected instruction, for prompts. */
export function instructionsToPromptLines(instructions: ExtractedInstructions): string[] {
  const lines: string[] = [];
  if (instructions.openingWord) lines.push(`Start your proposal with exactly the word "${instructions.openingWord}" — no greeting or other text before it.`);
  if (instructions.endingWord) lines.push(`End your proposal with exactly the word "${instructions.endingWord}" — it must be the final text.`);
  for (const k of instructions.keywords) lines.push(`Include the word "${k}" somewhere in the proposal.`);
  for (const q of instructions.questions) lines.push(`Answer this question the client asked, inside the proposal: "${q}"`);
  for (const e of instructions.experiences) lines.push(`The client requires "${e}". Acknowledge that requirement in the proposal WITHOUT claiming you personally have that experience.`);
  for (const a of instructions.actions) lines.push(`The client asked applicants to "${a}" — address it naturally in the proposal.`);
  for (const f of instructions.formats) lines.push(`The client stated a format/application instruction: "${f}" — follow it.`);
  return lines;
}

/**
 * Extract the verification word a listing requires a proposal to start with.
 * Only returns a token when the listing actually instructs the applicant to
 * open with a specific word or phrase — never for incidental quoted/uppercase
 * text and never from negative language like "DO NOT APPLY".
 */
export function extractVerificationWord(description: string): string {
  return extractJobInstructions(description).openingWord;
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

/** Does the text end with the word as the final token (trailing punctuation allowed)? */
export function endsWithWord(text: string, word: string): boolean {
  const w = (word || '').trim();
  if (!w) return true;
  const t = (text || '').trim();
  if (!t) return false;
  const final = t.replace(/[.!?,;:)\]"'`\s]+$/, '').toLowerCase();
  const wl = w.toLowerCase();
  if (final === wl) return true;
  return new RegExp(`[^a-z0-9]${escapeRe(wl)}$`).test(final);
}

/** Force the proposal to literally end with the required word. */
export function ensureEndsWithWord(text: string, word: string): string {
  const w = (word || '').trim();
  const t = (text || '').trim();
  if (!w) return t;
  if (endsWithWord(t, w)) return t;
  if (!t) return w;
  return `${t.replace(/[.!?,;:)\]"'`\s]+$/, '')}\n\n${w}`;
}

/**
 * Make sure every keyword the client requires actually appears in the proposal.
 * Missing keywords are inserted as a short, explicit paragraph so the client's
 * filter is satisfied without corrupting the rest of the text.
 */
export function ensureIncludesKeywords(text: string, keywords: string[]): string {
  const out = (text || '').trim();
  if (!out) return out;
  const missing = (keywords || []).filter(k => k && !new RegExp(escapeRe(k), 'i').test(out));
  if (!missing.length) return out;

  const insert = missing.map(k => `You asked to see the word "${k}" in your proposal — there it is.`);
  const paras = out.split(/\n\s*\n/);
  if (paras.length <= 1) return `${out}\n\n${insert.join('\n')}`;
  paras.splice(1, 0, insert.join('\n'));
  return paras.join('\n\n');
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
 * Beyond grounding, it checks the client's machine-checkable instructions:
 * required opening word, required ending word, required keywords, the stated
 * experience bar, and the client's questions.
 */
export function validateProposal(
  proposal: string,
  job: GroundingJob,
  verificationWord: string,
  instructions: ExtractedInstructions = extractJobInstructions(job.description || ''),
): ProposalValidation {
  const issues: string[] = [];
  const p = (proposal || '').trim();
  if (!p) {
    return { ok: false, issues: ['Proposal is empty.'] };
  }

  if (verificationWord && !startsWithWord(p, verificationWord)) {
    issues.push(`Required opening word "${verificationWord}" is missing from the start of the proposal.`);
  }
  if (instructions.endingWord && !endsWithWord(p, instructions.endingWord)) {
    issues.push(`Required ending word "${instructions.endingWord}" is missing from the end of the proposal.`);
  }
  for (const k of instructions.keywords) {
    if (!new RegExp(escapeRe(k), 'i').test(p)) {
      issues.push(`Required keyword "${k}" is missing from the proposal.`);
    }
  }
  for (const exp of instructions.experiences) {
    const tokens = significantTokens(exp);
    if (tokens.length && tokens.every(t => !hasWord(p, t))) {
      issues.push(`Proposal does not acknowledge the stated experience requirement ("${exp}").`);
      break;
    }
  }
  for (const q of instructions.questions.slice(0, 3)) {
    const tokens = significantTokens(q);
    if (tokens.length && tokens.every(t => !hasWord(p, t))) {
      issues.push(`Proposal does not address the client's question: "${q}".`);
      break;
    }
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

/**
 * Detects things the listing explicitly asks of an applicant (a required
 * opening word, or questions/instructions) so the proposal can acknowledge
 * them instead of ignoring them. Returns safe, non-invented sentences.
 */
export function extractClientQuestions(description: string): string[] {
  const inst = extractJobInstructions(description);
  const out: string[] = [];
  if (inst.openingWord) {
    out.push(`Your post asks to begin the response with "${inst.openingWord}", so the proposal starts with that exact word.`);
  }
  if (inst.questions.length) {
    const qs = inst.questions.map(q => `"${q}"`).join(' ');
    out.push(`You asked: ${qs} — the plan below addresses each one directly.`);
  }
  return out;
}

export interface GroundedProposalOptions {
  clientName?: string;
  skills?: string[];
  /** Required opening word extracted from the listing (e.g. "SMILE"). */
  verificationWord?: string;
  /** Full instruction set extracted from the listing (re-extracted when absent). */
  instructions?: ExtractedInstructions;
}

/**
 * The single deterministic proposal generator. Every entry point that produces
 * a proposal funnels through this so the output is always grounded in the
 * CURRENT listing only:
 *   - Every sentence derives from signals actually present in the title /
 *     description / required skills. Nothing else is invented.
 *   - No candidate claims: no experience, past projects, portfolio, tools the
 *     candidate has used, results, or qualifications (no profile exists).
 *   - When the listing contains explicit instructions, the proposal is NOT a
 *     generic template: it satisfies the required opening word, ending word,
 *     keywords, answers/acknowledges the client's questions, the stated
 *     experience bar, requested actions, and format requirements.
 */
export function generateGroundedProposal(title: string, description: string, options: GroundedProposalOptions = {}): string {
  const desc = (description || '').trim();
  const text = `${title || ''} ${desc}`.toLowerCase();
  const instructions = options.instructions || extractJobInstructions(desc);
  const verificationWord = options.verificationWord || instructions.openingWord;
  const endingWord = instructions.endingWord;

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

  // Assemble — each part grounded in the actual listing. When the listing
  // contains explicit instructions, the proposal is tailored to them instead of
  // a generic template: required opening word, required ending word, keywords,
  // the client's questions, the stated experience bar, and any requested
  // actions / format instructions are all honored.
  const lines: string[] = [];
  lines.push(greeting);

  let opening = understand;
  if (techPhrase) opening += ` The core here is ${techPhrase}.`;
  if (titleRef) opening = `For ${titleRef}, ${opening}`;
  lines.push(opening);

  // The stated experience bar — acknowledged without claiming we have it.
  if (instructions.experiences.length) {
    lines.push(`You've set a clear bar: "${instructions.experiences[0]}". The plan below is shaped around meeting exactly that requirement.`);
  }

  // Questions the client asked the applicant — acknowledged by name.
  if (instructions.questions.length) {
    lines.push(`You asked: ${instructions.questions.map(q => `"${q}"`).join(' ')} — the plan below addresses each one directly.`);
  }

  // Requested actions and format/application instructions — acknowledged.
  const extraAsks = [...instructions.actions, ...instructions.formats].slice(0, 2);
  if (extraAsks.length) {
    lines.push(`I've noted your instructions: ${extraAsks.map(a => `"${a}"`).join('; ')}. I'll follow them exactly.`);
  }

  lines.push('The plan:');
  lines.push(bullets.map((b, i) => `${i + 1}. ${b}`).join('\n'));
  lines.push(cta);
  if (!endingWord) lines.push('Best,');

  let proposal = lines.join('\n\n');
  proposal = ensureIncludesKeywords(proposal, instructions.keywords);
  proposal = ensureEndsWithWord(proposal, endingWord);
  return ensureStartsWithWord(proposal, verificationWord);
}
