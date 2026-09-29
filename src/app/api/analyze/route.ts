import { NextRequest, NextResponse } from 'next/server';
import { MultiAI, JobAnalysis } from '../../../services/ai/MultiAI';
import { prisma } from '@/lib/db';
import { getSessionClaims } from '@/lib/adminAuth';
import { consumeQuota, quotaSubject } from '@/lib/rateLimit';
import { clientKeyOf } from '@/lib/marketFacts';
import { getRawJobs } from '@/lib/jobsCache';
import {
  ensureEndsWithWord,
  ensureIncludesKeywords,
  ensureStartsWithWord,
  extractJobInstructions,
  jobFingerprint,
  GroundingJob,
  ExtractedInstructions,
  validateAssessment,
  validateProposal,
} from '@/lib/proposalGrounding';

// In-memory 24h cache (L1) so repeated analyses within a warm instance avoid a
// DB round-trip. The persistent SystemKv cache (L2) survives serverless cold
// starts, so the same opportunity assessed once in a 24h window is never
// re-tokenized.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
interface CacheEntry { data: unknown; ts: number; }
const memCache = new Map<string, CacheEntry>();

// Durable LLM spend quota.
//
// This route was the most expensive hole in the system: a guest cookie is free
// and unlimited to mint, the prompt was built from the REQUEST BODY rather than
// from the database, and the per-IP limiter was an in-memory Map (per-lambda,
// reset on every cold start, keyed on a client-supplied header). That combined
// into a free general-purpose LLM proxy on the owner's API keys at roughly
// 15k input tokens per call.
//
// Two fixes, both needed: the prompt now comes from the stored listing (below),
// and the quota is a shared counter charged to the signed session.
const ANALYZE_MAX_PER_SESSION = 40;
const ANALYZE_WINDOW_MS = 60 * 60_000;

// Upper bound on the description handed to a provider. It has to stay large
// because client instructions ("start your proposal with SMILE") often sit at
// the very end of a long posting, but it is no longer attacker-chosen: it
// bounds text that came out of our own database.
const MAX_DESC_CHARS = 20_000;

const secureHeaders = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

function cacheKey(opportunityId: string): string {
  return `analysis:${opportunityId}`;
}

function isCacheValid(ts: number): boolean {
  return Date.now() - ts < CACHE_TTL_MS;
}

// A cached analysis is only usable when it still belongs to the CURRENT job and
// its proposal passes the same pre-display validation as a fresh one. Anything
// stale, mismatched, or ungrounded is treated as a miss so it gets regenerated.
function isAnalysisUsable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  job: GroundingJob,
  verificationWord: string,
  fp: string,
  instructions: ExtractedInstructions,
): boolean {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.proposal !== 'string' || !data.proposal.trim()) return false;
  if (typeof data._jobFp === 'string' && data._jobFp !== fp) return false;
  const proposalOk = validateProposal(data.proposal, job, verificationWord, instructions).ok;
  const assessmentOk = validateAssessment(data, job).ok;
  return proposalOk && assessmentOk;
}

