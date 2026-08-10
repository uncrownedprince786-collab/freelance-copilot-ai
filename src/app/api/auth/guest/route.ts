import { NextRequest, NextResponse } from 'next/server';
import { createGuestToken, GUEST_COOKIE, GUEST_SESSION_MS } from '@/lib/adminAuth';

// Issues a signed, httpOnly guest session cookie so anonymous users can use
// session-protected endpoints (e.g. /api/analyze, /api/jobs/view) without
// exposing those routes to fully unauthenticated access.
export async function POST(request: NextRequest) {
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
