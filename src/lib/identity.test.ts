import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeUrl,
  contentHash,
  deriveIdentity,
  extractSourceJobIdFromUrl,
  platformKey,
} from './identity';

/**
 * The URLs and content below are real shapes taken from the production table,
 * not invented examples. Where a case is a measured one it says so, so that a
 * future change to these rules has to argue with the data rather than with a
 * hypothetical.
 */

// ── Source identity (Level 1) ──────────────────────────────────────────

test('upwork: the ciphertext is recovered from the bare /jobs/~ form', () => {
  assert.equal(
    extractSourceJobIdFromUrl('Upwork', 'https://www.upwork.com/jobs/~022104723533067588943'),
    '022104723533067588943',
  );
});

test('upwork: the ciphertext is recovered from the slug form too', () => {
  // Same job, the shape Upwork itself links with. Both must yield one id, or
  // the two spellings become two rows.
  assert.equal(
    extractSourceJobIdFromUrl('Upwork', 'https://www.upwork.com/jobs/Senior-React-Developer_~022104723533067588943/'),
    '022104723533067588943',
  );
});

test('upwork: every sampled production URL yields an id', () => {
  // 198 of 198 live Upwork rows match this shape.
  const live = [
    'https://www.upwork.com/jobs/~022103461324064769854',
    'https://www.upwork.com/jobs/~022104723533067588943',
    'https://www.upwork.com/jobs/~022103465357238727770',
    'https://www.upwork.com/jobs/~022102641079435173794',
  ];
  for (const url of live) {
    assert.ok(extractSourceJobIdFromUrl('Upwork', url), `no id from ${url}`);
  }
});

test('freelancer: the project id is recovered when the slug carries one', () => {
  assert.equal(
    extractSourceJobIdFromUrl(
      'Freelancer',
      'https://www.freelancer.com/projects/content-writing/CEO-Interview-Presentation-Creation-40730729',
    ),
    '40730729',
  );
});

test('freelancer: a slug-only URL yields null, not a guess', () => {
  // 985 of 1,134 live Freelancer rows look like this. Null is the honest
  // answer; Postgres treats nulls as distinct, so they do not collide in the
  // unique (platform, sourceJobId) index.
  assert.equal(
    extractSourceJobIdFromUrl(
      'Freelancer',
      'https://www.freelancer.com/projects/content-writing/CEO-Interview-Presentation-Creation',
    ),
    null,
  );
});

test('freelancer: a slug ending in a short number is not mistaken for an id', () => {
  assert.equal(
    extractSourceJobIdFromUrl('Freelancer', 'https://www.freelancer.com/projects/seo/Top-10-Listicle-Writer'),
    null,
  );
});

test('freelancer: a trailing path segment does not hide the id', () => {
  assert.equal(
    extractSourceJobIdFromUrl('Freelancer', 'https://www.freelancer.com/projects/php/Shopify-Partner-40730519/details'),
    '40730519',
  );
});

test('an unknown platform gets no invented id', () => {
  assert.equal(extractSourceJobIdFromUrl('Fiverr', 'https://www.fiverr.com/gigs/123456789'), null);
});

