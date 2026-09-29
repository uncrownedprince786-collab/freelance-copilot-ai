import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockKey,
  blockingTitle,
  buildClusters,
  classifyPair,
  contentTokens,
  DuplicateCandidate,
  jaccard,
  repostMarker,
  selectCanonical,
} from './duplicates';

/**
 * Every case below is a shape measured in the live table. The three named
 * pairs are the ones the audit found by hand; the repost markers are
 * Freelancer's own conventions, observed in 39 same-normalized-title pairs.
 */

function row(over: Partial<DuplicateCandidate> & { id: string }): DuplicateCandidate {
  return {
    platform: 'Freelancer',
    title: 'Untitled',
    description: '',
    budget: 'Negotiable',
    clientName: 'Freelancer Client',
    sourceJobId: null,
    contentHash: null,
    postedAt: null,
    firstSeenAt: null,
    ...over,
  };
}

const CEO_DESC =
  'I need assistance in transforming a Word document into a professional Board presentation ' +
  'for a CEO interview. The presentation should present the material clearly and persuasively ' +
  'for a board audience, with clean slides and a coherent narrative throughout.';

// ── Normalisation ──────────────────────────────────────────────────────

test('freelancer repost markers are recognised', () => {
  assert.equal(repostMarker('Independent B2B Sales Representative — U.S. Market -- 2'), 'numbered');
  assert.equal(repostMarker('Edit Engaging Promotional Video - 29/09/2026 01:13 EDT'), 'timestamped');
  assert.equal(repostMarker('Shopify Partner Needed'), null);
  // A number that is part of the job, not a repost counter.
  assert.equal(repostMarker('Build 3 landing pages'), null);
});

test('blocking folds the repost marker away but display text is untouched', () => {
  assert.equal(
    blockingTitle('Independent B2B Sales Representative — U.S. Market -- 2'),
    blockingTitle('Independent B2B Sales Representative — U.S. Market'),
  );
  assert.equal(
    blockingTitle('Edit Engaging Promotional Video - 29/09/2026 01:13 EDT'),
    blockingTitle('Edit Engaging Promotional Video - 28/09/2026 14:13 EDT'),
  );
  assert.equal(blockingTitle('Convert PDF Forms to Excel'), 'convert pdf forms to excel');
});

test('an empty title yields no blocking key — blanks must not block together', () => {
  assert.equal(blockKey(row({ id: 'a', title: '' })), null);
  assert.equal(blockKey(row({ id: 'b', title: '   ---   ' })), null);
  assert.equal(blockKey(row({ id: 'c', title: 'Shopify Partner' })), 'Freelancer|shopify partner');
});

test('the same title on two platforms does not block together', () => {
  assert.notEqual(
    blockKey(row({ id: 'a', title: 'Shopify Partner', platform: 'Upwork' })),
    blockKey(row({ id: 'b', title: 'Shopify Partner', platform: 'Freelancer' })),
  );
});

test('an empty token set is not similar to everything', () => {
  assert.equal(jaccard(new Set(), new Set(['a'])), 0);
  assert.equal(jaccard(contentTokens(''), contentTokens('some real words here')), 0);
});

// ── Pair classification: the measured pairs ────────────────────────────

test('measured: identical content is a duplicate at full confidence', () => {
  const a = row({ id: 'fl-ceo', title: 'CEO Interview Presentation Creation', description: CEO_DESC, contentHash: 'h1' });
  const b = row({ id: 'fl-ceo-40730729', title: 'CEO Interview Presentation Creation', description: CEO_DESC, contentHash: 'h1' });
  const v = classifyPair(a, b);
  assert.equal(v.status, 'duplicate');
  assert.equal(v.confidence, 1);
  assert.deepEqual(v.signals, ['exact_content']);
});

