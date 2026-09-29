import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bestDiscoveryHours,
  canSpend,
  discoverySlots,
  spendableBudget,
} from './apifyAllocation';

// ── The reserve ────────────────────────────────────────────────────────

test('refresh can never take the budget discovery needs', () => {
  // The measured failure: discovery issues 4 queries per run against a
  // 16/day budget, the cron fires ~10 times a day, and the refresher draws
  // from the same pool in between. Whoever asked first won.
  const reserve = 8;
  assert.equal(spendableBudget('discovery', 16, reserve), 16);
  assert.equal(spendableBudget('refresh', 16, reserve), 8);
  assert.equal(spendableBudget('refresh', 9, reserve), 1);
  assert.equal(spendableBudget('refresh', 8, reserve), 0, 'refresh stops at the floor');
  assert.equal(spendableBudget('discovery', 8, reserve), 8, 'discovery keeps spending below it');
});

test('refresh degrades to zero before discovery loses one query', () => {
  const reserve = 8;
  for (let remaining = 16; remaining >= 0; remaining--) {
    const d = spendableBudget('discovery', remaining, reserve);
    const r = spendableBudget('refresh', remaining, reserve);
    assert.equal(d, remaining, 'discovery always gets everything left');
    assert.ok(r <= d);
    if (remaining <= reserve) assert.equal(r, 0);
  }
});

test('an exhausted budget gives nobody anything', () => {
  assert.equal(spendableBudget('discovery', 0), 0);
  assert.equal(spendableBudget('refresh', 0), 0);
  assert.equal(canSpend('discovery', 0), false);
  assert.equal(canSpend('refresh', 0), false);
});

test('nonsense inputs cannot conjure budget', () => {
  assert.equal(spendableBudget('discovery', -5), 0);
  assert.equal(spendableBudget('refresh', -5, 2), 0);
  assert.equal(spendableBudget('discovery', 2.9), 2, 'a fraction of a billed run is not a run');
  assert.equal(spendableBudget('refresh', 20, -3), 20, 'a negative reserve reserves nothing');
});

test('a zero reserve restores the old shared-pool behaviour', () => {
  assert.equal(spendableBudget('refresh', 16, 0), 16);
});

// ── Slots ──────────────────────────────────────────────────────────────

test('slots are whole discovery runs the budget affords', () => {
  // The live configuration: 4 queries per run, 16 billed runs a day.
  assert.equal(discoverySlots(16, 4), 4);
  assert.equal(discoverySlots(16, 5), 3, 'a partial run is not a run');
  assert.equal(discoverySlots(0, 4), 0);
  assert.equal(discoverySlots(16, 0), 0, 'no division by zero');
});

// ── Hour selection ─────────────────────────────────────────────────────

/** The recorded hour-of-day yield from cron_logs, rounded. */
const MEASURED = [
  { hour: 0, avgNewJobs: 8.8, runs: 26 }, { hour: 1, avgNewJobs: 7.7, runs: 15 },
  { hour: 2, avgNewJobs: 20.0, runs: 21 }, { hour: 3, avgNewJobs: 3.4, runs: 15 },
  { hour: 4, avgNewJobs: 11.7, runs: 21 }, { hour: 5, avgNewJobs: 12.0, runs: 28 },
  { hour: 6, avgNewJobs: 20.8, runs: 39 }, { hour: 7, avgNewJobs: 15.9, runs: 29 },
  { hour: 8, avgNewJobs: 17.9, runs: 33 }, { hour: 9, avgNewJobs: 11.2, runs: 38 },
  { hour: 10, avgNewJobs: 9.2, runs: 33 }, { hour: 11, avgNewJobs: 11.3, runs: 38 },
  { hour: 12, avgNewJobs: 20.2, runs: 37 }, { hour: 13, avgNewJobs: 18.8, runs: 43 },
  { hour: 14, avgNewJobs: 6.4, runs: 18 }, { hour: 15, avgNewJobs: 11.0, runs: 41 },
  { hour: 16, avgNewJobs: 11.7, runs: 39 }, { hour: 17, avgNewJobs: 14.1, runs: 39 },
  { hour: 18, avgNewJobs: 16.4, runs: 35 }, { hour: 19, avgNewJobs: 10.7, runs: 49 },
  { hour: 20, avgNewJobs: 6.8, runs: 44 }, { hour: 21, avgNewJobs: 4.6, runs: 36 },
  { hour: 22, avgNewJobs: 6.7, runs: 35 }, { hour: 23, avgNewJobs: 9.8, runs: 48 },
];