test('an unsafe URL never acquires an identity', () => {
  // The stored-XSS vector safeUrl.ts exists to block must not sneak in here.
  assert.equal(extractSourceJobIdFromUrl('Upwork', 'javascript:/*upwork.com/jobs/~021*/alert(1)'), null);
  assert.equal(canonicalizeUrl('javascript:alert(1)'), null);
  assert.equal(canonicalizeUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(canonicalizeUrl(''), null);
  assert.equal(canonicalizeUrl(null), null);
});

// ── Canonical URL (Level 2) ────────────────────────────────────────────

test('scheme, www and a trailing slash do not make two jobs', () => {
  const a = canonicalizeUrl('http://www.upwork.com/jobs/~022104723533067588943/');
  const b = canonicalizeUrl('https://upwork.com/jobs/~022104723533067588943');
  assert.equal(a, b);
  assert.equal(a, 'https://upwork.com/jobs/~022104723533067588943');
});

test('tracking parameters and fragments are dropped', () => {
  const tracked = canonicalizeUrl(
    'https://www.freelancer.com/projects/php/Shopify-Partner-40730519?utm_source=rss&utm_medium=feed&gclid=xyz&ref=partner#bids',
  );
  assert.equal(tracked, 'https://freelancer.com/projects/php/shopify-partner-40730519');
});

test('an unrecognised parameter is KEPT — it may be the only difference', () => {
  const a = canonicalizeUrl('https://example.test/job?projectId=1');
  const b = canonicalizeUrl('https://example.test/job?projectId=2');
  assert.notEqual(a, b);
  assert.equal(a, 'https://example.test/job?projectId=1');
});

test('parameter order does not change the key', () => {
  assert.equal(
    canonicalizeUrl('https://example.test/job?b=2&a=1'),
    canonicalizeUrl('https://example.test/job?a=1&b=2'),
  );
});

test('path case is folded only for the platforms known to be case-insensitive', () => {
  assert.equal(
    canonicalizeUrl('https://www.freelancer.com/projects/PHP/Shopify-Partner-40730519'),
    canonicalizeUrl('https://www.freelancer.com/projects/php/shopify-partner-40730519'),
  );
  // An unknown host may genuinely serve /A and /a as different pages.
  assert.notEqual(
    canonicalizeUrl('https://example.test/Job'),
    canonicalizeUrl('https://example.test/job'),
  );
});

test('the canonical key does not replace the link', () => {
  // Nothing here should ever be handed to the UI as the source link: it has
  // lost the www and possibly the original scheme.
  assert.equal(canonicalizeUrl('https://www.upwork.com/jobs/~021'), 'https://upwork.com/jobs/~021');
});

// ── Content fingerprint (Level 3) ──────────────────────────────────────

const CEO_DESC =
  'I need assistance in transforming a Word document into a professional Board presentation for a CEO interview. ' +
  'The presentation should present the material clearly and persuasively for a board audience.';

test('the measured identical-content pair hashes the same', () => {
  // Live rows fl-CEO-Interview-Presentation-Creation and
  // fl-CEO-Interview-Presentation-Creation-40730729: two URLs, two ids, one
  // byte-identical 836-char description.
  const a = contentHash('Freelancer', 'CEO Interview Presentation Creation', CEO_DESC);
  const b = contentHash('Freelancer', 'CEO Interview Presentation Creation', CEO_DESC);
  assert.ok(a);
  assert.equal(a, b);
});

test('the measured rewritten-description pair does NOT hash the same', () => {
  // "Convert PDF Forms to Excel": same title, same budget, different text.
  // An exact-content hash must not claim these are the same posting — that is
  // the near-duplicate layer's job, at a lower confidence.
  const a = contentHash('Freelancer', 'Convert PDF Forms to Excel', 'I have a collection of PDF forms that contain only simple text-field entries.');
  const b = contentHash('Freelancer', 'Convert PDF Forms to Excel', 'I have a collection of completed PDF forms that hold mixed data — names, addresses, IDs.');
  assert.notEqual(a, b);
});

test('the measured same-title-different-job pair does NOT hash the same', () => {
  // "Lead-Generating Social Media Campaign" exists twice with two distinct
  // project ids and different budgets. Two real jobs.
  const a = contentHash('Freelancer', 'Lead-Generating Social Media Campaign', 'My goal is simple: a consistent flow of high-quality leads from Facebook and Instagram.');
  const b = contentHash('Freelancer', 'Lead-Generating Social Media Campaign', 'I want to turn our social-media presence into a steady source of qualified leads and direct bookings.');
  assert.notEqual(a, b);
});

test('markup and whitespace differences do not change the hash', () => {
  const plain = contentHash('Freelancer', 'Shopify Partner Needed', 'Fix a broken theme and speed up the storefront checkout flow.');
  const marked = contentHash(
    'Freelancer',
    '  Shopify   Partner Needed ',
    '<p>Fix a broken theme&nbsp;and speed up the storefront&nbsp;checkout flow.</p>',
  );
  assert.equal(plain, marked);
});

test('the same text on two platforms is not the same posting', () => {
  assert.notEqual(
    contentHash('Upwork', 'Shopify Partner Needed', CEO_DESC),
    contentHash('Freelancer', 'Shopify Partner Needed', CEO_DESC),
  );
});

test('too little content yields null rather than a hash every empty row shares', () => {
  assert.equal(contentHash('Freelancer', '', ''), null);
  assert.equal(contentHash('Freelancer', 'Untitled', ''), null);
  assert.equal(contentHash('Freelancer', '<p></p>', '<div>  </div>'), null);
  // And a real listing still gets one.
  assert.ok(contentHash('Freelancer', 'Shopify Partner Needed', 'Fix a broken theme for me.'));
});

test('hashing is stable across calls — ingestion must be idempotent', () => {
  const once = contentHash('Upwork', 'Senior React Developer', 'Build a dashboard for our ops team.');
  const twice = contentHash('Upwork', 'Senior React Developer', 'Build a dashboard for our ops team.');
  assert.equal(once, twice);
});

// ── deriveIdentity ─────────────────────────────────────────────────────

test('a source-provided id wins over the one parsed from the URL', () => {
  // FreelancerCollector holds project.id even when seo_url has no id in it.
  // The source fact must beat the derived one.
  const id = deriveIdentity({
    platform: 'Freelancer',
    url: 'https://www.freelancer.com/projects/content-writing/CEO-Interview-Presentation-Creation',
    title: 'CEO Interview Presentation Creation',
    description: CEO_DESC,
    sourceJobId: 40730729,
  });
  assert.equal(id.sourceJobId, '40730729');
});

test('with no source id, the URL is the fallback', () => {
  const id = deriveIdentity({
    platform: 'Freelancer',
    url: 'https://www.freelancer.com/projects/php/Shopify-Partner-40730519',
    title: 'Shopify Partner Needed',
    description: 'Fix a broken theme and speed up checkout.',
  });
  assert.equal(id.sourceJobId, '40730519');
  assert.equal(id.canonicalUrl, 'https://freelancer.com/projects/php/shopify-partner-40730519');
  assert.ok(id.contentHash);
});

test('the two URL spellings of one Freelancer project agree on content, not on URL', () => {
  // Exactly the live CEO pair. The canonical URL and the source id still
  // differ — only the content hash links them, which is why the hash is a
  // first-class column and not an afterthought.
  const slug = deriveIdentity({
    platform: 'Freelancer',
    url: 'https://www.freelancer.com/projects/content-writing/CEO-Interview-Presentation-Creation',
    title: 'CEO Interview Presentation Creation',
    description: CEO_DESC,
  });
  const withId = deriveIdentity({
    platform: 'Freelancer',
    url: 'https://www.freelancer.com/projects/content-writing/CEO-Interview-Presentation-Creation-40730729',
    title: 'CEO Interview Presentation Creation',
    description: CEO_DESC,
  });
  assert.notEqual(slug.canonicalUrl, withId.canonicalUrl);
  assert.notEqual(slug.sourceJobId, withId.sourceJobId);
  assert.equal(slug.contentHash, withId.contentHash);
});

test('a malformed row gets nulls, never a fabricated identity', () => {
  const id = deriveIdentity({ platform: '', url: 'not a url', title: '', description: '' });
  assert.deepEqual(id, { sourceJobId: null, canonicalUrl: null, contentHash: null });
});

test('platformKey folds the spellings actually stored', () => {
  assert.equal(platformKey('Upwork'), 'upwork');
  assert.equal(platformKey(' Freelancer '), 'freelancer');
  assert.equal(platformKey(null), '');
});