test('measured: a repost with an identical description is a duplicate, but never certain', () => {
  // "Independent B2B Sales Representative — U.S. Market" / "… -- 2":
  // identical description, same budget, a day apart.
  const a = row({
    id: 'a', title: 'Independent B2B Sales Representative — U.S. Market',
    description: CEO_DESC, budget: '{"type":"fixed","min":250,"max":750}',
    postedAt: new Date('2026-09-23T06:00:00Z'), contentHash: 'h-a',
  });
  const b = row({
    id: 'b', title: 'Independent B2B Sales Representative — U.S. Market -- 2',
    description: CEO_DESC, budget: '{"type":"fixed","min":250,"max":750}',
    postedAt: new Date('2026-09-24T06:00:00Z'), contentHash: 'h-b',
  });
  const v = classifyPair(a, b);
  assert.equal(v.status, 'duplicate');
  assert.ok(v.confidence >= 0.85 && v.confidence < 1, `expected high-but-not-certain, got ${v.confidence}`);
  assert.ok(v.signals.includes('description_identical'));
  assert.ok(v.signals.includes('same_normalized_title'));
  assert.ok(v.signals.includes('repost_marker'));
});

test('measured: a rewritten description is only a POSSIBLE duplicate', () => {
  // "Convert PDF Forms to Excel": same title, same budget, different text.
  const a = row({
    id: 'a', title: 'Convert PDF Forms to Excel', budget: '{"min":12500,"max":37500}',
    description: 'I have a collection of PDF forms that contain only simple text-field entries, no tables, grids or complex layouts, and I need every field captured accurately.',
    postedAt: new Date('2026-09-28T06:40:00Z'),
  });
  const b = row({
    id: 'b', title: 'Convert PDF Forms to Excel', budget: '{"min":12500,"max":37500}',
    description: 'I have a collection of completed PDF forms that hold mixed data such as names, addresses, identifiers, dates, quantities and dollar amounts across many pages.',
    postedAt: new Date('2026-09-29T08:14:00Z'),
  });
  const v = classifyPair(a, b);
  assert.equal(v.status, 'possible_duplicate', `got ${v.status} at ${v.confidence}`);
  assert.ok(v.confidence < 0.85);
});

test('measured: same title, different jobs — NOT a duplicate', () => {
  // "Lead-Generating Social Media Campaign" exists twice with two distinct
  // project ids, different budgets and unrelated descriptions.
  const a = row({
    id: 'a', title: 'Lead-Generating Social Media Campaign', sourceJobId: '40728469',
    budget: '{"min":1500,"max":12500}',
    description: 'My goal is simple: a consistent flow of high quality leads. I plan to reach them where they already spend time, Facebook and Instagram.',
    postedAt: new Date('2026-09-23T06:25:00Z'),
  });
  const b = row({
    id: 'b', title: 'Lead-Generating Social Media Campaign', sourceJobId: '40739437',
    budget: '{"min":600,"max":650}',
    description: 'I want to take my current project to the next level by turning our social media presence into a steady source of qualified bookings.',
    postedAt: new Date('2026-09-29T03:19:00Z'),
  });
  const v = classifyPair(a, b);
  assert.notEqual(v.status, 'duplicate');
  assert.ok(v.warnings.includes('distinct_source_ids'));
  assert.ok(v.warnings.includes('different_budget'));
});

test('measured: a shared title with no shared content is NOT a duplicate', () => {
  // "Digital Marketing Project" vs "Digital marketing": title 0.67, desc 0.00.
  const a = row({ id: 'a', title: 'Digital Marketing Project', description: 'Run paid search campaigns across Google Ads and report weekly on cost per acquisition.' });
  const b = row({ id: 'b', title: 'Digital marketing', description: 'Write twenty blog posts about sustainable gardening for a hobby website audience.' });
  const v = classifyPair(a, b);
  assert.equal(v.status, 'independent');
  assert.ok(v.confidence <= 0.5, 'a title-only match must stay well below the duplicate threshold');
});

test('title evidence alone can never reach the duplicate threshold', () => {
  const a = row({ id: 'a', title: 'Shopify Partner Needed', description: 'Completely unrelated text about fixing a broken checkout on a store.', budget: 'X', clientName: 'Acme Ltd', postedAt: new Date('2026-09-28T00:00:00Z') });
  const b = row({ id: 'b', title: 'Shopify Partner Needed', description: 'Another unrelated brief about designing brand assets for a new launch.', budget: 'X', clientName: 'Acme Ltd', postedAt: new Date('2026-09-28T01:00:00Z') });
  const v = classifyPair(a, b);
  assert.notEqual(v.status, 'duplicate');
  assert.ok(v.confidence <= 0.5);
});

