import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedRequest } from '@/lib/adminAuth';
import { runSmartSearch } from '@/services/search/service';
import { readSearchCache, writeSearchCache } from '@/services/search/cache';
import { consumeSearchQuota, getSearchQuotaRemaining } from '@/lib/searchQuota';

export const dynamic = 'force-dynamic';

// Manual searches are quota-guarded; 10 req / min / IP prevents runaway abuse.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > 10;
}

const secureHeaders = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429, headers: secureHeaders });
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

    const query = typeof (body as Record<string, unknown> | null)?.query === 'string'
      ? ((body as Record<string, string>).query).replace(/<[^>]*>/g, '').trim().slice(0, 120)
      : '';

    if (!query) {
      return NextResponse.json({ error: 'query is required.' }, { status: 400, headers: secureHeaders });
    }

    const source = typeof (body as Record<string, unknown> | null)?.source === 'string'
      ? String((body as Record<string, unknown>).source).trim().toLowerCase()
      : undefined;

    try {
      const result = await runSmartSearch(query, {
        readCache: readSearchCache,
        writeCache: writeSearchCache,
        consumeQuota: consumeSearchQuota,
      }, source);

    if (result.status === 'needs_clarification') {
      return NextResponse.json(result, { status: 422, headers: secureHeaders });
    }

    return NextResponse.json(
      { ...result, quotaRemaining: getSearchQuotaRemaining() },
      { headers: secureHeaders },
    );
  } catch (err) {
    console.error('[jobs/search] Internal error:', err);
    return NextResponse.json(
      { error: 'Search service temporarily unavailable.' },
      { status: 503, headers: secureHeaders },
    );
  }
}
