import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRun,
  BACKOFF,
  backoffMs,
  costOf,
  emptyHealth,
  healthState,
  isEligible,
  parseHealth,
  rankByYield,
  SourceCost,
  SourceYield,
} from './sourceHealth';

const T0 = new Date('2026-09-30T12:00:00Z');

// ── Backoff ────────────────────────────────────────────────────────────

test('a healthy source waits for nothing', () => {
  assert.equal(backoffMs(0), 0);
  assert.equal(backoffMs(-1), 0);
});

test('backoff grows exponentially and is capped', () => {
  assert.equal(backoffMs(1), BACKOFF.baseMs);
  assert.equal(backoffMs(2), BACKOFF.baseMs * 2);
  assert.equal(backoffMs(3), BACKOFF.baseMs * 4);
  // The cap matters as much as the growth: uncapped backoff silently retires
  // a source after one bad afternoon.
  assert.equal(backoffMs(50), BACKOFF.maxMs);
  assert.ok(backoffMs(20) <= BACKOFF.maxMs);
});

test('health states reflect recent behaviour, not history', () => {
  assert.equal(healthState(0, 0), 'unknown', 'never run is not healthy');
  assert.equal(healthState(0, 5), 'healthy');
  assert.equal(healthState(1, 5), 'degraded');
  assert.equal(healthState(BACKOFF.failingAfter, 5), 'failing');
});

// ── Folding runs ───────────────────────────────────────────────────────

test('a success clears the failure streak and the backoff', () => {
  let h = emptyHealth('apify');
  h = applyRun(h, { ok: false, reason: 'quota', records: 0, at: T0 });
  h = applyRun(h, { ok: false, reason: 'quota', records: 0, at: T0 });
  assert.equal(h.consecutiveFailures, 2);
  assert.ok(h.nextEligibleAt);

  h = applyRun(h, { ok: true, records: 25, at: T0 });
  assert.equal(h.consecutiveFailures, 0);
  assert.equal(h.state, 'healthy');
  assert.equal(h.nextEligibleAt, null, 'a recovered source is immediately eligible');
  assert.equal(h.lastFailureReason, null);
  assert.equal(h.lastFailureAt, T0.toISOString(), 'but the failure history is kept');
});

test('a failing source is not eligible until its backoff expires', () => {
  let h = emptyHealth('apify');
  h = applyRun(h, { ok: false, reason: 'timeout', records: 0, at: T0 });
  assert.equal(isEligible(h, T0), false);
  assert.equal(isEligible(h, new Date(T0.getTime() + BACKOFF.baseMs - 1)), false);
  assert.equal(isEligible(h, new Date(T0.getTime() + BACKOFF.baseMs)), true);
});

test('a source with no recorded backoff is always eligible', () => {
  assert.equal(isEligible(emptyHealth('freelancer'), T0), true);
});

test('a corrupt nextEligibleAt fails open rather than retiring the source', () => {
  const h = { ...emptyHealth('apify'), nextEligibleAt: 'not a date' };
  assert.equal(isEligible(h, T0), true);
});

test('rolling totals accumulate and one source cannot go negative', () => {
  let h = emptyHealth('apify');
  h = applyRun(h, { ok: true, records: 25, billedUnits: 4, at: T0 });
  h = applyRun(h, { ok: true, records: 29, billedUnits: 4, at: T0 });
  assert.equal(h.runs, 2);
  assert.equal(h.successes, 2);
  assert.equal(h.records, 54);
  assert.equal(h.billedUnits, 8);

  h = applyRun(h, { ok: true, records: -5, billedUnits: -3, at: T0 });
  assert.equal(h.records, 54, 'a nonsense record count cannot reduce the total');
  assert.equal(h.billedUnits, 8);
});

