import { prisma } from './db';

// Cross-instance run lock for scheduled work.
//
// The previous implementation read the lock row with findUnique and then
// upserted it. Those are two statements: two invocations that arrive together
// can both observe "no lock" and both proceed, which is exactly the overlap the
// lock exists to prevent. It also failed OPEN on any error, so a transient
// database problem allowed concurrent syncs — each of which spends real Apify
// budget.
//
// This version acquires in ONE statement. The insert succeeds only when there
// is no row, or when the existing row's TTL has expired; `rowCount` tells us
// whether we won. A TTL is still required so a crashed run cannot wedge the
// pipeline permanently.

export interface LockHandle {
  key: string;
  token: string;
}

/**
 * Try to acquire `key` for `ttlMs`.
 *
 * Returns a handle on success, or null when another run holds it. Fails CLOSED:
 * if the lock cannot be evaluated we report "not acquired" rather than letting
 * a second run start.
 */
export async function acquireLock(key: string, ttlMs: number): Promise<LockHandle | null> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const expiresAt = Date.now() + ttlMs;
  const value = JSON.stringify({ token, startedAt: Date.now(), expiresAt });

  try {
    // Insert if absent; steal if the incumbent has expired. A row whose
    // expiresAt is still in the future blocks the update, so rowCount is 0.
    const affected = await prisma.$executeRaw`
      INSERT INTO system_kv ("key", "value", "updatedAt")
      VALUES (${key}, ${value}, NOW())
      ON CONFLICT ("key") DO UPDATE
        SET "value" = ${value}, "updatedAt" = NOW()
        WHERE COALESCE((system_kv."value"::jsonb ->> 'expiresAt')::bigint, 0) < ${expiresAt - ttlMs}
    `;
    return affected > 0 ? { key, token } : null;
  } catch (err) {
    console.error(`[runLock] could not acquire ${key}; treating as held:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Release a lock, but only if we still hold it.
 *
 * The token check matters: if our run overran its TTL and another run stole the
 * lock, deleting unconditionally would release *their* lock and allow a third
 * run to start alongside it.
 */
export async function releaseLock(handle: LockHandle | null): Promise<void> {
  if (!handle) return;
  try {
    await prisma.$executeRaw`
      DELETE FROM system_kv
      WHERE "key" = ${handle.key}
        AND ("value"::jsonb ->> 'token') = ${handle.token}
    `;
  } catch {
    /* non-fatal: the TTL will clear it */
  }
}
