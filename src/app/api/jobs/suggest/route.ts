import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedRequest } from '@/lib/adminAuth';
import { getRawJobs } from '@/lib/jobsCache';
import { buildSuggestions } from '@/services/search/suggest';

export const dynamic = 'force-dynamic';

// Light rate limit for autocomplete (90 req / min / IP).
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > 90;
}

const secureHeaders = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: secureHeaders });
  }
  if (!(await isAuthenticatedRequest())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: secureHeaders });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').slice(0, 60);

  let expertise: string[] = [];
  try {
    const parsed = JSON.parse(url.searchParams.get('expertise') || '[]');
    expertise = Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    expertise = [];
  }

  let jobs: Awaited<ReturnType<typeof getRawJobs>> = [];
  try {
    jobs = await getRawJobs();
  } catch {
    jobs = [];
  }

  const jobTitles = jobs.map((j) => j.title || '');
  const jobSkills = jobs.flatMap((j) => (Array.isArray(j.skills) ? j.skills : []));
  const jobTexts = jobs.map((j) => `${j.title || ''} ${(j.description || '').slice(0, 300)}`);

  const suggestions = buildSuggestions({ input: q, expertise, jobTitles, jobSkills, jobTexts });
  return NextResponse.json({ query: q, ...suggestions }, { headers: secureHeaders });
}
