import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identityFields, resolveIdentity, sourcePostedAt, IdentityLookup } from './ingestIdentity';
import { deriveIdentity } from './identity';

type Row = {
  id: string;
  platform: string;
  sourceJobId: string | null;
  url: string;
  canonicalUrl: string | null;
};

/** A stub standing in for Prisma: it applies the OR the same way the database
 *  would, so the priority logic is what is under test, not the query. */
function stubDb(rows: Row[]): IdentityLookup & { calls: number } {
  const db = {
    calls: 0,
    opportunity: {
      async findMany(args: { where: { OR: Array<Record<string, unknown>> }; take: number }) {
        db.calls++;
        const matched = rows.filter(r =>
          args.where.OR.some(cond =>
            Object.entries(cond).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v),
          ),
        );
        return matched.slice(0, args.take);
      },
    },
  };
  return db as unknown as IdentityLookup & { calls: number };
}

function row(over: Partial<Row> & { id: string }): Row {
  return {
    platform: 'Freelancer',
    sourceJobId: null,
    url: 'https://www.freelancer.com/projects/php/x-40730519',
    canonicalUrl: 'https://freelancer.com/projects/php/x-40730519',
    ...over,
  };
}

const CEO_DESC =
  'I need assistance in transforming a Word document into a professional Board presentation for a CEO interview.';

test('a genuinely new listing matches nothing', async () => {
  const db = stubDb([]);
  const r = await resolveIdentity(db, {
    platform: 'Freelancer',
    url: 'https://www.freelancer.com/projects/php/Shopify-Partner-40730519',
    title: 'Shopify Partner Needed',
    description: 'Fix a broken theme and speed up checkout.',
  });
  assert.equal(r.existingId, null);
  assert.equal(r.matchedBy, null);
  assert.equal(r.identity.sourceJobId, '40730519');
});

test('the source id wins over the URL — the slug/id split stops here', async () => {
  // The live failure: the same Freelancer project arrives under a slug-only
  // URL after it was first stored under the slug+id URL. Keyed on URL this
  // inserts a second row; keyed on the source id it updates the first.
  const existing = row({
    id: 'fl-ceo-40730729',
    sourceJobId: '40730729',
    url: 'https://www.freelancer.com/projects/content-writing/CEO-Interview-Presentation-Creation-40730729',
    canonicalUrl: 'https://freelancer.com/projects/content-writing/ceo-interview-presentation-creation-40730729',
  });
  const db = stubDb([existing]);
  const r = await resolveIdentity(db, {
    platform: 'Freelancer',
    url: 'https://www.freelancer.com/projects/content-writing/CEO-Interview-Presentation-Creation',
    title: 'CEO Interview Presentation Creation',
    description: CEO_DESC,
    sourceJobId: '40730729', // the collector has project.id even when the slug does not
  });
  assert.equal(r.existingId, 'fl-ceo-40730729');
  assert.equal(r.matchedBy, 'sourceJobId');
});

test('an exact URL match still works when there is no source id', async () => {
  const existing = row({ id: 'fl-slug', sourceJobId: null, url: 'https://www.freelancer.com/projects/seo/Slug-Only' });
  const db = stubDb([existing]);
  const r = await resolveIdentity(db, {
    platform: 'Freelancer',
    url: 'https://www.freelancer.com/projects/seo/Slug-Only',
    title: 'Slug Only',
    description: 'A project with no id in its URL at all.',
  });
  assert.equal(r.existingId, 'fl-slug');
  assert.equal(r.matchedBy, 'url');
});

test('a tracking-parameter variant of a stored URL is the same job', async () => {
  const existing = row({
    id: 'fl-tracked',
    sourceJobId: null,
    url: 'https://www.freelancer.com/projects/seo/Slug-Only',
    canonicalUrl: 'https://freelancer.com/projects/seo/slug-only',
  });
  const db = stubDb([existing]);
  const r = await resolveIdentity(db, {
    platform: 'Freelancer',
    url: 'https://www.freelancer.com/projects/seo/Slug-Only?utm_source=rss#bids',
    title: 'Slug Only',
    description: 'A project with no id in its URL at all.',
  });
  assert.equal(r.existingId, 'fl-tracked');
  assert.equal(r.matchedBy, 'canonicalUrl');
});

test('identical content is NOT treated as the same row', async () => {
  // The measured CEO pair: same content, different budgets, a day apart. It
  // may be a repost, which is a real second opportunity. Ingestion must not
  // collapse it — that is the clustering layer's call, at a stated confidence.
  const existing = row({
    id: 'fl-ceo-a',
    sourceJobId: null,
    url: 'https://www.freelancer.com/projects/content-writing/CEO-Interview-Presentation-Creation',
    canonicalUrl: 'https://freelancer.com/projects/content-writing/ceo-interview-presentation-creation',
  });
  const db = stubDb([existing]);
  const r = await resolveIdentity(db, {
    platform: 'Freelancer',
    url: 'https://www.freelancer.com/projects/content-writing/CEO-Interview-Presentation-Creation-40730729',
    title: 'CEO Interview Presentation Creation',
    description: CEO_DESC,
  });
  assert.equal(r.existingId, null, 'a content match must not merge rows at ingest');
  // ...but both rows carry the same hash, so the cluster can still be found.
  assert.equal(
    r.identity.contentHash,
    deriveIdentity({ platform: 'Freelancer', url: existing.url, title: 'CEO Interview Presentation Creation', description: CEO_DESC }).contentHash,
  );
});