test('the budget goes to the hours that actually yield', () => {
  // Yield varies from 3.4 new jobs per run at 03:00 to 20.8 at 06:00 — a
  // factor of six for the same price.
  const hours = bestDiscoveryHours(MEASURED, 4)!;
  assert.deepEqual([...hours].sort((a, b) => a - b), [2, 6, 12, 13]);
  assert.ok(!hours.has(3), 'the worst hour must not be bought at the same price');
  assert.ok(!hours.has(21));
});

test('an hour with too few observations cannot win on one lucky run', () => {
  const sparse = [...MEASURED, { hour: 3, avgNewJobs: 99, runs: 1 }].filter(
    (h, i, a) => a.findIndex(x => x.hour === h.hour) === i || h.runs === 1,
  );
  const hours = bestDiscoveryHours(
    [{ hour: 3, avgNewJobs: 99, runs: 1 }, ...MEASURED.filter(h => h.hour !== 3)],
    4,
  )!;
  assert.ok(!hours.has(3), 'one observation is not a distribution');
  assert.equal(sparse.length > 0, true);
});

test('no history means no concentration, not no scraping', () => {
  assert.equal(bestDiscoveryHours([], 4), null);
  assert.equal(bestDiscoveryHours(MEASURED.slice(0, 3), 4), null, 'too few usable hours');
  assert.equal(bestDiscoveryHours(MEASURED, 0), null);
});

test('selection is deterministic when yields tie', () => {
  const flat = Array.from({ length: 24 }, (_, hour) => ({ hour, avgNewJobs: 10, runs: 20 }));
  const a = bestDiscoveryHours(flat, 3)!;
  const b = bestDiscoveryHours([...flat].reverse(), 3)!;
  assert.deepEqual([...a].sort(), [...b].sort());
  assert.deepEqual([...a].sort((x, y) => x - y), [0, 1, 2], 'ties break on the earlier hour');
});

test('malformed hours are ignored rather than trusted', () => {
  const bad = [
    { hour: 99, avgNewJobs: 500, runs: 100 },
    { hour: -1, avgNewJobs: 500, runs: 100 },
    ...MEASURED,
  ];
  const hours = bestDiscoveryHours(bad, 4)!;
  for (const h of hours) assert.ok(h >= 0 && h < 24, `bad hour leaked: ${h}`);
});

// ── Spending decision ──────────────────────────────────────────────────

import { shouldSpendDiscoveryNow } from './apifyAllocation';

const TOP = new Set([2, 6, 12, 13]);

test('a top-yield hour is always funded', () => {
  for (const hour of TOP) {
    assert.equal(
      shouldSpendDiscoveryNow({ hour, topHours: TOP, remaining: 4, queriesPerRun: 4, hoursLeftToday: 24 - hour }),
      true,
    );
  }
});

test('a quiet hour cannot eat the budget a rich hour is waiting for', () => {
  // 02:00, three rich hours still ahead (6, 12, 13) needing 12 queries.
  // Only 8 left, so a non-rich hour must not spend.
  assert.equal(
    shouldSpendDiscoveryNow({ hour: 3, topHours: TOP, remaining: 8, queriesPerRun: 4, hoursLeftToday: 21 }),
    false,
  );
});

test('surplus above what the rich hours need is spent, not wasted', () => {
  // Same position, but the budget covers the three rich hours AND this run.
  assert.equal(
    shouldSpendDiscoveryNow({ hour: 3, topHours: TOP, remaining: 16, queriesPerRun: 4, hoursLeftToday: 21 }),
    true,
  );
});

test('late in the day with no rich hours left, surplus is released', () => {
  assert.equal(
    shouldSpendDiscoveryNow({ hour: 22, topHours: TOP, remaining: 4, queriesPerRun: 4, hoursLeftToday: 2 }),
    true,
  );
});

test('a run that cannot be paid for in full is not started', () => {
  assert.equal(
    shouldSpendDiscoveryNow({ hour: 6, topHours: TOP, remaining: 3, queriesPerRun: 4, hoursLeftToday: 18 }),
    false,
  );
});

test('with no usable history, the normal cadence applies', () => {
  // No basis to concentrate is not a reason to stop scraping.
  assert.equal(
    shouldSpendDiscoveryNow({ hour: 3, topHours: null, remaining: 4, queriesPerRun: 4, hoursLeftToday: 21 }),
    true,
  );
  assert.equal(
    shouldSpendDiscoveryNow({ hour: 3, topHours: new Set(), remaining: 4, queriesPerRun: 4, hoursLeftToday: 21 }),
    true,
  );
});
