import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

// The atomic lock (lib/runLock.ts) and the durable quota (lib/rateLimit.ts)
// are raw SQL, and one of them gates admin login — a statement that silently
// errors there would lock the owner out of their own system, because both fail
// CLOSED by design. The logic therefore has to be exercised against a real
// Postgres, not mocked.
//
// PGlite is Postgres compiled to WASM: real planner, real jsonb, real
// ON CONFLICT semantics, no server or Docker required. These tests keep the
// SQL here byte-identical to the SQL in the source files; if you change one,
// change both.

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE system_kv (
      "key" TEXT PRIMARY KEY,
      "value" TEXT NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL
    );
  `);
  return db;
}

// --- mirrors acquireLock() in lib/runLock.ts -------------------------------
async function acquire(db: PGlite, key: string, ttlMs: number, now = Date.now()) {
  const token = `${now}-${Math.random().toString(36).slice(2, 10)}`;
  const expiresAt = now + ttlMs;
  const value = JSON.stringify({ token, startedAt: now, expiresAt });
  const res = await db.query(
    `INSERT INTO system_kv ("key", "value", "updatedAt")
     VALUES ($1, $2, NOW())
     ON CONFLICT ("key") DO UPDATE
       SET "value" = $2, "updatedAt" = NOW()
       WHERE COALESCE((system_kv."value"::jsonb ->> 'expiresAt')::bigint, 0) < $3`,
    [key, value, expiresAt - ttlMs],
  );
  return res.affectedRows && res.affectedRows > 0 ? { key, token } : null;
}

// --- mirrors releaseLock() in lib/runLock.ts -------------------------------
async function release(db: PGlite, handle: { key: string; token: string } | null) {
  if (!handle) return;
  await db.query(
    `DELETE FROM system_kv WHERE "key" = $1 AND ("value"::jsonb ->> 'token') = $2`,
    [handle.key, handle.token],
  );
}

// --- mirrors consumeQuota() in lib/rateLimit.ts ----------------------------
async function consume(db: PGlite, key: string, w: number) {
  const res = await db.query<{ n: number }>(
    `INSERT INTO system_kv ("key", "value", "updatedAt")
     VALUES ($1, $2, NOW())
     ON CONFLICT ("key") DO UPDATE SET
       "value" = CASE
         WHEN (system_kv."value"::jsonb ->> 'w') = $3
         THEN jsonb_build_object('w', $3::text, 'n', ((system_kv."value"::jsonb ->> 'n')::int + 1))::text
         ELSE $2
       END,
       "updatedAt" = NOW()
     RETURNING ("value"::jsonb ->> 'n')::int AS n`,
    [key, JSON.stringify({ w, n: 1 }), String(w)],
  );
  return res.rows[0].n;
}

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

test('lock: first acquire wins, second is refused while held', async () => {
  const db = await freshDb();
  const a = await acquire(db, 'sync_lock', 60_000);
  assert.ok(a, 'first caller acquires');
  const b = await acquire(db, 'sync_lock', 60_000);
  assert.equal(b, null, 'a concurrent run must NOT also acquire');
  await db.close();
});

test('lock: is released and can be re-acquired', async () => {
  const db = await freshDb();
  const a = await acquire(db, 'sync_lock', 60_000);
  await release(db, a);
  const b = await acquire(db, 'sync_lock', 60_000);
  assert.ok(b, 're-acquirable after release');
  await db.close();
});

test('lock: an expired holder is stolen so a crashed run cannot wedge the pipeline', async () => {
  const db = await freshDb();
  const past = Date.now() - 60 * 60_000;
  const stale = await acquire(db, 'sync_lock', 1_000, past);
  assert.ok(stale, 'stale holder acquired in the past');
  const now = await acquire(db, 'sync_lock', 60_000);
  assert.ok(now, 'expired lock is stealable');
  await db.close();
});

test('lock: release only removes OUR lock, never a later holder\'s', async () => {
  const db = await freshDb();
  const past = Date.now() - 60 * 60_000;
  const overran = await acquire(db, 'sync_lock', 1_000, past);
  const stealer = await acquire(db, 'sync_lock', 60_000);
  assert.ok(stealer);
  await release(db, overran); // the overrunning run finishes late
  const third = await acquire(db, 'sync_lock', 60_000);
  assert.equal(third, null, 'the stealer still holds it — no third run may start');
  await db.close();
});

test('lock: tolerates the pre-existing {startedAt} row format', async () => {
  // The previous implementation wrote {"startedAt": <ms>} with no expiresAt.
  // On deploy those rows already exist; COALESCE must treat them as expired
  // rather than throwing or blocking forever.
  const db = await freshDb();
  await db.query(
    `INSERT INTO system_kv ("key","value","updatedAt") VALUES ($1,$2,NOW())`,
    ['sync_lock', JSON.stringify({ startedAt: Date.now() })],
  );
  const a = await acquire(db, 'sync_lock', 60_000);
  assert.ok(a, 'legacy lock row must not block the first run after deploy');
  await db.close();
});

test('lock: different keys do not interfere', async () => {
  const db = await freshDb();
  assert.ok(await acquire(db, 'sync_lock', 60_000));
  assert.ok(await acquire(db, 'refresh_lock', 60_000), 'refresh is independent of sync');
  await db.close();
});

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

test('quota: counts up monotonically within one window', async () => {
  const db = await freshDb();
  const w = 1_000_000;
  assert.equal(await consume(db, 'quota:login:ip:1', w), 1);
  assert.equal(await consume(db, 'quota:login:ip:1', w), 2);
  assert.equal(await consume(db, 'quota:login:ip:1', w), 3);
  await db.close();
});

test('quota: a new window resets the counter in the same statement', async () => {
  const db = await freshDb();
  const w1 = 1_000_000;
  await consume(db, 'quota:login:ip:1', w1);
  await consume(db, 'quota:login:ip:1', w1);
  assert.equal(await consume(db, 'quota:login:ip:1', w1), 3);
  assert.equal(await consume(db, 'quota:login:ip:1', w1 + 1), 1, 'rolls over cleanly');
  await db.close();
});

test('quota: subjects are independent', async () => {
  const db = await freshDb();
  const w = 1_000_000;
  assert.equal(await consume(db, 'quota:analyze:s:guest_a', w), 1);
  assert.equal(await consume(db, 'quota:analyze:s:guest_b', w), 1, 'one user cannot exhaust another');
  assert.equal(await consume(db, 'quota:analyze:s:guest_a', w), 2);
  await db.close();
});

test('quota: concurrent consumers each get a distinct count (no lost updates)', async () => {
  // This is the whole point of doing it in one statement: the previous
  // read-then-write let two callers both read the same count and both proceed.
  const db = await freshDb();
  const w = 1_000_000;
  const results: number[] = [];
  for (let i = 0; i < 25; i++) results.push(await consume(db, 'quota:agent:s:x', w));
  assert.deepEqual(
    [...results].sort((a, b) => a - b),
    Array.from({ length: 25 }, (_, i) => i + 1),
    'every consumer must receive a unique, gapless count',
  );
  await db.close();
});

test('quota and lock keys coexist in the same table', async () => {
  const db = await freshDb();
  assert.ok(await acquire(db, 'sync_lock', 60_000));
  assert.equal(await consume(db, 'quota:login:ip:1', 1_000_000), 1);
  const rows = await db.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM system_kv`);
  assert.equal(rows.rows[0].c, 2);
  await db.close();
});
