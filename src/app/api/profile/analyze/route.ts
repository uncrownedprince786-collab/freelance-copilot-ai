import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedRequest } from '@/lib/adminAuth';
import { analyzeProfileRequest } from '../../../../services/profile/service';
import { MAX_MANUAL_PROFILE_CHARS } from '../../../../services/profile/normalizer';

// Simple in-memory rate limiter — max 10 req / minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  if (entry.count > 10) return true;
  return false;
}

const secureHeaders = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

const sanitize = (s: unknown, max = 25_000): string =>
  typeof s === 'string'
    ? s.replace(/<[^>]*>/g, '').trim().slice(0, max)
    : '';

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a minute.' },
      { status: 429, headers: secureHeaders }
    );
  }

  if (!(await isAuthenticatedRequest())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: secureHeaders });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400, headers: secureHeaders });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body must be an object.' }, { status: 400, headers: secureHeaders });
  }

  const { profileUrl, manualProfile } = body as Record<string, unknown>;

  const safeUrl = sanitize(profileUrl, 2048);
  const safeManual = sanitize(manualProfile, MAX_MANUAL_PROFILE_CHARS + 1);

  try {
    const result = await analyzeProfileRequest({
      profileUrl: safeUrl,
      manualProfile: safeManual,
    });

    if (!result.ok) {
      const status = result.reason === 'invalid_input' ? 400 : result.reason === 'unsupported_platform' ? 400 : 422;
      return NextResponse.json({ error: result.error }, { status, headers: secureHeaders });
    }

    return NextResponse.json(result, { headers: secureHeaders });
  } catch (err) {
    console.error('[profile/analyze] Internal error:', err);
    return NextResponse.json(
      { error: 'Profile analysis service temporarily unavailable.' },
      { status: 503, headers: secureHeaders }
    );
  }
}
