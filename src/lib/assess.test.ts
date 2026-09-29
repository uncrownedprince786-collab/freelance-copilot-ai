import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessListing,
  assessmentChanged,
  AssessmentInput,
  LEAD_SCORE_WRITE_THRESHOLD,
  StoredAssessment,
} from './assess';

const NOW = new Date('2026-09-30T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const BRIEF = 'Rebuild the checkout flow of our Shopify storefront and hand over documentation. '.repeat(4);

function listing(over: Partial<AssessmentInput> = {}): AssessmentInput {
  return {
    platform: 'Upwork',
    title: 'Senior React Developer',
    description: BRIEF,
    url: 'https://www.upwork.com/jobs/~022104723533067588943',
    budget: '{"type":"fixed","min":4000,"max":6000}',
    sourceJobId: '022104723533067588943',
    skills: 'react,typescript',
    experienceLevel: 'Expert',
    proposalCount: 3,
    competitionObservedAt: hoursAgo(2),
    clientSpend: '$5,084',
    clientRating: '5',
    jobsPosted: 12,
    paymentVerified: false,
    postedAt: hoursAgo(2),
    ...over,
  };
}

function stored(over: Partial<StoredAssessment> = {}): StoredAssessment {
  const a = assessListing(listing(), NOW);
  return {
    authenticityStatus: a.authenticityStatus,
    authenticitySignals: a.authenticitySignals,
    authenticityWarnings: a.authenticityWarnings,
    leadScore: a.leadScore,
    leadBand: a.leadBand,
    leadReasons: a.leadReasons,
    leadRisks: a.leadRisks,
    ...over,
  };
}

test('one pass produces every quality column', () => {
  const a = assessListing(listing(), NOW);
  assert.equal(a.authenticityStatus, 'supported');
  assert.ok(JSON.parse(a.authenticitySignals).length > 0);
  assert.ok(Array.isArray(JSON.parse(a.authenticityWarnings)));
  assert.ok(a.leadScore! > 0);
  assert.equal(a.leadBand, 'high');
  assert.ok(JSON.parse(a.leadReasons).length > 0);
  assert.ok(Array.isArray(JSON.parse(a.leadRisks)));
  assert.equal(a.leadScoredAt.getTime(), NOW.getTime());
});

test('reason codes round-trip through their JSON columns', () => {
  const a = assessListing(listing(), NOW);
  for (const field of [a.authenticitySignals, a.authenticityWarnings, a.leadReasons, a.leadRisks]) {
    assert.doesNotThrow(() => JSON.parse(field));
    assert.ok(Array.isArray(JSON.parse(field)));
  }
});

test('an unscorable listing stores null, not a default', () => {
  const a = assessListing(listing({
    description: '', budget: 'Negotiable', proposalCount: null, postedAt: null,
    clientSpend: null, clientRating: null, jobsPosted: null, skills: null, experienceLevel: null,
  }), NOW);
  assert.equal(a.leadScore, null);
  assert.equal(a.leadBand, 'insufficient_data');
  // A row with no description is structurally unusable, and says so.
  assert.equal(a.authenticityStatus, 'rejected');
});

test('assessment is pure for a fixed clock', () => {
  assert.deepEqual(assessListing(listing(), NOW), assessListing(listing(), NOW));
});

// ── Write suppression ──────────────────────────────────────────────────

test('an unchanged assessment needs no write', () => {
  const next = assessListing(listing(), NOW);
  assert.equal(assessmentChanged(stored(), next), false);
});

test('leadScoredAt alone never makes a row dirty', () => {
  // It changes on every run by definition. Counting it would mark every row
  // dirty every time and defeat the whole check.
  const later = new Date(NOW.getTime() + 60_000);
  const next = assessListing(listing(), later);
  const before = stored();
  assert.equal(next.leadScoredAt.getTime(), later.getTime());
  assert.equal(assessmentChanged(before, next), false);
});

test('small freshness drift does not trigger a write', () => {
  // Every score moves a little every hour as freshness decays. Rewriting
  // 1,332 rows to move a 71 to a 70 would be the biggest write load in the
  // system and would buy nothing — the bands are 15 points wide.
  const before = stored();
  const next = assessListing(listing(), NOW);
  const nudged = { ...next, leadScore: (before.leadScore ?? 0) - (LEAD_SCORE_WRITE_THRESHOLD - 1) };
  assert.equal(assessmentChanged(before, nudged), false);
});

test('a drift past the threshold does trigger a write', () => {
  const before = stored();
  const next = assessListing(listing(), NOW);
  const moved = { ...next, leadScore: (before.leadScore ?? 0) - LEAD_SCORE_WRITE_THRESHOLD };
  assert.equal(assessmentChanged(before, moved), true);
});

test('a band change always writes, however small the score move', () => {
  const before = stored({ leadBand: 'promising' });
  assert.equal(assessmentChanged(before, assessListing(listing(), NOW)), true);
});

test('an authenticity change always writes', () => {
  const before = stored({ authenticityStatus: 'uncertain' });
  assert.equal(assessmentChanged(before, assessListing(listing(), NOW)), true);
});

test('gaining or losing a score writes', () => {
  const next = assessListing(listing(), NOW);
  assert.equal(assessmentChanged(stored({ leadScore: null }), next), true);
  assert.equal(
    assessmentChanged(stored(), { ...next, leadScore: null }),
    true,
  );
});

test('a first assessment of an untouched row always writes', () => {
  // The schema defaults: never assessed.
  const untouched: StoredAssessment = {
    authenticityStatus: 'uncertain',
    authenticitySignals: null,
    authenticityWarnings: null,
    leadScore: null,
    leadBand: null,
    leadReasons: null,
    leadRisks: null,
  };
  assert.equal(assessmentChanged(untouched, assessListing(listing(), NOW)), true);
});
