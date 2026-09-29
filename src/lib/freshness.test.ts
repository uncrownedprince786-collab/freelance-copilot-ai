import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ageHours,
  competitionObservation,
  describeAge,
  freshnessFactor,
  freshnessState,
  FRESHNESS_FLOOR,
  FRESHNESS_HALF_LIFE_HOURS,
} from './freshness';

const NOW = new Date('2026-09-30T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

test('states cover the measured age range of the live feed', () => {
  assert.equal(freshnessState(hoursAgo(0.2), NOW), 'just_posted');
  assert.equal(freshnessState(hoursAgo(3), NOW), 'fresh');
  assert.equal(freshnessState(hoursAgo(12), NOW), 'active');
  assert.equal(freshnessState(hoursAgo(48), NOW), 'aging');
  assert.equal(freshnessState(hoursAgo(120), NOW), 'stale');
  // Retention purges around 7 days and the oldest observed row is 178h.
  assert.equal(freshnessState(hoursAgo(178), NOW), 'expired');
});

test('a missing posting time is unknown, not fresh and not stale', () => {
  assert.equal(freshnessState(null, NOW), 'unknown');
  assert.equal(freshnessState(undefined, NOW), 'unknown');
  assert.equal(freshnessFactor(null, NOW), null, 'no age must not be silently scored');
  assert.equal(ageHours(null, NOW), null);
});

test('source clock skew reads as brand new rather than as an error', () => {
  assert.equal(ageHours(new Date(NOW.getTime() + 30 * 60_000), NOW), 0);
  assert.equal(freshnessState(new Date(NOW.getTime() + 30 * 60_000), NOW), 'just_posted');
});

test('decay is gradual — there is no cliff', () => {
  // The failure mode this replaces: "posted < 1 hour = good, > 1 hour = bad".
  const atOneHour = freshnessFactor(hoursAgo(1), NOW)!;
  const justAfter = freshnessFactor(hoursAgo(1.05), NOW)!;
  assert.ok(Math.abs(atOneHour - justAfter) < 0.01, 'crossing a state boundary must not lurch');
});

test('the half-life behaves as documented', () => {
  const fresh = freshnessFactor(hoursAgo(0), NOW)!;
  const oneHalfLife = freshnessFactor(hoursAgo(FRESHNESS_HALF_LIFE_HOURS), NOW)!;
  assert.equal(fresh, 1);
  assert.ok(Math.abs(oneHalfLife - 0.5) < 0.001);
  // The documented shape: a day old is still worth ~0.71, three days ~0.35.
  assert.ok(Math.abs(freshnessFactor(hoursAgo(24), NOW)! - 0.707) < 0.01);
  assert.ok(Math.abs(freshnessFactor(hoursAgo(72), NOW)! - 0.354) < 0.01);
});

test('freshness alone never zeroes an opportunity out', () => {
  assert.equal(freshnessFactor(hoursAgo(10_000), NOW), FRESHNESS_FLOOR);
  assert.ok(freshnessFactor(hoursAgo(500), NOW)! >= FRESHNESS_FLOOR);
});

test('decay is monotonic', () => {
  let previous = Infinity;
  for (const h of [0, 1, 6, 24, 48, 72, 120, 168, 336]) {
    const f = freshnessFactor(hoursAgo(h), NOW)!;
    assert.ok(f <= previous, `factor must not increase with age (at ${h}h)`);
    previous = f;
  }
});

test('age is described without implying real-time data', () => {
  assert.equal(describeAge(hoursAgo(0.25), NOW), 'posted 15 minutes ago');
  assert.equal(describeAge(hoursAgo(1), NOW), 'posted 1 hour ago');
  assert.equal(describeAge(hoursAgo(30), NOW), 'posted 30 hours ago');
  assert.equal(describeAge(hoursAgo(72), NOW), 'posted 3 days ago');
  assert.equal(describeAge(null, NOW), 'posting time not published by the source');
});

// ── Competition honesty ────────────────────────────────────────────────

test('a recent proposal count is presented with its age, not as "so far"', () => {
  const o = competitionObservation(3, hoursAgo(2), NOW);
  assert.equal(o.outdated, false);
  assert.match(o.label, /3 proposals as of 2h ago/);
  assert.ok(!/so far/.test(o.label), 'never imply the number is live');
});

test('an old proposal count says outright that it is not current', () => {
  // The measured case: counts are captured 1-2h after posting and never
  // updated, so a five-day-old listing still shows its two-hour figure.
  const o = competitionObservation(3, hoursAgo(120), NOW);
  assert.equal(o.outdated, true);
  assert.match(o.label, /not a current figure/);
  assert.match(o.label, /5 days ago/);
});

test('no published count is stated as such, never as zero competition', () => {
  const o = competitionObservation(null, hoursAgo(2), NOW);
  assert.equal(o.count, null);
  assert.equal(o.outdated, false);
  assert.match(o.label, /no proposal count published/);
  assert.ok(!/\b0\b/.test(o.label), 'absent must never render as zero');
});

test('zero proposals is a real reading and is kept distinct from absent', () => {
  const zero = competitionObservation(0, hoursAgo(1), NOW);
  assert.equal(zero.count, 0);
  assert.match(zero.label, /^0 proposals/);
});

test('one proposal reads correctly', () => {
  assert.match(competitionObservation(1, hoursAgo(1), NOW).label, /^1 proposal as of/);
});

test('an unknown observation time is treated as outdated, not as current', () => {
  const o = competitionObservation(5, null, NOW);
  assert.equal(o.outdated, true);
  assert.match(o.label, /when last checked/);
});
