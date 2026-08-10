import { NextRequest, NextResponse } from 'next/server';
import { MultiAI } from '../../../services/ai/MultiAI';
import { isAuthenticatedRequest } from '@/lib/adminAuth';

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

export async function POST(request: NextRequest) {
  // Rate limiting
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a minute.' },
      { status: 429, headers: secureHeaders }
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

  const { title, description, platform, budget, clientName } = body as Record<string, unknown>;

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return NextResponse.json({ error: 'title is required.' }, { status: 400, headers: secureHeaders });
  }

  // Sanitize — strip any HTML/script tags, enforce length limits
  const sanitize = (s: unknown, max = 500): string =>
    typeof s === 'string'
      ? s.replace(/<[^>]*>/g, '').trim().slice(0, max)
      : '';

  const safeTitle = sanitize(title, 300);
  const safeDesc = sanitize(description, 3000);
  const safePlatform = sanitize(platform, 50) || 'Unknown';
  const safeBudget = sanitize(budget, 100) || 'Negotiable';
  const safeClientName = sanitize(clientName, 100);

  try {
    const analysis = await new MultiAI().analyze(safeTitle, safeDesc, {
      platform: safePlatform,
      budget: safeBudget,
      clientName: safeClientName,
    });

    return NextResponse.json(analysis, { headers: secureHeaders });
  } catch (err) {
    console.error('[analyze] Internal error:', err);
    return NextResponse.json(
      { error: 'Analysis service temporarily unavailable.' },
      { status: 503, headers: secureHeaders }
    );
  }
}