test('two platforms are never the same listing', () => {
  const a = row({ id: 'a', platform: 'Upwork', title: 'Same Title', description: CEO_DESC, contentHash: 'h' });
  const b = row({ id: 'b', platform: 'Freelancer', title: 'Same Title', description: CEO_DESC, contentHash: 'h' });
  assert.equal(classifyPair(a, b).status, 'independent');
});

test('the placeholder client name identifies nobody and scores nothing', () => {
  const base = { description: CEO_DESC, budget: 'B', postedAt: new Date('2026-09-28T00:00:00Z') };
  const placeholder = classifyPair(
    row({ id: 'a', title: 'A Job', clientName: 'Freelancer Client', ...base }),
    row({ id: 'b', title: 'A Job', clientName: 'Freelancer Client', ...base }),
  );
  const named = classifyPair(
    row({ id: 'a', title: 'A Job', clientName: 'Northwind Trading', ...base }),
    row({ id: 'b', title: 'A Job', clientName: 'Northwind Trading', ...base }),
  );
  assert.ok(!placeholder.signals.includes('same_client'));
  assert.ok(named.signals.includes('same_client'));
});

test('an unstated budget is not budget agreement', () => {
  // 'Negotiable' is what this pipeline stores when the source gave no budget.
  // Two rows both saying so agree on nothing — the same trap as two rows both
  // named 'Freelancer Client'.
  const base = { title: 'A Job', description: 'Run paid search campaigns across Google Ads and report weekly on cost per acquisition figures.' };
  const placeholder = classifyPair(
    row({ id: 'a', budget: 'Negotiable', ...base }),
    row({ id: 'b', budget: 'Negotiable', ...base }),
  );
  assert.ok(!placeholder.signals.includes('same_budget'));
  assert.ok(!placeholder.warnings.includes('different_budget'), 'two unstated budgets do not disagree either');
  const stated = classifyPair(
    row({ id: 'a', budget: '{"min":500}', ...base }),
    row({ id: 'b', budget: '{"min":500}', ...base }),
  );
  assert.ok(stated.signals.includes('same_budget'));
});

test('a short description is flagged rather than trusted', () => {
  const a = row({ id: 'a', title: 'Quick Fix', description: 'Fix bug.' });
  const b = row({ id: 'b', title: 'Quick Fix', description: 'Fix bug.' });
  assert.ok(classifyPair(a, b).warnings.includes('short_text'));
});

// ── Canonical selection ────────────────────────────────────────────────

test('the earliest source posting time wins, and the reason says so', () => {
  const a = row({ id: 'a', postedAt: new Date('2026-09-24T08:40:00Z'), sourceJobId: '2' });
  const b = row({ id: 'b', postedAt: new Date('2026-09-23T03:43:00Z'), sourceJobId: '1' });
  const c = selectCanonical([a, b]);
  assert.equal(c.id, 'b');
  assert.match(c.reason, /earliest source posting/);
});

test('first-seen order is NOT used while a source posting time exists', () => {
  // This database seeing a row first says nothing about which posting is the
  // original — different sources discover the same job at different times.
  const early = row({ id: 'seen-first', postedAt: new Date('2026-09-25T00:00:00Z'), firstSeenAt: new Date('2026-09-20T00:00:00Z') });
  const original = row({ id: 'posted-first', postedAt: new Date('2026-09-24T00:00:00Z'), firstSeenAt: new Date('2026-09-29T00:00:00Z') });
  assert.equal(selectCanonical([early, original]).id, 'posted-first');
});

test('with no posting times, the member carrying a source id wins', () => {
  const a = row({ id: 'a', sourceJobId: null });
  const b = row({ id: 'b', sourceJobId: '40730729' });
  const c = selectCanonical([a, b]);
  assert.equal(c.id, 'b');
  assert.match(c.reason, /source-native job id/);
});

test('otherwise the most complete record wins', () => {
  const sparse = row({ id: 'a', description: 'short', budget: 'Negotiable' });
  const full = row({ id: 'b', description: 'x'.repeat(200), budget: '{"min":500}', clientName: 'Northwind Trading' });
  const c = selectCanonical([sparse, full]);
  assert.equal(c.id, 'b');
  assert.match(c.reason, /most complete/);
});

