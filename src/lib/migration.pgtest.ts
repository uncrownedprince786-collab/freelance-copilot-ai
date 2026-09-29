import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Applies the real migration files, in order, to a real Postgres (PGlite =
// Postgres compiled to WASM), against rows shaped like the ones actually in
// production. This is the rehearsal that the previous `prisma db push` workflow
// had no way to perform: there was no migration history, so a schema change
// went straight at the production database with no dry run and no rollback.
//
// The rows below mirror measured production shapes, including the awkward ones:
// Freelancer listings with NO client data at all (84% of current inventory),
// Upwork listings with partial client data, a blank title, and a malformed
// rawPayload that must not abort the migration.

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();
}

/**
 * Apply pending migrations in order, tracking what this db has already had
 * applied, so a test can stop at the baseline, seed rows, then continue —
 * which is exactly the production situation being rehearsed.
 */
async function applyMigrations(db: PGlite, upTo?: string): Promise<void> {
  const applied = (db as PGlite & { __applied?: Set<string> }).__applied ?? new Set<string>();
  (db as PGlite & { __applied?: Set<string> }).__applied = applied;
  for (const dir of migrationFiles()) {
    if (applied.has(dir)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');
    await db.exec(sql);
    applied.add(dir);
    if (upTo && dir === upTo) return;
  }
}

const BASELINE = '00000000000000_baseline';

async function seedProductionLikeRows(db: PGlite): Promise<void> {
  const rows: Array<[string, string, string, string, string, string, string]> = [
    // id, title, description, platform, url, createdAt, rawPayload
    [
      'uw-1', 'Senior React Developer', 'Build a dashboard.', 'Upwork',
      'https://www.upwork.com/jobs/~022103385384814140053', '2026-09-28T10:00:00Z',
      JSON.stringify({ postedAt: '2026-09-28T09:00:00.000Z', country: 'Germany', totalSpent: 5084.05, rating: 5, jobsPosted: 12 }),
    ],
    [
      'fl-project-40730519', 'Shopify Partner Needed', 'Fix a theme.', 'Freelancer',
      'https://www.freelancer.com/projects/php/Verified-Shopify-Partner-40730519', '2026-09-29T06:00:00Z',
      // Freelancer rows genuinely carry no client signal at all.
      JSON.stringify({ postedAt: '2026-09-29T05:08:01.000Z', country: 'Remote' }),
    ],
    [
      'fl-project-40734722', '', 'A project with a blank title.', 'Freelancer',
      'https://www.freelancer.com/projects/misc/blank-40734722', '2026-09-29T06:10:00Z',
      JSON.stringify({ postedAt: '2026-09-29T06:00:00.000Z' }),
    ],
    [
      'bad-1', 'Malformed payload row', 'Payload is not JSON.', 'Freelancer',
      'https://www.freelancer.com/projects/misc/bad-1', '2026-09-27T00:00:00Z',
      'not json at all',
    ],
    [
      'bad-2', 'Payload missing postedAt', 'No postedAt key.', 'Upwork',
      'https://www.upwork.com/jobs/~0221000000000000001', '2026-09-26T00:00:00Z',
      JSON.stringify({ country: 'Remote' }),
    ],
    [
      'bad-3', 'Future postedAt', 'Source clock skew.', 'Upwork',
      'https://www.upwork.com/jobs/~0221000000000000002', '2026-09-25T00:00:00Z',
      JSON.stringify({ postedAt: '2099-01-01T00:00:00.000Z' }),
    ],
    [
      'bad-4', 'Unparseable postedAt', 'Garbage timestamp.', 'Freelancer',
      'https://www.freelancer.com/projects/misc/bad-4', '2026-09-24T00:00:00Z',
      JSON.stringify({ postedAt: 'yesterday-ish' }),
    ],
  ];

  for (const [id, title, description, platform, url, createdAt, rawPayload] of rows) {
    await db.query(
      `INSERT INTO "opportunities"
         ("id","title","description","budget","platform","url","createdAt","score","risk","viewed","status","rawPayload")
       VALUES ($1,$2,$3,'Negotiable',$4,$5,$6::timestamp,50,'Medium',false,'OPEN',$7)`,
      [id, title, description, platform, url, createdAt, rawPayload],
    );
  }
}

test('migrations apply cleanly in order to an empty database', async () => {
  const db = new PGlite();
  await applyMigrations(db);
  const t = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`,
  );
  assert.deepEqual(
    t.rows.map(r => r.table_name),
    ['analyses', 'cron_logs', 'market_facts', 'opportunities', 'project_tracking', 'system_kv', 'user_sessions'],
  );
  await db.close();
});

test('the data-quality migration preserves every existing row', async () => {
  const db = new PGlite();
  await applyMigrations(db, BASELINE);
  await seedProductionLikeRows(db);
  const before = await db.query<{ n: number }>(`SELECT COUNT(*)::int n FROM "opportunities"`);

  await applyMigrations(db); // replays baseline (idempotent DDL guards) + the new one

  const after = await db.query<{ n: number }>(`SELECT COUNT(*)::int n FROM "opportunities"`);
  assert.equal(after.rows[0].n, before.rows[0].n, 'no row may be lost');
  assert.equal(after.rows[0].n, 7);
  await db.close();
});

test('postedAt is backfilled from rawPayload, and never left null', async () => {
  const db = new PGlite();
  await applyMigrations(db, BASELINE);
  await seedProductionLikeRows(db);
  await applyMigrations(db);

  const nulls = await db.query<{ n: number }>(`SELECT COUNT(*)::int n FROM "opportunities" WHERE "postedAt" IS NULL`);
  assert.equal(nulls.rows[0].n, 0, 'every row ends with a usable postedAt');

  // Read back as TEXT, not as a Date. These columns are `timestamp without
  // time zone` holding UTC wall-clock (the convention Prisma uses), and the
  // driver materialises that as a JS Date in the TEST RUNNER's local zone — so
  // `.toISOString()` only agrees with the stored value on a UTC machine. That
  // made this assertion pass in CI and fail on a developer's laptop for a
  // migration that was correct. `to_char` renders what is actually stored,
  // identically everywhere.
  const uw = await db.query<{ posted: string }>(
    `SELECT to_char("postedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS posted
       FROM "opportunities" WHERE id='uw-1'`,
  );
  assert.equal(
    uw.rows[0].posted,
    '2026-09-28T09:00:00.000Z',
    'the source posting time is used, not the insert time',
  );
  await db.close();
});

test('a malformed rawPayload does not abort the migration and falls back to createdAt', async () => {
  const db = new PGlite();
  await applyMigrations(db, BASELINE);
  await seedProductionLikeRows(db);
  await applyMigrations(db);

  for (const id of ['bad-1', 'bad-2', 'bad-4']) {
    // Text again: two Dates in a non-UTC zone can also straddle a DST
    // boundary and pick up different offsets, which would make equal stored
    // values compare unequal.
    const r = await db.query<{ posted: string; created: string }>(
      `SELECT to_char("postedAt",  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS posted,
              to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created
         FROM "opportunities" WHERE id=$1`, [id],
    );
    assert.equal(
      r.rows[0].posted,
      r.rows[0].created,
      `${id} falls back to createdAt rather than failing`,
    );
  }
  await db.close();
});

test('a future postedAt is clamped to now, never stored as the future', async () => {
  // A future posting time would pin the row to the top of the feed forever and
  // exempt it from age-based purging.
  const db = new PGlite();
  await applyMigrations(db, BASELINE);
  await seedProductionLikeRows(db);
  await applyMigrations(db);

  // Compared inside the database, against the same UTC wall-clock convention
  // the migration writes with, so the verdict does not depend on where the
  // test runs. Read into JS as a Date, a naive-UTC value west of UTC comes
  // back in the future and this assertion fails on a correct migration.
  const r = await db.query<{ clamped: boolean }>(
    `SELECT ("postedAt" <= (NOW() AT TIME ZONE 'UTC')) AS clamped
       FROM "opportunities" WHERE id='bad-3'`,
  );
  assert.ok(r.rows[0].clamped, 'clamped to now, never stored as the future');
  await db.close();
});

test('firstSeenAt and lastSeenAt are backfilled from createdAt', async () => {
  const db = new PGlite();
  await applyMigrations(db, BASELINE);
  await seedProductionLikeRows(db);
  await applyMigrations(db);

  const r = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int n FROM "opportunities"
     WHERE "firstSeenAt" IS DISTINCT FROM "createdAt" OR "lastSeenAt" IS DISTINCT FROM "createdAt"`,
  );
  assert.equal(r.rows[0].n, 0);
  await db.close();
});

test('the unique (platform, sourceJobId) index tolerates all-null existing rows', async () => {
  // Postgres treats NULLs as distinct in a unique index. If it did not, this
  // migration would fail on a table where every row has a null sourceJobId.
  const db = new PGlite();
  await applyMigrations(db, BASELINE);
  await seedProductionLikeRows(db);
  await applyMigrations(db);

  const r = await db.query<{ n: number }>(`SELECT COUNT(*)::int n FROM "opportunities" WHERE "sourceJobId" IS NULL`);
  assert.equal(r.rows[0].n, 7, 'all rows still present with null sourceJobId');
  await db.close();
});

test('the unique (platform, sourceJobId) index blocks a real duplicate source id', async () => {
  const db = new PGlite();
  await applyMigrations(db);
  const ins = (id: string, url: string, platform: string, sourceJobId: string) =>
    db.query(
      `INSERT INTO "opportunities"
         ("id","title","description","budget","platform","url","createdAt","score","risk","viewed","status","sourceJobId")
       VALUES ($1,'t','d','Negotiable',$2,$3,NOW(),50,'Medium',false,'OPEN',$4)`,
      [id, platform, url, sourceJobId],
    );

  await ins('a', 'https://x.test/a', 'Upwork', '12345');
  await assert.rejects(
    () => ins('b', 'https://x.test/b', 'Upwork', '12345'),
    /unique|duplicate/i,
    'the database itself must reject the same source job id twice',
  );
  // The same id on a DIFFERENT platform is a different job.
  await ins('c', 'https://x.test/c', 'Freelancer', '12345');
  await db.close();
});

test('new columns carry their documented defaults', async () => {
  const db = new PGlite();
  await applyMigrations(db);
  await db.query(
    `INSERT INTO "opportunities"
       ("id","title","description","budget","platform","url","createdAt","score","risk","viewed","status")
     VALUES ('d','t','d','Negotiable','Upwork','https://x.test/d',NOW(),50,'Medium',false,'OPEN')`,
  );
  const r = await db.query<{ duplicateStatus: string; authenticityStatus: string; leadScore: number | null }>(
    `SELECT "duplicateStatus","authenticityStatus","leadScore" FROM "opportunities" WHERE id='d'`,
  );
  assert.equal(r.rows[0].duplicateStatus, 'unknown');
  assert.equal(r.rows[0].authenticityStatus, 'uncertain');
  assert.equal(r.rows[0].leadScore, null, 'an unscored row must be null, never a fabricated default');
  await db.close();
});

test('the redundant indexes are gone and the new ones exist', async () => {
  const db = new PGlite();
  await applyMigrations(db);
  const r = await db.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' ORDER BY 1`,
  );
  const names = r.rows.map(x => x.indexname);

  for (const gone of ['opportunities_platform_idx', 'opportunities_viewed_idx', 'market_facts_date_idx']) {
    assert.ok(!names.includes(gone), `${gone} should have been dropped`);
  }
  for (const present of [
    'opportunities_postedAt_idx',
    'opportunities_platform_postedAt_idx',
    'opportunities_contentHash_idx',
    'opportunities_duplicateClusterId_idx',
    'opportunities_platform_sourceJobId_key',
    'cron_logs_timestamp_idx',
    'user_sessions_lastSeen_idx',
    'market_facts_dimension_date_idx',
  ]) {
    assert.ok(names.includes(present), `${present} should exist`);
  }
  await db.close();
});

