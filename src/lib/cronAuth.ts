import crypto from 'crypto';

/**
 * Constant-time comparison of two secrets.
 *
 * Hashing both sides first means the comparison is over two equal-length
 * digests, so timingSafeEqual cannot throw on a length mismatch and the length
 * of the provided value does not leak.
 */
export function timingSafeSecretEqual(a: string, b: string): boolean {
  const aHash = crypto.createHash('sha256').update(a).digest();
  const bHash = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

/**
 * True when the request carries a valid `Authorization: Bearer <CRON_SECRET>`.
 *
 * This is how schedulers (GitHub Actions, Vercel Cron) authenticate. It is
 * deliberately separate from cookie auth: a Bearer header cannot be attached by
 * a cross-site navigation, so a route restricted to this is not CSRF-reachable.
 */
export function hasValidCronBearer(req: { headers: { get(name: string): string | null } }): boolean {
  const authHeader = req.headers.get('authorization');
  const expectedSecret = process.env.CRON_SECRET;
  if (!authHeader || !expectedSecret) return false;
  const provided = authHeader.replace(/^Bearer\s+/i, '').trim();
  return timingSafeSecretEqual(provided, expectedSecret);
}