async function readPersistentCache(key: string): Promise<{ data: unknown; ts: number } | null> {
  try {
    const rec = await prisma.systemKv.findUnique({ where: { key } });
    if (!rec?.value) return null;
    const parsed = JSON.parse(rec.value) as { data: unknown; ts: number };
    if (!parsed || typeof parsed.ts !== 'number' || !isCacheValid(parsed.ts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writePersistentCache(key: string, data: unknown): Promise<void> {
  try {
    const payload = JSON.stringify({ data, ts: Date.now() });
    await prisma.systemKv.upsert({
      where: { key },
      update: { value: payload },
      create: { key, value: payload },
    });
  } catch { /* non-critical; cache is best-effort */ }
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Safety net: the AI prompt forbids personal-fit claims ("matches your skills",
// "fits your budget"...). Some fallbacks / provider responses still phrase
// things that way — scrub them out of what we return so no proposal or summary
// ever makes a claim about the freelancer's profile.
const BANNED_PHRASES: [string, string][] = [
  ['matches your skills', 'aligns with the project'],
  ['matches my skills', 'aligns with the project'],
  ['matches my skillset', 'aligns with the project'],
  ['perfect for you', 'well suited to this project'],
  ['perfect for your needs', 'well suited to this project'],
  ['perfect fit', 'a strong fit for this project'],
  ['fits within your budget', 'respects the stated budget'],
  ['within your budget', 'within the stated budget'],
  ['fits your budget', 'respects the stated budget'],
  ['is perfect for', 'is well suited to'],
];

function scrubBannedPhrases(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [from, to] of BANNED_PHRASES) out = out.split(from).join(to);
  return out;
}

function scrubAnalysis<T extends { proposal?: string; summary?: string; reasons?: string[] }>(analysis: T): T {
  if (analysis.proposal) analysis.proposal = scrubBannedPhrases(analysis.proposal);
  if (analysis.summary) analysis.summary = scrubBannedPhrases(analysis.summary);
  if (Array.isArray(analysis.reasons)) analysis.reasons = analysis.reasons.map(scrubBannedPhrases);
  return analysis;
}

/** Repeat-client signal computed server-side from the real store: an active
 *  buyer with multiple open listings is a better lead than a one-off poster. */
async function detectRepeatClient(opportunityId: string): Promise<{ repeatClient: boolean; clientJobsCount: number }> {
  try {
    const rawJobs = await getRawJobs();
    const keys = new Map<string, string | null>();
    const counts = new Map<string, number>();
    for (const job of rawJobs) {
      const key = clientKeyOf(job);
      const jid = job.id || job.url || '';
      if (jid) keys.set(jid, key);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    const key = keys.get(opportunityId) || null;
    if (!key) return { repeatClient: false, clientJobsCount: 0 };
    const total = counts.get(key) || 0;
    return { repeatClient: total >= 2, clientJobsCount: Math.max(total - 1, 0) };
  } catch {
    return { repeatClient: false, clientJobsCount: 0 };
  }
}

export async function POST(request: NextRequest) {
  // Require a valid session (admin cookie or guest cookie) to prevent
  // unauthenticated callers from burning AI credits.
  const claims = await getSessionClaims();
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: secureHeaders });
  }

  // Durable, shared quota charged to the signed session (falling back to the
  // right-most forwarded IP). Fails closed.
  const subject = quotaSubject(
    claims.role === 'admin' ? 'admin' : claims.guestId,
    request.headers.get('x-forwarded-for'),
  );
  const quota = await consumeQuota('analyze', subject, ANALYZE_MAX_PER_SESSION, ANALYZE_WINDOW_MS);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: 'Analysis limit reached for this session. Please try again later.' },
      { status: 429, headers: { ...secureHeaders, 'Retry-After': String(quota.resetInSec) } },
    );
  }

  // Input validation
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400, headers: secureHeaders });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body must be an object.' }, { status: 400, headers: secureHeaders });
  }

  const { platform, budget, clientName, opportunityId, totalSpent, jobsPosted, totalHires, rating, budgetMin, budgetMax, budgetType, proposalCount, interviewingCount, experienceLevel, duration, connectsRequired, paymentVerified } = body as Record<string, unknown>;

  // Sanitize — strip any HTML/script tags, enforce length limits.
  const sanitize = (s: unknown, max = 500): string =>
    typeof s === 'string'
      ? s.replace(/<[^>]*>/g, '').trim().slice(0, max)
      : '';

  const safeOpportunityId = sanitize(opportunityId, 64) || '';

  // The text that reaches an LLM provider comes from the DATABASE, never from
  // the request body. Previously `title` and `description` were taken straight
  // from the caller, so anyone holding a free guest cookie could submit 60k
  // characters of arbitrary text and have it billed to the owner's API keys.
  // An analysis is now only possible for a listing this system actually stores.
  if (!safeOpportunityId) {
    return NextResponse.json(
      { error: 'opportunityId is required.' },
      { status: 400, headers: secureHeaders },
    );
  }

  const stored = await prisma.opportunity.findUnique({
    where: { id: safeOpportunityId },
    select: { title: true, description: true, skills: true },
  }).catch(() => null);

  if (!stored) {
    return NextResponse.json(
      { error: 'Unknown opportunity.' },
      { status: 404, headers: secureHeaders },
    );
  }

  const safeTitle = sanitize(stored.title, 300);
  if (!safeTitle) {
    return NextResponse.json({ error: 'Stored listing has no title.' }, { status: 422, headers: secureHeaders });
  }

  const safeDesc = sanitize(stored.description, MAX_DESC_CHARS);
  const safeSkills = (stored.skills ? stored.skills.split(',') : [])
    .map(s => sanitize(s, 40))
    .filter(Boolean);

  // Presentational / signal fields may still come from the caller: they are
  // not interpolated as free text into a prompt, and they are clamped below.
  const safePlatform = sanitize(platform, 50) || 'Unknown';
  const safeBudget = sanitize(budget, 100) || 'Negotiable';
  const safeClientName = sanitize(clientName, 100);
  const safeBudgetType = sanitize(budgetType, 20);
  const safeExperienceLevel = sanitize(experienceLevel, 40);
  const safeDuration = sanitize(duration, 40);

  // Cache lookup keyed by opportunity id (when available). A cached analysis is
  // only reused when it belongs to this exact job and passes validation.
  if (safeOpportunityId) {
    const key = cacheKey(safeOpportunityId);
    const groundingJob: GroundingJob = { title: safeTitle, skills: safeSkills, description: safeDesc };
    const instructions = extractJobInstructions(safeDesc);
    const vw = instructions.openingWord;
    const fp = jobFingerprint(safeTitle, safeSkills);
    const memHit = memCache.get(key);
    if (memHit && isCacheValid(memHit.ts) && isAnalysisUsable(memHit.data, groundingJob, vw, fp, instructions)) {
      return NextResponse.json({ ...(memHit.data as Record<string, unknown>) }, { headers: secureHeaders });
    }
    const persisted = await readPersistentCache(key);
    if (persisted && isAnalysisUsable(persisted.data, groundingJob, vw, fp, instructions)) {
      memCache.set(key, persisted);
      return NextResponse.json({ ...(persisted.data as Record<string, unknown>) }, { headers: secureHeaders });
    }
  }

  try {
    // Server-verified repeat-client context (only when we know the listing).
    const repeat = safeOpportunityId ? await detectRepeatClient(safeOpportunityId) : { repeatClient: false, clientJobsCount: 0 };

    const baseOptions = {
      platform: safePlatform,
      budget: safeBudget,
      clientName: safeClientName,
      skills: safeSkills,
      totalSpent: toNum(totalSpent),
      jobsPosted: toNum(jobsPosted),
      totalHires: toNum(totalHires),
      rating: toNum(rating),
      budgetMin: toNum(budgetMin),
      budgetMax: toNum(budgetMax),
      budgetType: safeBudgetType,
      proposalCount: toNum(proposalCount),
      interviewingCount: toNum(interviewingCount),
      experienceLevel: safeExperienceLevel,
      duration: safeDuration,
      connectsRequired: toNum(connectsRequired),
      paymentVerified: paymentVerified === true,
      repeatClient: repeat.repeatClient,
      clientJobsCount: repeat.clientJobsCount,
    };

    // Grounding inputs used both to steer generation and to gate the result
    // before it reaches the client. Never return a proposal that contradicts
    // the listing or leaks another job's context. The full instruction set from
    // the listing is extracted here so generation, enforcement, and validation
    // all agree on what the client explicitly asked for.
    const groundingJob: GroundingJob = { title: safeTitle, skills: safeSkills, description: safeDesc };
    const instructions = extractJobInstructions(safeDesc);
    const verificationWord = instructions.openingWord;
    const fp = jobFingerprint(safeTitle, safeSkills);

    let analysis: JobAnalysis | null = null;
    let issues: string[] = [];
    const MAX_ATTEMPTS = 2;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const regenerationNote =
        attempt > 0 && issues.length > 0
          ? `The previous proposal was rejected for: ${issues.join('; ')}. Rewrite it strictly using the Title and Description above — do not repeat those problems.`
          : undefined;
      analysis = await new MultiAI().analyze(safeTitle, safeDesc, {
        ...baseOptions,
        verificationWord,
        instructions,
        ...(regenerationNote ? { regenerationNote } : {}),
      });
      const v = validateProposal(analysis.proposal, groundingJob, verificationWord, instructions);
      const a = validateAssessment(analysis, groundingJob);
      if (v.ok && a.ok) break;
      issues = [...v.issues, ...a.issues];
    }

    if (!analysis) {
      return NextResponse.json({ error: 'Analysis service temporarily unavailable.' }, { status: 503, headers: secureHeaders });
    }

    // Best effort: if every attempt failed validation, mechanically enforce the
    // listing's required opening word, required ending word, and keywords so the
    // surfaced proposal never violates them.
    analysis.proposal = ensureStartsWithWord(analysis.proposal, verificationWord);
    analysis.proposal = ensureIncludesKeywords(analysis.proposal, instructions.keywords);
    analysis.proposal = ensureEndsWithWord(analysis.proposal, instructions.endingWord);

    const cleaned = scrubAnalysis(analysis);
    const responseData = {
      ...cleaned,
      repeatClient: repeat.repeatClient,
      clientJobsCount: repeat.clientJobsCount,
      verificationWord,
    };

    if (safeOpportunityId) {
      const key = cacheKey(safeOpportunityId);
      const cachePayload = { ...cleaned, _jobFp: fp };
      memCache.set(key, { data: cachePayload, ts: Date.now() });
      void writePersistentCache(key, cachePayload);
    }

    return NextResponse.json(responseData, { headers: secureHeaders });
  } catch (err) {
    console.error('[analyze] Internal error:', err);
    return NextResponse.json(
      { error: 'Analysis service temporarily unavailable.' },
      { status: 503, headers: secureHeaders },
    );
  }
}
