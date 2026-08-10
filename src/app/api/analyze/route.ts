import { NextRequest, NextResponse } from 'next/server';
import { MultiAI } from '../../../services/ai/MultiAI';
import { prisma } from '@/lib/db';
import { isAuthenticatedRequest } from '@/lib/adminAuth';

// In-memory 24h cache (L1) so repeated analyses within a warm instance avoid a
// DB round-trip. The persistent SystemKv cache (L2) survives serverless cold
// starts, so the same opportunity assessed once in a 24h window is never
// re-tokenized.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
interface CacheEntry { data: unknown; ts: number; }
const memCache = new Map<string, CacheEntry>();

// Simple in-memory rate limiter — max 30 req / minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  if (entry.count > 30) return true;
  return false;
}

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

export async function POST(request: NextRequest) {
  // Rate limiting
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a minute.' },
      { status: 429, headers: secureHeaders },
    );
  }

  // Require a valid session (admin cookie or guest cookie) to prevent
  // unauthenticated callers from burning AI credits.
  if (!(await isAuthenticatedRequest())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: secureHeaders });
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

  const { title, description, platform, budget, clientName, opportunityId, skills, totalSpent, jobsPosted, totalHires, rating, budgetMin, budgetMax, budgetType, proposalCount, interviewingCount, experienceLevel, duration, connectsRequired, paymentVerified } = body as Record<string, unknown>;

  // Sanitize — strip any HTML/script tags, enforce length limits
  const sanitize = (s: unknown, max = 500): string =>
    typeof s === 'string'
      ? s.replace(/<[^>]*>/g, '').trim().slice(0, max)
      : '';

  const safeTitle = sanitize(title, 300);
  if (!safeTitle) {
    return NextResponse.json({ error: 'title is required.' }, { status: 400, headers: secureHeaders });
  }

  const safeDesc = sanitize(description, 3000);
  const safePlatform = sanitize(platform, 50) || 'Unknown';
  const safeBudget = sanitize(budget, 100) || 'Negotiable';
  const safeClientName = sanitize(clientName, 100);
  const safeOpportunityId = sanitize(opportunityId, 64) || '';
  const safeSkills = Array.isArray(skills) ? skills.map(s => sanitize(s, 40)).filter(Boolean) : [];
  const safeBudgetType = sanitize(budgetType, 20);
  const safeExperienceLevel = sanitize(experienceLevel, 40);
  const safeDuration = sanitize(duration, 40);

  // Cache lookup keyed by opportunity id (when available).
  if (safeOpportunityId) {
    const key = cacheKey(safeOpportunityId);
    const memHit = memCache.get(key);
    if (memHit && isCacheValid(memHit.ts)) {
      return NextResponse.json({ ...(memHit.data as Record<string, unknown>), cached: true }, { headers: secureHeaders });
    }
    const persisted = await readPersistentCache(key);
    if (persisted) {
      memCache.set(key, persisted);
      return NextResponse.json({ ...(persisted.data as Record<string, unknown>), cached: true }, { headers: secureHeaders });
    }
  }

  try {
    const analysis = await new MultiAI().analyze(safeTitle, safeDesc, {
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
    });

    const responseData = { ...analysis, cached: false };

    if (safeOpportunityId) {
      const key = cacheKey(safeOpportunityId);
      memCache.set(key, { data: analysis, ts: Date.now() });
      void writePersistentCache(key, analysis);
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
