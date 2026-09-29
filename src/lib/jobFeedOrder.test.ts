import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byLatest, byLeadPotential, collapseDuplicates, JobFeedItem } from './jobFeed';

function item(over: Partial<JobFeedItem> & { id: string }): JobFeedItem {
  return {
    title: 'A job', description: '', url: 'https://x.test/' + over.id,
    platform: 'Freelancer', budget: 'Negotiable', score: 50,
    viewed: false, applied: false, postedAt: '2026-09-29T00:00:00.000Z',
    leadScore: 50, leadBand: 'moderate', leadReasons: [], leadRisks: [],
    authenticityStatus: 'supported', authenticitySignals: [], authenticityWarnings: [],
    duplicateStatus: 'independent', duplicateClusterId: null, canonicalJobId: null,
    duplicateConfidence: null, canonicalReason: null,
    freshnessState: 'active', freshnessFactor: 0.7, ageLabel: 'posted 12 hours ago',
    competition: { count: null, observedAt: null, observationAgeHours: null, outdated: false, label: '' },
    ...over,
  } as JobFeedItem;
}

test('Latest is chronological and nothing else', () => {
  // The moment it is blended with a quality signal, a user who wants to see
  // what just appeared cannot get it and the two views collapse into one.
  const jobs = [
    item({ id: 'old-but-great', postedAt: '2026-09-20T00:00:00.000Z', leadScore: 99 }),
    item({ id: 'new-but-weak', postedAt: '2026-09-29T00:00:00.000Z', leadScore: 5 }),
  ];
  assert.deepEqual(byLatest(jobs).map(j => j.id), ['new-but-weak', 'old-but-great']);
});

test('a listing with no posting time sorts last in Latest, not first', () => {
  const jobs = [
    item({ id: 'unknown-age', postedAt: '' }),
    item({ id: 'dated', postedAt: '2026-09-20T00:00:00.000Z' }),
  ];
  assert.deepEqual(byLatest(jobs).map(j => j.id), ['dated', 'unknown-age']);
});

test('Recommended ranks by lead score', () => {
  const jobs = [
    item({ id: 'weak', leadScore: 20 }),
    item({ id: 'strong', leadScore: 90 }),
    item({ id: 'mid', leadScore: 55 }),
  ];
  assert.deepEqual(byLeadPotential(jobs).map(j => j.id), ['strong', 'mid', 'weak']);
});

test('an unscored listing sorts last but is never dropped', () => {
  // The source published too little to assess it. That is not the same as it
  // being a bad lead, and hiding it would be a silent omission.
  const jobs = [
    item({ id: 'unscored', leadScore: null, leadBand: 'insufficient_data' }),
    item({ id: 'low', leadScore: 10 }),
  ];
  const ranked = byLeadPotential(jobs);
  assert.deepEqual(ranked.map(j => j.id), ['low', 'unscored']);
  assert.equal(ranked.length, 2);
});

test('both orderings are stable across calls', () => {
  const jobs = [
    item({ id: 'b', leadScore: 50, postedAt: '2026-09-29T00:00:00.000Z' }),
    item({ id: 'a', leadScore: 50, postedAt: '2026-09-29T00:00:00.000Z' }),
  ];
  assert.deepEqual(byLeadPotential(jobs).map(j => j.id), byLeadPotential([...jobs].reverse()).map(j => j.id));
  assert.deepEqual(byLatest(jobs).map(j => j.id), byLatest([...jobs].reverse()).map(j => j.id));
});

test('the two views genuinely differ on the live shape of the data', () => {
  const jobs = [
    item({ id: 'fresh-weak', postedAt: '2026-09-29T12:00:00.000Z', leadScore: 12 }),
    item({ id: 'older-strong', postedAt: '2026-09-27T12:00:00.000Z', leadScore: 88 }),
  ];
  assert.notDeepEqual(byLatest(jobs).map(j => j.id), byLeadPotential(jobs).map(j => j.id));
});

// ── Duplicate collapsing ───────────────────────────────────────────────

test('a high-confidence duplicate collapses to its canonical member', () => {
  const jobs = [
    item({ id: 'canon', duplicateStatus: 'canonical', duplicateClusterId: 'c1', canonicalJobId: 'canon' }),
    item({ id: 'dupe', duplicateStatus: 'duplicate', duplicateClusterId: 'c1', canonicalJobId: 'canon' }),
  ];
  assert.deepEqual(collapseDuplicates(jobs).map(j => j.id), ['canon']);
});

test('an uncertain duplicate is never silently removed', () => {
  // The removed one could be the repost with the better budget.
  const jobs = [
    item({ id: 'canon', duplicateStatus: 'canonical', canonicalJobId: 'canon' }),
    item({ id: 'maybe', duplicateStatus: 'possible_duplicate', canonicalJobId: 'canon' }),
  ];
  assert.deepEqual(collapseDuplicates(jobs).map(j => j.id).sort(), ['canon', 'maybe']);
});

test('a duplicate whose canonical is absent stays visible', () => {
  // Filtering it out would drop the opportunity from the result set
  // entirely, which is worse than showing it twice.
  const jobs = [item({ id: 'dupe', duplicateStatus: 'duplicate', canonicalJobId: 'not-in-this-page' })];
  assert.deepEqual(collapseDuplicates(jobs).map(j => j.id), ['dupe']);
});

test('collapsing leaves independent listings alone', () => {
  const jobs = [item({ id: 'a' }), item({ id: 'b' })];
  assert.equal(collapseDuplicates(jobs).length, 2);
});
