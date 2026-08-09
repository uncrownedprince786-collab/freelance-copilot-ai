import { cookies } from 'next/headers';
import crypto from 'crypto';

export const ADMIN_COOKIE = 'lh_admin_session';
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;

interface AdminTokenPayload {
  role: 'admin';
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

export function createAdminToken(): string | null {
  const key = signingKey();
  if (!key) return null;
  const payload = Buffer.from(
    JSON.stringify({ role: 'admin', exp: Date.now() + ADMIN_SESSION_MS } satisfies AdminTokenPayload),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminToken(token: string): boolean {
  const key = signingKey();
  if (!key) return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payload, sig] = parts;
  if (!safeEqual(sign(payload), sig)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AdminTokenPayload;
    if (decoded.role !== 'admin') return false;
    if (Date.now() > decoded.exp) return false;
    return true;
  } catch {
    return false;
  }
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
