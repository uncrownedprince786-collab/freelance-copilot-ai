import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessAuthenticity, AuthenticityInput } from './authenticity';

const NOW = new Date('2026-09-30T12:00:00Z');

const LONG = 'We need an experienced developer to rebuild the checkout flow of our Shopify storefront. ' +
  'The current theme is slow on mobile and the payment step drops around a fifth of sessions. ' +
  'Deliverables are a working checkout, a short handover document and two weeks of support.';

/** A well-formed Upwork row with client history — the richest shape the live
 *  data actually contains. */
function upwork(over: Partial<AuthenticityInput> = {}): AuthenticityInput {
  return {
    title: 'Senior React Developer',
    description: LONG,
    url: 'https://www.upwork.com/jobs/~022104723533067588943',
    budget: '{"type":"fixed","min":2000,"max":5000}',
    platform: 'Upwork',
    sourceJobId: '022104723533067588943',
    postedAt: new Date('2026-09-29T09:00:00Z'),
    proposalCount: 7,
    clientSpend: '$5,084',
    clientRating: '5',
    jobsPosted: 12,
    skills: 'react,typescript',
    paymentVerified: false,
    ...over,
  };
}

/** A typical Freelancer row: no client data of any kind exists on this source. */
function freelancer(over: Partial<AuthenticityInput> = {}): AuthenticityInput {
  return {
    title: 'Shopify Partner Needed',
    description: LONG,
    url: 'https://www.freelancer.com/projects/php/Shopify-Partner-40730519',
    budget: '{"type":"fixed","min":250,"max":750}',
    platform: 'Freelancer',
    sourceJobId: '40730519',
    postedAt: new Date('2026-09-29T09:00:00Z'),
    proposalCount: 22,
    clientSpend: null,
    clientRating: null,
    jobsPosted: null,
    skills: null,
    paymentVerified: false,
    ...over,
  };
}

// ── The honesty rules ──────────────────────────────────────────────────

test('nothing is ever returned as verified', () => {
  // `verified` means the source URL was re-fetched and confirmed. This system
  // does not do that, so claiming it would be a lie. If a source-verification
  // step is ever added, this test is the one to change — deliberately.
  for (const row of [upwork(), freelancer(), upwork({ proposalCount: 0 })]) {
    assert.notEqual(assessAuthenticity(row, NOW).status, 'verified');
  }
});

test('an unverified payment is reported as a publishing gap, not a finding', () => {
  // paymentVerified is false on all 1,332 live rows. It may simply not be
  // read. Scoring it as a negative would manufacture suspicion.
  const a = assessAuthenticity(upwork({ paymentVerified: false }), NOW);
  assert.ok(a.warnings.includes('payment_verification_not_published'));
  assert.equal(a.status, 'supported', 'a missing payment flag must not downgrade an otherwise solid listing');
});

test('a source with no client data does not make its jobs doubtful', () => {
  // 85% of live inventory is Freelancer, which publishes no client signal at
  // all. Penalising that would rate most of the feed on the source's
  // reporting habits rather than on the job.
  const a = assessAuthenticity(freelancer(), NOW);
  assert.equal(a.status, 'supported');
  assert.ok(a.warnings.includes('no_client_data_published'));
});

test('client evidence strengthens the signal list without being required', () => {
  const rich = assessAuthenticity(upwork(), NOW);
  const bare = assessAuthenticity(freelancer(), NOW);
  assert.equal(rich.status, 'supported');
  assert.equal(bare.status, 'supported');
  assert.ok(rich.signals.length > bare.signals.length);
  assert.ok(rich.signals.includes('client_spend'));
  assert.ok(rich.signals.includes('client_rating'));
  assert.ok(rich.signals.includes('client_history'));
});

// ── Rejection ──────────────────────────────────────────────────────────