test('the scheduler hour histogram reads UTC, not the server timezone', async () => {
  // syncSchedule.liveHourCounts used to pull every row's rawPayload and parse
  // JSON per row; it now groups by hour in SQL over the indexed postedAt
  // column. postedAt is `timestamp without time zone` holding UTC
  // wall-clock, so EXTRACT must give the UTC hour with no conversion — the
  // same trap that made this suite pass only on a UTC machine.
  const db = new PGlite();
  await applyMigrations(db, BASELINE);
  await seedProductionLikeRows(db);
  await applyMigrations(db);

  const rows = await db.query<{ hour: number; n: number }>(
    `SELECT EXTRACT(HOUR FROM COALESCE("postedAt", "createdAt"))::int AS hour,
            COUNT(*)::int AS n
       FROM "opportunities"
      GROUP BY 1 ORDER BY 1`,
  );
  const counts = new Array<number>(24).fill(0);
  for (const r of rows.rows) counts[r.hour] = r.n;

  // uw-1 carries rawPayload.postedAt = 2026-09-28T09:00:00Z, so it must land
  // in hour 9 wherever this test runs.
  assert.equal(counts[9], 1, 'the 09:00 UTC listing must be counted in hour 9');
  // fl-project-40734722 is 2026-09-29T06:00:00Z.
  assert.equal(counts[6], 1, 'the 06:00 UTC listing must be counted in hour 6');
  assert.equal(counts.reduce((a, b) => a + b, 0), 7, 'every seeded row is counted exactly once');

  await db.close();
});
