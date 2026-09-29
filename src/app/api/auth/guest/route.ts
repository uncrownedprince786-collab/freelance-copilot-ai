import { NextRequest, NextResponse } from 'next/server';
import { createGuestToken, GUEST_COOKIE, GUEST_SESSION_MS } from '@/lib/adminAuth';
import { consumeQuota, quotaSubject } from '@/lib/rateLimit';

// Guest cookies are the credential that unlocks /api/analyze and /api/agent,
// both of which spend money per call. Minting them was unauthenticated AND
// unthrottled, so "requires a session" was not a real limit — an abuser could
// mint a fresh identity for every request and reset any per-session quota.
// This caps how many NEW guest identities one origin can mint.
const GUEST_MINTS_PER_WINDOW = 20;
const GUEST_WINDOW_MS = 60 * 60_000;

// Issues a signed, httpOnly guest session cookie so anonymous users can use
// session-protected endpoints (e.g. /api/analyze, /api/jobs/view) without
// exposing those routes to fully unauthenticated access.
export async function POST(request: NextRequest) {
  const subject = quotaSubject(undefined, request.headers.get('x-forwarded-for'));
  const quota = await consumeQuota('guest-mint', subject, GUEST_MINTS_PER_WINDOW, GUEST_WINDOW_MS);
  if (!quota.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Too many sessions from this origin. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(quota.resetInSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const guestId = (body as { guestId?: unknown } | null)?.guestId;
  if (typeof guestId !== 'string' || guestId.trim().length === 0 || guestId.length > 100) {
    return NextResponse.json({ ok: false, error: 'Invalid guestId' }, { status: 400 });
  }

  const token = createGuestToken(guestId.trim());
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Guest sessions unavailable' }, { status: 503 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(GUEST_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(GUEST_SESSION_MS / 1000),
  });
  return response;
}
