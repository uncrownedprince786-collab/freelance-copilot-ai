import { prisma } from './db';

// ---------------------------------------------------------------------------
// In-process limiter (legacy)
// ---------------------------------------------------------------------------
// Kept for cheap, best-effort throttling of pure-CPU routes. On serverless this
// is PER-LAMBDA: each instance has its own Map, a cold start resets it, and
// concurrency multiplies the allowance. It is a speed bump, not a quota.
// Anything that costs real money must use consumeQuota() below.
//
// Entries are now evicted on a schedule so a key-rotating caller cannot grow
// the map without bound.
export function createRateLimiter(maxRequests: number, windowMs: number) {
  const map = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = Date.now();

  return function isRateLimited(key: string): boolean {
    const now = Date.now();

    // Periodic sweep: drop every expired entry, bounded work, no timers.
    if (now - lastSweep > windowMs) {
      for (const [k, v] of map) {
        if (now > v.resetAt) map.delete(k);
      }
      lastSweep = now;
    }

    const entry = map.get(key);
    if (!entry || now > entry.resetAt) {
      map.set(key, { count: 1, resetAt: now + windowMs });
      return false;
    }
    entry.count++;
    return entry.count > maxRequests;
  };
}

// ---------------------------------------------------------------------------
// Durable quota
// ---------------------------------------------------------------------------
// A shared counter in SystemKv, so the limit holds across every lambda instance
// and every cold start. This is the same pattern lib/apifyBudget.ts already
// uses successfully for scraping spend — it is applied here to LLM spend and to
// anything else where exceeding the limit costs money or storage.
//
// FAIL-CLOSED. If the counter cannot be read or written we deny rather than
// allow: a database blip must not become an unmetered spending window. That is
// the opposite of the Apify budget's current fail-open behaviour, which is a
// separate finding.

export interface QuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
  /** Seconds until the current window rolls over. */
  resetInSec: number;
}

/** Window start (epoch ms) for a fixed window of `windowMs`. */
function windowStart(windowMs: number, now: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

/**
 * Consume one unit from `name`'s quota for `subject`.
 *
 * Uses a single atomic INSERT ... ON CONFLICT DO UPDATE so concurrent callers
 * cannot both read a stale count and both proceed — the read-modify-write in
 * the previous implementation allowed exactly that.
 *
 * The stored value is `{"w": <windowStart>, "n": <count>}`. A row whose window
 * has rolled over is reset by the same statement rather than by a second query.
 */
export async function consumeQuota(
  name: string,
  subject: string,
  limit: number,
  windowMs: number,
): Promise<QuotaResult> {
  const now = Date.now();
  const w = windowStart(windowMs, now);
  const resetInSec = Math.ceil((w + windowMs - now) / 1000);
  const key = `quota:${name}:${subject}`;

  if (limit <= 0) return { allowed: false, used: 0, limit, resetInSec };

  try {
    // jsonb arithmetic in one statement: if the stored window matches,
    // increment; otherwise start a new window at 1. RETURNING gives us the
    // post-increment count, so the decision is made on the committed value.
    const rows = await prisma.$queryRaw<Array<{ n: number }>>`
      INSERT INTO system_kv ("key", "value", "updatedAt")
      VALUES (${key}, ${JSON.stringify({ w, n: 1 })}, NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "value" = CASE
          WHEN (system_kv."value"::jsonb ->> 'w') = ${String(w)}
          THEN jsonb_build_object(
                 'w', ${String(w)}::text,
                 'n', ((system_kv."value"::jsonb ->> 'n')::int + 1)
               )::text
          ELSE ${JSON.stringify({ w, n: 1 })}
        END,
        "updatedAt" = NOW()
      RETURNING ("value"::jsonb ->> 'n')::int AS n
    `;

    const used = rows[0]?.n ?? limit + 1;
    return { allowed: used <= limit, used, limit, resetInSec };
  } catch (err) {
    // Fail CLOSED. See the note above.
    console.error(`[rateLimit] quota check failed for ${name}; denying:`, err instanceof Error ? err.message : err);
    return { allowed: false, used: limit + 1, limit, resetInSec };
  }
}

/**
 * The identity a durable quota is charged to.
 *
 * Prefers the signed session's guestId claim, because that is the only value a
 * caller cannot choose freely. `x-forwarded-for` is a fallback ONLY: the
 * left-most element is client-supplied and trivially rotated, so an IP-keyed
 * quota alone is not a real limit.
 */
export function quotaSubject(sessionId: string | undefined, forwardedFor: string | null): string {
  if (sessionId && sessionId.trim()) return `s:${sessionId.trim().slice(0, 100)}`;
  // Right-most entry is the one the closest trusted proxy appended.
  const parts = (forwardedFor || '').split(',').map((p) => p.trim()).filter(Boolean);
  const ip = parts.length > 0 ? parts[parts.length - 1] : 'unknown';
  return `ip:${ip.slice(0, 64)}`;
}
