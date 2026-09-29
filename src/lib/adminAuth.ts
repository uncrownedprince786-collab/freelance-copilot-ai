import { cookies } from 'next/headers';
import crypto from 'crypto';

export const ADMIN_COOKIE = 'lh_admin_session';
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
export const GUEST_COOKIE = 'lh_guest_session';
export const GUEST_SESSION_MS = 24 * 60 * 60 * 1000;

export interface SessionTokenPayload {
  role: 'admin' | 'guest';
  guestId?: string;
  exp: number;
}

// Session cookies are signed with SESSION_SIGNING_SECRET, NOT with CRON_SECRET.
// CRON_SECRET travels to /api/sync as a Bearer header from GitHub Actions on
// every scheduled tick, so it is exposed to Actions logs, outbound proxies and
// APM tooling. Using it as the cookie HMAC key meant any disclosure of that
// header let an attacker mint {"role":"admin"} cookies, and rotating it to
// revoke sessions would break the cron at the same time.
//
// CRON_SECRET remains the fallback so existing deployments keep working (and
// existing cookies stay valid) until SESSION_SIGNING_SECRET is set. Set it.
function signingKey(): string {
  return process.env.SESSION_SIGNING_SECRET || process.env.CRON_SECRET || '';
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function createToken(role: 'admin' | 'guest', guestId?: string): string | null {
  const key = signingKey();
  if (!key) return null;
  const exp = Date.now() + (role === 'admin' ? ADMIN_SESSION_MS : GUEST_SESSION_MS);
  const payload = Buffer.from(
    JSON.stringify({ role, ...(guestId ? { guestId } : {}), exp } satisfies SessionTokenPayload),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token: string): SessionTokenPayload | null {
  const key = signingKey();
  if (!key) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payload, sig] = parts;
  if (!safeEqual(sign(payload), sig)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionTokenPayload;
    if (decoded.role !== 'admin' && decoded.role !== 'guest') return null;
    if (Date.now() > decoded.exp) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function createAdminToken(): string | null {
  return createToken('admin');
}

export function createGuestToken(guestId: string): string | null {
  return createToken('guest', guestId);
}

export function verifyAdminToken(token: string): boolean {
  return verifyToken(token)?.role === 'admin';
}

export async function isAdminRequest(): Promise<boolean> {
  try {
    const store = await cookies();
    const token = store.get(ADMIN_COOKIE)?.value;
    return token ? verifyAdminToken(token) : false;
  } catch {
    return false;
  }
}

// Any valid session: a signed admin cookie or a signed guest cookie.
export async function isAuthenticatedRequest(): Promise<boolean> {
  return (await getSessionClaims()) !== null;
}

// The verified claims of the current request's session, or null when there is
// no valid session. Routes that act on behalf of a caller must read the
// identity from HERE rather than from the request body — the guestId claim is
// signed, a body field is not.
export async function getSessionClaims(): Promise<SessionTokenPayload | null> {
  try {
    const store = await cookies();
    const admin = store.get(ADMIN_COOKIE)?.value;
    if (admin) {
      const decoded = verifyToken(admin);
      if (decoded?.role === 'admin') return decoded;
    }
    const guest = store.get(GUEST_COOKIE)?.value;
    if (guest) {
      const decoded = verifyToken(guest);
      if (decoded?.role === 'guest') return decoded;
    }
    return null;
  } catch {
    return null;
  }
}
