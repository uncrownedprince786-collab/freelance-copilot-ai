import { NextResponse } from 'next/server';
import { ADMIN_COOKIE, ADMIN_SESSION_MS, createAdminToken } from '@/lib/adminAuth';
import { consumeQuota, quotaSubject } from '@/lib/rateLimit';
import { timingSafeSecretEqual } from '@/lib/cronAuth';

export const dynamic = 'force-dynamic';

// Attempts allowed per window, globally. This has to be durable: the previous
// in-memory limiter was per-lambda, reset on every cold start, multiplied by
// concurrency, and keyed on the raw client-supplied `x-forwarded-for` — so
// rotating that header per request gave an attacker an unthrottled online
// password-guessing oracle against an account whose username defaults to
// "admin".
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 10 * 60_000;

export async function POST(request: Request) {
  // No session exists yet at login, so this is necessarily IP-keyed — but it
  // is at least a shared counter now, and it uses the right-most forwarded
  // element rather than the left-most (client-supplied) one.
  const subject = quotaSubject(undefined, request.headers.get('x-forwarded-for'));
  const quota = await consumeQuota('login', subject, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(quota.resetInSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const username = String(record?.username ?? '').trim();
  const password = String(record?.password ?? '');

  const expectedUsername = process.env.ADMIN_USERNAME || 'admin';
  const expectedPassword = process.env.ADMIN_PASSWORD;

  // Constant-time comparison, and both sides are evaluated so the response
  // time does not distinguish "wrong username" from "wrong password".
  // (`!==` short-circuits; the rest of this codebase already compares secrets
  // this way — login was the outlier.)
  const userOk = !!expectedUsername && timingSafeSecretEqual(username, expectedUsername);
  const passOk = !!expectedPassword && timingSafeSecretEqual(password, expectedPassword);
  if (!expectedPassword || !userOk || !passOk) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = createAdminToken();
  if (!token) {
    return NextResponse.json({ error: 'Server auth is not configured.' }, { status: 503 });
  }
  const response = NextResponse.json({ success: true, role: 'admin' });
  response.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_SESSION_MS / 1000,
  });
  return response;
}