test('structurally unusable rows are rejected, with the reason', () => {
  const noTitle = assessAuthenticity(upwork({ title: '   ' }), NOW);
  assert.equal(noTitle.status, 'rejected');
  assert.ok(noTitle.warnings.includes('missing_title'));

  const noDesc = assessAuthenticity(upwork({ description: '' }), NOW);
  assert.equal(noDesc.status, 'rejected');
  assert.ok(noDesc.warnings.includes('missing_description'));

  const badUrl = assessAuthenticity(upwork({ url: 'javascript:alert(1)' }), NOW);
  assert.equal(badUrl.status, 'rejected');
  assert.ok(badUrl.warnings.includes('unusable_url'));
});

// ── Suspicion ──────────────────────────────────────────────────────────

test('an off-platform contact request is suspicious but stays visible', () => {
  // 45 of 1,332 live descriptions match. It is a warning about the text, not
  // a verdict on the client, so the listing is downgraded and explained
  // rather than rejected.
  for (const text of [
    LONG + ' Please contact me at hiring@gmail.com to discuss.',
    LONG + ' Message me on WhatsApp for details.',
    LONG + ' Reach out on Telegram first.',
    LONG + ' Call +1 415 555 0134 to start.',
  ]) {
    const a = assessAuthenticity(upwork({ description: text }), NOW);
    assert.equal(a.status, 'suspicious', text.slice(-40));
    assert.ok(a.warnings.includes('offsite_contact_request'));
    assert.notEqual(a.status, 'rejected', 'a suspicious listing is still shown, with its reason');
  }
});

test('ordinary descriptions are not dragged in by the contact pattern', () => {
  for (const text of [
    LONG + ' The app integrates with Telegram Bot API for notifications.',
    LONG + ' Experience with WhatsApp Business API is a plus.',
  ]) {
    // These DO match the pattern — which is exactly why the verdict is
    // "suspicious", a soft state that keeps the listing visible with its
    // reason shown, rather than "rejected".
    const a = assessAuthenticity(upwork({ description: text }), NOW);
    assert.equal(a.status, 'suspicious');
    assert.ok(a.warnings.includes('offsite_contact_request'));
  }
});

test('a posting time in the future is suspicious, but clock skew is tolerated', () => {
  const skewed = assessAuthenticity(upwork({ postedAt: new Date('2026-09-30T12:30:00Z') }), NOW);
  assert.notEqual(skewed.status, 'suspicious', 'half an hour of drift is not a forgery');

  const impossible = assessAuthenticity(upwork({ postedAt: new Date('2099-01-01T00:00:00Z') }), NOW);
  assert.equal(impossible.status, 'suspicious');
  assert.ok(impossible.warnings.includes('future_posting_time'));
});

test('thin text and no budget are reported, not converted into a spam verdict', () => {
  // A "thin text + no budget = template spam" rule reads plausibly and is not
  // implemented, because zero of the 1,332 live rows have an unstated budget.
  // It could only ever fire on a shape nobody has observed, which makes it a
  // guess dressed as a finding. Both facts are reported as warnings instead.
  const both = assessAuthenticity(upwork({ description: 'Need help. Apply now.', budget: 'Negotiable' }), NOW);
  assert.notEqual(both.status, 'suspicious');
  assert.ok(both.warnings.includes('short_description'));
  assert.ok(both.warnings.includes('unstated_budget'));

  const noBudgetOnly = assessAuthenticity(upwork({ budget: 'Negotiable' }), NOW);
  assert.notEqual(noBudgetOnly.status, 'suspicious');
  assert.ok(noBudgetOnly.warnings.includes('unstated_budget'));
});

// ── Staleness ──────────────────────────────────────────────────────────

test('a very old posting is stale rather than suspicious', () => {
  const a = assessAuthenticity(upwork({ postedAt: new Date('2026-06-01T00:00:00Z') }), NOW);
  assert.equal(a.status, 'stale');
  assert.ok(a.warnings.includes('stale_posting'));
  assert.ok(a.signals.includes('coherent_posting_time'), 'stale is not incoherent');
});