test('a run that did not time itself is not folded in as a zero', () => {
  let h = emptyHealth('apify');
  h = applyRun(h, { ok: true, records: 10, durationMs: 4000, at: T0 });
  assert.equal(h.averageDurationMs, 4000);
  h = applyRun(h, { ok: true, records: 10, durationMs: null, at: T0 });
  assert.equal(h.averageDurationMs, 4000, 'an unmeasured run must not halve the mean');
});

test('a stored record survives corruption', () => {
  assert.deepEqual(parseHealth('apify', 'not json'), emptyHealth('apify'));
  assert.deepEqual(parseHealth('apify', null), emptyHealth('apify'));
  const partial = parseHealth('apify', JSON.stringify({ runs: 7 }));
  assert.equal(partial.runs, 7);
  assert.equal(partial.source, 'apify');
  assert.equal(partial.state, 'unknown', 'missing fields fall back, they do not become undefined');
});

// ── Cost ───────────────────────────────────────────────────────────────

/** The live figures. */
const UPWORK: SourceYield = {
  source: 'apify', rows: 198, usefulLeads: 131, usefulRate: 0.662,
  averageLeadScore: 64.1, duplicates: 0, suspicious: 9,
};
const FREELANCER: SourceYield = {
  source: 'freelancer', rows: 1134, usefulLeads: 115, usefulRate: 0.101,
  averageLeadScore: 42.8, duplicates: 28, suspicious: 37,
};

test('useful leads per record reverses the ranking that counting records gives', () => {
  // Counting records fetched — what the cron log does today — makes
  // Freelancer look like the productive source. It is not.
  const upwork = costOf(UPWORK, { ...emptyHealth('apify'), records: 198, billedUnits: 120 });
  const freelancer = costOf(FREELANCER, { ...emptyHealth('freelancer'), records: 1134, billedUnits: 0 });

  assert.ok(upwork.usefulPer100Records! > freelancer.usefulPer100Records!);
  assert.equal(rankByYield([freelancer, upwork])[0].source, 'apify');
  assert.ok(freelancer.records > upwork.records, 'even though it returns far more records');
});

test('a free source reports no cost per lead rather than a zero', () => {
  // Freelancer costs no Apify budget. "Zero cost per lead" would read as
  // infinitely efficient; the honest answer is that the metric does not
  // apply.
  const c = costOf(FREELANCER, { ...emptyHealth('freelancer'), records: 1134, billedUnits: 0 });
  assert.equal(c.costPerUsefulLead, null);
  assert.ok(c.usefulPer100Records! > 0, 'yield is still measurable');
});

test('a source with no useful leads yet reports null, not a division by zero', () => {
  const barren: SourceYield = { ...UPWORK, usefulLeads: 0 };
  const c = costOf(barren, { ...emptyHealth('apify'), records: 50, billedUnits: 16 });
  assert.equal(c.costPerUsefulLead, null);
  assert.equal(c.usefulPer100Records, 0, 'zero observed useful leads IS zero yield');
});

test('a source with no observations reports null yield, not zero', () => {
  const c = costOf({ ...UPWORK, usefulLeads: 0 }, emptyHealth('apify'));
  assert.equal(c.usefulPer100Records, null, 'never observed is not the same as observed to be zero');
});

test('an unmeasured source ranks last, never first', () => {
  const measured = costOf(FREELANCER, { ...emptyHealth('freelancer'), records: 1134, billedUnits: 0 });
  const unmeasured = costOf({ ...UPWORK, usefulLeads: 0 }, emptyHealth('apify'));
  const ranked: SourceCost[] = rankByYield([unmeasured, measured]);
  assert.equal(ranked[0].source, 'freelancer');
});

test('ranking is deterministic when yields tie', () => {
  const a = costOf({ ...UPWORK, source: 'aaa', usefulLeads: 10 }, { ...emptyHealth('aaa'), records: 100 });
  const b = costOf({ ...UPWORK, source: 'bbb', usefulLeads: 10 }, { ...emptyHealth('bbb'), records: 100 });
  assert.deepEqual(rankByYield([b, a]).map(x => x.source), ['aaa', 'bbb']);
});
