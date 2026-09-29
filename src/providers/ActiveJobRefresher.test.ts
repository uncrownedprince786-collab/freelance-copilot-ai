import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProposalPatch,
  selectRefreshCandidates,
  buildRefreshBatch,
  type RefreshCandidate,
} from './ActiveJobRefresher';

// ---------------------------------------------------------------------------
// computeProposalPatch
// ---------------------------------------------------------------------------
// Competition counts are the signal the whole ranking leans on, so the merge
// rule matters: an unknown value must never erase a known one, and the count
// must never go backwards (Upwork does not un-receive proposals).

test('unknown fresh value never overwrites a stored count', () => {
  assert.equal(computeProposalPatch(null, 12), undefined);
  assert.equal(computeProposalPatch(null, 0), undefined);
  assert.equal(computeProposalPatch(null, null), undefined);
});

test('a higher confirmed count advances the stored value', () => {
  assert.equal(computeProposalPatch(12, 5), 12);
  assert.equal(computeProposalPatch(3, null), 3);
});

test('a lower confirmed count never decreases the stored value', () => {
  assert.equal(computeProposalPatch(5, 12), undefined);
  assert.equal(computeProposalPatch(12, 12), undefined, 'equal is not an advance');
});

test('counts are capped at 50 to match the "50+" band convention', () => {
  assert.equal(computeProposalPatch(80, 10), 50);
  assert.equal(computeProposalPatch(50, 49), 50);
});

test('a genuine zero backfills only a null or zero stored value', () => {
  assert.equal(computeProposalPatch(0, null), 0, 'backfills unknown');
  assert.equal(computeProposalPatch(0, 0), 0);
  assert.equal(computeProposalPatch(0, 7), undefined, 'never wipes a real positive count');
});

// ---------------------------------------------------------------------------
// selectRefreshCandidates
// ---------------------------------------------------------------------------

const cand = (id: string, url: string, createdAt: string): RefreshCandidate => ({
  id,
  url,
  proposalCount: null,
  createdAt: new Date(createdAt),
});

test('only jobs present in the fresh fetch are candidates', () => {
  const active = [
    cand('a', 'https://x.test/1', '2026-01-01T00:00:00Z'),
    cand('b', 'https://x.test/2', '2026-01-02T00:00:00Z'),
  ];
  const byUrl = new Map<string, unknown>([['https://x.test/2', {}]]);
  const out = selectRefreshCandidates(active, byUrl);
  assert.deepEqual(out.map(o => o.id), ['b']);
});

test('candidate URL matching ignores case, query, fragment and trailing slash', () => {
  const active = [
    cand('a', 'https://X.test/Job?utm=1', '2026-01-01T00:00:00Z'),
    cand('b', 'https://x.test/other/', '2026-01-02T00:00:00Z'),
    cand('c', 'https://x.test/third#frag', '2026-01-03T00:00:00Z'),
  ];
  const byUrl = new Map<string, unknown>([
    ['https://x.test/job', {}],
    ['https://x.test/other', {}],
    ['https://x.test/third', {}],
  ]);
  assert.equal(selectRefreshCandidates(active, byUrl).length, 3);
});

test('candidates are ordered newest first, matching the recency-sorted fetch', () => {
  const active = [
    cand('old', 'https://x.test/1', '2026-01-01T00:00:00Z'),
    cand('new', 'https://x.test/2', '2026-03-01T00:00:00Z'),
    cand('mid', 'https://x.test/3', '2026-02-01T00:00:00Z'),
  ];
  const byUrl = new Map<string, unknown>([
    ['https://x.test/1', {}], ['https://x.test/2', {}], ['https://x.test/3', {}],
  ]);
  assert.deepEqual(selectRefreshCandidates(active, byUrl).map(o => o.id), ['new', 'mid', 'old']);
});

test('jobs with no URL are never candidates', () => {
  const active = [cand('a', '', '2026-01-01T00:00:00Z')];
  assert.equal(selectRefreshCandidates(active, new Map([['', {}]])).length, 0);
});

// ---------------------------------------------------------------------------
// buildRefreshBatch
// ---------------------------------------------------------------------------
// The cursor walks the candidate list across runs. The failure mode this
// guards is a cursor pointing at a job that has since been purged, which must
// restart rather than skip the whole list.

const list = (n: number): RefreshCandidate[] =>
  Array.from({ length: n }, (_, i) => cand(`id${i}`, `https://x.test/${i}`, '2026-01-01T00:00:00Z'));

test('an empty candidate list yields an empty batch and signals the end', () => {
  const r = buildRefreshBatch([], '', 10);
  assert.deepEqual(r.batch, []);
  assert.equal(r.reachedEnd, true);
  assert.equal(r.nextAfterId, '');
});

test('a fresh cursor starts at the beginning', () => {
  const r = buildRefreshBatch(list(10), '', 3);
  assert.deepEqual(r.batch.map(b => b.id), ['id0', 'id1', 'id2']);
  assert.equal(r.nextAfterId, 'id2');
  assert.equal(r.reachedEnd, false);
});

test('the cursor resumes after the last processed job', () => {
  const r = buildRefreshBatch(list(10), 'id2', 3);
  assert.deepEqual(r.batch.map(b => b.id), ['id3', 'id4', 'id5']);
});

test('an unknown cursor (its job was purged) wraps to the start rather than skipping', () => {
  const r = buildRefreshBatch(list(5), 'deleted-id', 2);
  assert.equal(r.startIdx, 0);
  assert.deepEqual(r.batch.map(b => b.id), ['id0', 'id1']);
});

test('reaching the end clears the cursor so the next run wraps', () => {
  const r = buildRefreshBatch(list(5), 'id2', 3);
  assert.deepEqual(r.batch.map(b => b.id), ['id3', 'id4']);
  assert.equal(r.reachedEnd, true);
  assert.equal(r.nextAfterId, '', 'cleared so the next run restarts');
});

test('a cursor past the end wraps instead of returning nothing', () => {
  const r = buildRefreshBatch(list(3), 'id2', 2);
  assert.equal(r.startIdx, 0);
  assert.ok(r.batch.length > 0, 'a full cycle must not stall');
});

test('a batch larger than the list returns the whole list once', () => {
  const r = buildRefreshBatch(list(3), '', 100);
  assert.equal(r.batch.length, 3);
  assert.equal(r.reachedEnd, true);
});
