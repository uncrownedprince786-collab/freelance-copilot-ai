import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LeadScoreInput, MIN_COVERAGE, parseBudget, scoreLead } from './leadScore';

const NOW = new Date('2026-09-30T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const BRIEF =
  'We need an experienced developer to rebuild the checkout flow of our Shopify storefront. '.repeat(4);

function upwork(over: Partial<LeadScoreInput> = {}): LeadScoreInput {
  return {
    platform: 'Upwork',
    title: 'Senior React Developer',
    description: BRIEF,
    budget: '{"type":"fixed","min":4000,"max":6000}',
    skills: 'react,typescript',
    experienceLevel: 'Expert',
    proposalCount: 3,
    competitionObservedAt: hoursAgo(2),
    clientSpend: '$5,084',
    clientRating: '5',
    jobsPosted: 12,
    postedAt: hoursAgo(2),
    ...over,
  };
}

function freelancer(over: Partial<LeadScoreInput> = {}): LeadScoreInput {
  return {
    platform: 'Freelancer',
    title: 'Shopify Partner Needed',
    description: BRIEF,
    budget: '{"type":"fixed","min":250,"max":750,"currency":"$"}',
    skills: null,
    experienceLevel: null,
    proposalCount: 22,
    competitionObservedAt: hoursAgo(50),
    clientSpend: null,
    clientRating: null,
    jobsPosted: null,
    postedAt: hoursAgo(50),
    ...over,
  };
}

// ── The currency trap ──────────────────────────────────────────────────

test('budgets in different currencies are compared on one scale', () => {
  // 437 live rows are priced in ₹ (avg min ₹39,037) and 334 in $ (avg min
  // $795). On the raw number the rupee job looks ~49x larger.
  const rupees = parseBudget('{"type":"fixed","min":39000,"max":39000,"currency":"₹"}', 'Freelancer');
  const dollars = parseBudget('{"type":"fixed","min":795,"max":795,"currency":"$"}', 'Freelancer');
  assert.ok(rupees!.usd! < dollars!.usd! * 1.2, 'a ₹39,000 budget must not outrank a $795 one');
  assert.ok(rupees!.usd! > 400, 'nor should it be treated as worthless');
});

test('a missing currency is assumed USD only on Upwork, and the assumption is surfaced', () => {
  // All 198 live Upwork rows carry no currency field; Upwork contracts are
  // denominated in USD.
  const uw = parseBudget('{"type":"fixed","min":541,"max":541}', 'Upwork');
  assert.equal(uw!.usd, 541);
  assert.equal(uw!.assumedUsd, true);
  assert.ok(scoreLead(upwork(), NOW).risks.some(r => /USD assumed/.test(r)));

  // Guessing a currency for a Freelancer row is guessing away the 49x error.
  const fl = parseBudget('{"type":"fixed","min":39000,"max":39000}', 'Freelancer');
  assert.equal(fl!.usd, null);
});

test('an unknown currency leaves the budget unscored rather than guessed', () => {
  const b = parseBudget('{"type":"fixed","min":5000,"currency":"¥"}', 'Freelancer');
  assert.equal(b!.usd, null);
  const a = scoreLead(freelancer({ budget: '{"type":"fixed","min":5000,"currency":"¥"}' }), NOW);
  assert.ok(a.risks.some(r => /Budget could not be compared/.test(r)));
});

test('hourly rates are scored on their own scale', () => {
  // $23/hr and a $541 fixed price are not the same kind of number.
  const hourly = scoreLead(upwork({ budget: '{"type":"hourly","min":80,"max":100}' }), NOW);
  const fixed = scoreLead(upwork({ budget: '{"type":"fixed","min":80,"max":100}' }), NOW);
  assert.ok(hourly.score! > fixed.score!, '$90/hr is a strong rate; a $90 fixed job is not');
});

test('malformed and empty budgets do not throw', () => {
  assert.equal(parseBudget('not json', 'Upwork'), null);
  assert.equal(parseBudget('', 'Upwork'), null);
  assert.equal(parseBudget('Negotiable', 'Upwork'), null);
  assert.equal(parseBudget('{"type":"fixed"}', 'Upwork')!.usd, null);
});

// ── Only evaluable dimensions count ────────────────────────────────────

test('a source that publishes no client data does not drag its jobs down', () => {
  // 0 of 1,134 Freelancer rows have client spend, rating or jobs-posted.
  // A fixed-weight model would dock 85% of inventory for the SOURCE's
  // reporting habits.
  const withClient = scoreLead(upwork(), NOW);
  const sameJobNoClient = scoreLead(upwork({ clientSpend: null, clientRating: null, jobsPosted: null }), NOW);
  assert.ok(
    sameJobNoClient.score! >= withClient.score! - 10,
    `missing client data must not collapse the score (${withClient.score} -> ${sameJobNoClient.score})`,
  );
  assert.ok(sameJobNoClient.risks.some(r => /No client history published/.test(r)));
  assert.ok(sameJobNoClient.coverage < withClient.coverage, 'but coverage must fall');
});

test('coverage reports how much of the model actually ran', () => {
  assert.equal(scoreLead(upwork(), NOW).coverage, 1);
  const sparse = scoreLead(freelancer({ proposalCount: null, postedAt: null }), NOW);
  assert.ok(sparse.coverage < 1);
  assert.ok(sparse.risks.some(r => /% of the model/.test(r)));
});

test('too little data yields null, never a fabricated default', () => {
  const nothing = scoreLead({
    platform: 'Freelancer',
    title: 'Job',
    description: '',
    budget: 'Negotiable',
    proposalCount: null,
    postedAt: null,
  }, NOW);
  assert.equal(nothing.score, null);
  assert.equal(nothing.band, 'insufficient_data');
  assert.ok(nothing.coverage < MIN_COVERAGE);
  assert.ok(nothing.risks.length > 0, 'an unscored row must still say why');
});

// ── Explainability ─────────────────────────────────────────────────────

test('every score carries reasons a user can act on', () => {
  const a = scoreLead(upwork(), NOW);
  assert.ok(a.score! > 0);
  assert.ok(a.reasons.length >= 3, 'a bare number is not an explanation');
  for (const r of [...a.reasons, ...a.risks]) {
    assert.ok(r.length > 10 && /[a-z]/.test(r), `reason must be readable prose: ${r}`);
  }
});

test('reasons quote real values rather than asserting quality', () => {
  const a = scoreLead(upwork(), NOW);
  assert.ok(a.reasons.some(r => /5,084/.test(r)), 'client spend should be quoted');
  assert.ok(a.reasons.some(r => /12 jobs posted/.test(r)));
  // Nothing may promise an outcome.
  for (const r of [...a.reasons, ...a.risks]) {
    assert.ok(!/will (definitely |certainly )?hire/i.test(r));
    assert.ok(!/perfect for you|matches your skills/i.test(r));
  }
});

test('a stale competition figure is scored but flagged as stale', () => {
  const a = scoreLead(freelancer(), NOW);
  assert.ok(a.risks.some(r => /not refreshed/.test(r)));
  assert.ok(a.risks.some(r => /not a current figure/.test(r)));
});

test('a fresh low-competition figure reads as an advantage', () => {
  const a = scoreLead(upwork({ proposalCount: 2, competitionObservedAt: hoursAgo(1) }), NOW);
  assert.ok(a.reasons.some(r => /Low competition/.test(r)));
  assert.ok(!a.risks.some(r => /not refreshed/.test(r)));
});

// ── Ordering behaves sensibly ──────────────────────────────────────────

test('the strong lead outranks the weak one', () => {
  const strong = scoreLead(upwork(), NOW);
  const weak = scoreLead(upwork({
    budget: '{"type":"fixed","min":40,"max":60}',
    proposalCount: 48,
    competitionObservedAt: hoursAgo(120),
    postedAt: hoursAgo(120),
    description: 'Need help.',
    skills: null,
    experienceLevel: null,
    clientSpend: null,
    clientRating: null,
    jobsPosted: null,
  }), NOW);
  assert.ok(strong.score! > weak.score!);
  assert.equal(strong.band, 'high');
  assert.ok(['low', 'moderate', 'insufficient_data'].includes(weak.band), `got ${weak.band}`);
});

test('scoring is pure and stable', () => {
  const row = upwork();
  assert.deepEqual(scoreLead(row, NOW), scoreLead(row, NOW));
});

test('a score never exceeds its bounds', () => {
  for (const row of [upwork(), freelancer(), upwork({ proposalCount: 0, clientRating: '5' })]) {
    const s = scoreLead(row, NOW).score;
    if (s != null) assert.ok(s >= 0 && s <= 100, `out of range: ${s}`);
  }
});