test('the same source id on another platform is a different job', async () => {
  const existing = row({ id: 'uw', platform: 'Upwork', sourceJobId: '40730519', url: 'https://www.upwork.com/jobs/~040730519' });
  const db = stubDb([existing]);
  const r = await resolveIdentity(db, {
    platform: 'Freelancer',
    url: 'https://www.freelancer.com/projects/php/Other-40730519',
    title: 'Other',
    description: 'A Freelancer project that happens to share a number with an Upwork job.',
  });
  assert.equal(r.existingId, null);
});

test('resolution costs exactly one query', async () => {
  // Ingestion runs this per record, on Neon Free. Three sequential lookups
  // per listing would be the most expensive thing in the pipeline.
  const db = stubDb([row({ id: 'a', sourceJobId: '40730519' })]);
  await resolveIdentity(db, {
    platform: 'Freelancer',
    url: 'https://www.freelancer.com/projects/php/x-40730519',
    title: 'x',
    description: 'A description long enough to fingerprint properly.',
  });
  assert.equal((db as unknown as { calls: number }).calls, 1);
});

test('a listing with no usable key does not query at all', async () => {
  // An empty URL yields no source id, no canonical URL and no legacy key, so
  // there is nothing to look up. A malformed-but-present URL still queries:
  // it is the legacy upsert key and a row may exist under it.
  const db = stubDb([row({ id: 'a' })]);
  const r = await resolveIdentity(db, { platform: 'Freelancer', url: '', title: '', description: '' });
  assert.equal((db as unknown as { calls: number }).calls, 0);
  assert.equal(r.existingId, null);
});

// ── posting time ───────────────────────────────────────────────────────

test('a future posting time is clamped to now, never stored ahead', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  assert.equal(sourcePostedAt('2099-01-01T00:00:00Z', now)?.toISOString(), now.toISOString());
});

test('a real posting time passes through untouched', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  assert.equal(sourcePostedAt('2026-09-28T09:00:00.000Z', now)?.toISOString(), '2026-09-28T09:00:00.000Z');
  assert.equal(sourcePostedAt(new Date('2026-09-28T09:00:00Z'), now)?.toISOString(), '2026-09-28T09:00:00.000Z');
});

test('unusable posting times give null rather than an invented one', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  assert.equal(sourcePostedAt(null, now), null);
  assert.equal(sourcePostedAt(undefined, now), null);
  assert.equal(sourcePostedAt('yesterday-ish', now), null);
  assert.equal(sourcePostedAt('', now), null);
  assert.equal(sourcePostedAt(0, now), null);
  assert.equal(sourcePostedAt('0', now), null);
});

test('an epoch from the source is read as a time, not as a year', () => {
  // Freelancer's submitdate is epoch SECONDS; other payloads carry
  // milliseconds. Both must land on the same instant.
  const now = new Date('2026-09-30T12:00:00Z');
  assert.equal(sourcePostedAt(1759231200, now)?.toISOString(), '2025-09-30T11:20:00.000Z');
  assert.equal(sourcePostedAt(1759231200000, now)?.toISOString(), '2025-09-30T11:20:00.000Z');
  assert.equal(sourcePostedAt('1759231200', now)?.toISOString(), '2025-09-30T11:20:00.000Z');
});

// ── written fields ─────────────────────────────────────────────────────

test('every ingest advances lastSeenAt and writes all three keys', () => {
  const seen = new Date('2026-09-30T12:00:00Z');
  const posted = new Date('2026-09-28T09:00:00Z');
  const f = identityFields(
    { sourceJobId: '40730519', canonicalUrl: 'https://freelancer.com/x', contentHash: 'abc' },
    posted,
    seen,
  );
  assert.deepEqual(f, {
    sourceJobId: '40730519',
    canonicalUrl: 'https://freelancer.com/x',
    contentHash: 'abc',
    postedAt: posted,
    lastSeenAt: seen,
  });
});

test('a key this fetch could not derive is omitted, never nulled out', () => {
  // The update path uses these fields too. A later slug-only fetch of a
  // listing whose id an earlier fetch established must not erase it — that
  // would also free the unique-index slot that stops it being stored twice.
  const f = identityFields(
    { sourceJobId: null, canonicalUrl: 'https://freelancer.com/x', contentHash: null },
    null,
    new Date('2026-09-30T12:00:00Z'),
  );
  assert.ok(!('sourceJobId' in f), 'a null id must not be written over a real one');
  assert.ok(!('contentHash' in f));
  assert.equal(f.canonicalUrl, 'https://freelancer.com/x');
  assert.ok('lastSeenAt' in f, 'every sighting still advances lastSeenAt');
});

test('a missing posting time is omitted, not written as null over a good one', () => {
  // An update that set postedAt: null would erase a posting time an earlier,
  // richer fetch had already established.
  const f = identityFields(
    { sourceJobId: null, canonicalUrl: null, contentHash: null },
    null,
    new Date('2026-09-30T12:00:00Z'),
  );
  assert.ok(!('postedAt' in f));
});
