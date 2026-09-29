import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSliceSize, accountOrderForQuery } from './ApifyUpworkProvider';

// Every Apify query attempt is a billed run drawn from a $5/month free tier,
// so how work is spread across accounts — and how a failed account is skipped
// — is a cost control, not a detail.

test('slice size spreads queries evenly across configured accounts', () => {
  assert.equal(computeSliceSize(4, 1), 4, 'one account serves everything');
  assert.equal(computeSliceSize(4, 2), 2);
  assert.equal(computeSliceSize(4, 3), 2, 'rounds up so no query is unassigned');
  assert.equal(computeSliceSize(4, 4), 1);
});

test('slice size never degenerates when no account is configured', () => {
  assert.equal(computeSliceSize(4, 0), 1, 'must not divide by zero or return 0');
  assert.equal(computeSliceSize(0, 0), 1);
});

test('with no tokens there is nothing to try', () => {
  assert.deepEqual(accountOrderForQuery(0, [], 1, new Set()), []);
});

test('each query starts on its own slice owner, then falls back to the others', () => {
  const tokens = ['t1', 't2'];
  const slice = computeSliceSize(4, 2); // 2
  assert.deepEqual(accountOrderForQuery(0, tokens, slice, new Set()), ['t1', 't2']);
  assert.deepEqual(accountOrderForQuery(1, tokens, slice, new Set()), ['t1', 't2']);
  assert.deepEqual(accountOrderForQuery(2, tokens, slice, new Set()), ['t2', 't1']);
  assert.deepEqual(accountOrderForQuery(3, tokens, slice, new Set()), ['t2', 't1']);
});

test('assignment is deterministic — the same query always starts on the same account', () => {
  const tokens = ['t1', 't2', 't3'];
  const slice = computeSliceSize(6, 3);
  const first = accountOrderForQuery(4, tokens, slice, new Set());
  const second = accountOrderForQuery(4, tokens, slice, new Set());
  assert.deepEqual(first, second, 'no per-run rotation: free-tier usage must stay even');
});

test('accounts already exhausted this run are skipped', () => {
  const tokens = ['t1', 't2', 't3'];
  const order = accountOrderForQuery(0, tokens, 1, new Set(['t2']));
  assert.deepEqual(order, ['t1', 't3'], 'no attempt is wasted on a known-exhausted account');
});

test('a single configured account is retried even when it just failed', () => {
  // With one account there is no alternative, so removing it would mean a
  // transient 5xx silently ends ingestion for the rest of the run.
  const order = accountOrderForQuery(0, ['only'], 1, new Set(['only']));
  assert.deepEqual(order, ['only']);
});

test('every account can appear only once per query', () => {
  const tokens = ['t1', 't2', 't3'];
  const order = accountOrderForQuery(1, tokens, 1, new Set());
  assert.equal(new Set(order).size, order.length, 'a query is never billed twice to one account');
});

test('a query index beyond the last slice clamps to the final account', () => {
  const tokens = ['t1', 't2'];
  const order = accountOrderForQuery(99, tokens, 1, new Set());
  assert.equal(order[0], 't2', 'must not index past the end and return undefined');
});
