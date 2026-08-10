import { cookies } from 'next/headers';
import crypto from 'crypto';

export const ADMIN_COOKIE = 'lh_admin_session';
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
export const GUEST_COOKIE = 'lh_guest_session';
export const GUEST_SESSION_MS = 24 * 60 * 60 * 1000;

interface SessionTokenPayload {
  role: 'admin' | 'guest';
  guestId?: string;
  exp: number;
}

function signingKey(): string {
  return process.env.CRON_SECRET || '';
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
  try {
    const store = await cookies();
    const admin = store.get(ADMIN_COOKIE)?.value;
    if (admin && verifyAdminToken(admin)) return true;
    const guest = store.get(GUEST_COOKIE)?.value;
    return guest ? verifyToken(guest)?.role === 'guest' : false;
  } catch {
    return false;
  }
}