test('nothing in the live table is stale — retention purges well before 30 days', () => {
  // Max observed age is 178 hours. This rule is a guard, not a live filter.
  const oldestObserved = new Date(NOW.getTime() - 178 * 3600_000);
  assert.notEqual(assessAuthenticity(upwork({ postedAt: oldestObserved }), NOW).status, 'stale');
});

// ── Uncertainty ────────────────────────────────────────────────────────

test('a thin but clean listing is uncertain, not suspicious and not supported', () => {
  const a = assessAuthenticity({
    title: 'Data entry',
    description: 'Copy 40 records from a PDF into a spreadsheet by Friday afternoon.',
    url: 'https://www.freelancer.com/projects/data-entry/Slug-Only',
    budget: 'Negotiable',
    platform: 'Freelancer',
    sourceJobId: null,
    postedAt: null,
    proposalCount: null,
  }, NOW);
  assert.equal(a.status, 'uncertain');
  assert.ok(a.warnings.includes('no_source_id'));
  assert.ok(a.warnings.includes('no_posting_time'));
  assert.ok(a.warnings.includes('no_competition_data'));
});

test('baseline coherence alone is uncertain — corroboration is what lifts it', () => {
  // Every well-formed row has a usable URL, a coherent posting time, a
  // substantive description and a stated budget. Counting those as evidence
  // rated 96.5% of the live table 'supported' and discriminated nothing.
  //
  // This is also the measurable effect of the collector fix: 953 live
  // Freelancer rows have no source-native id and sit at one corroborating
  // signal (a proposal count). Once FreelancerCollector carries project.id
  // through, the same listing has two and becomes supported.
  const withoutId = assessAuthenticity(freelancer({ sourceJobId: null }), NOW);
  assert.equal(withoutId.status, 'uncertain');
  assert.ok(withoutId.warnings.includes('no_source_id'));

  const withId = assessAuthenticity(freelancer({ sourceJobId: '40730519' }), NOW);
  assert.equal(withId.status, 'supported');
  assert.ok(withId.signals.includes('source_native_id'));
});

test('every verdict carries the reasons behind it', () => {
  for (const row of [upwork(), freelancer(), upwork({ title: '' }), upwork({ postedAt: new Date('2099-01-01') })]) {
    const a = assessAuthenticity(row, NOW);
    assert.ok(
      a.signals.length + a.warnings.length > 0,
      'a status with no reason codes cannot be explained to a user',
    );
  }
});

test('assessment is pure — same input, same verdict', () => {
  const row = upwork();
  assert.deepEqual(assessAuthenticity(row, NOW), assessAuthenticity(row, NOW));
});

// ── Repeated reposting ─────────────────────────────────────────────────

test('a heavily reposted listing is flagged as suspicious', () => {
  // The product exists to save someone scrolling. The largest live cluster
  // is five postings of one Android game project — exactly the thing that
  // wastes an afternoon.
  const a = assessAuthenticity(upwork({ clusterSize: 5 }), NOW);
  assert.equal(a.status, 'suspicious');
  assert.ok(a.warnings.includes('heavily_reposted'));
});

test('a listing posted twice is noted, not condemned', () => {
  // A client re-listing after a quiet week is ordinary.
  const a = assessAuthenticity(upwork({ clusterSize: 2 }), NOW);
  assert.notEqual(a.status, 'suspicious');
  assert.ok(a.warnings.includes('repost_cluster'));
});

test('a standalone listing carries no repost warning', () => {
  for (const size of [1, undefined, null]) {
    const a = assessAuthenticity(upwork({ clusterSize: size as number }), NOW);
    assert.ok(!a.warnings.includes('repost_cluster'));
    assert.ok(!a.warnings.includes('heavily_reposted'));
  }
});

test('the repost signal never overrides a structural rejection', () => {
  const a = assessAuthenticity(upwork({ clusterSize: 9, title: '' }), NOW);
  assert.equal(a.status, 'rejected');
});