test('selection is deterministic when nothing separates the members', () => {
  const a = row({ id: 'zzz' });
  const b = row({ id: 'aaa' });
  const first = selectCanonical([a, b]);
  const second = selectCanonical([b, a]);
  assert.equal(first.id, second.id);
  assert.equal(first.id, 'aaa');
  assert.match(first.reason, /stable id order/);
});

test('the reason never claims to know the original job', () => {
  for (const members of [
    [row({ id: 'a', postedAt: new Date('2026-09-23T00:00:00Z') }), row({ id: 'b', postedAt: new Date('2026-09-24T00:00:00Z') })],
    [row({ id: 'a' }), row({ id: 'b', sourceJobId: '1' })],
    [row({ id: 'a' }), row({ id: 'b' })],
  ]) {
    const { reason } = selectCanonical(members);
    assert.ok(!/\boriginal job\b/i.test(reason), `reason must not assert originality: ${reason}`);
    assert.ok(reason.length > 10, 'a reason must actually explain something');
  }
});

// ── Clustering ─────────────────────────────────────────────────────────

test('a repost chain becomes one cluster with one canonical member', () => {
  const base = { description: CEO_DESC, budget: '{"min":250,"max":750}' };
  const rows = [
    row({ id: 'v1', title: 'Independent B2B Sales Representative', postedAt: new Date('2026-09-22T00:00:00Z'), ...base }),
    row({ id: 'v2', title: 'Independent B2B Sales Representative -- 2', postedAt: new Date('2026-09-23T00:00:00Z'), ...base }),
    row({ id: 'v4', title: 'Independent B2B Sales Representative -- 4', postedAt: new Date('2026-09-24T00:00:00Z'), ...base }),
  ];
  const clusters = buildClusters(rows);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].members.length, 3);
  assert.equal(clusters[0].canonicalId, 'v1');
  assert.equal(clusters[0].members.filter(m => m.status === 'canonical').length, 1);
  assert.match(clusters[0].canonicalReason, /earliest source posting/);
});

test('unrelated rows form no cluster at all', () => {
  const rows = [
    row({ id: 'a', title: 'Shopify Partner Needed', description: 'Fix a broken theme and speed up the storefront checkout flow for a small retailer.' }),
    row({ id: 'b', title: 'React Native Developer', description: 'Build an onboarding flow for an existing mobile application with offline support.' }),
  ];
  assert.deepEqual(buildClusters(rows), []);
});

test('rows that merely share a title are not clustered', () => {
  const rows = [
    row({ id: 'a', title: 'Digital Marketing Project', description: 'Run paid search campaigns across Google Ads and report weekly on cost per acquisition.' }),
    row({ id: 'b', title: 'Digital Marketing Project', description: 'Write twenty blog posts about sustainable gardening for a hobby website audience.' }),
  ];
  assert.deepEqual(buildClusters(rows), []);
});

test('clustering is idempotent and order-independent', () => {
  const base = { description: CEO_DESC, budget: 'B' };
  const rows = [
    row({ id: 'a', title: 'Same Opportunity', postedAt: new Date('2026-09-22T00:00:00Z'), ...base }),
    row({ id: 'b', title: 'Same Opportunity -- 2', postedAt: new Date('2026-09-23T00:00:00Z'), ...base }),
  ];
  const forward = buildClusters(rows);
  const reversed = buildClusters([...rows].reverse());
  assert.deepEqual(forward, reversed);
  assert.deepEqual(forward, buildClusters(rows));
});

test('every clustered row keeps its evidence', () => {
  const base = { description: CEO_DESC, budget: 'B' };
  const clusters = buildClusters([
    row({ id: 'a', title: 'Same Opportunity', postedAt: new Date('2026-09-22T00:00:00Z'), ...base }),
    row({ id: 'b', title: 'Same Opportunity -- 2', postedAt: new Date('2026-09-23T00:00:00Z'), ...base }),
  ]);
  for (const m of clusters[0].members) {
    assert.ok(m.signals.length > 0, `${m.id} must carry the signals behind its status`);
    assert.ok(m.confidence > 0);
  }
});
