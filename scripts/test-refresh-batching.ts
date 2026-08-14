/**
 * Tests for the ActiveJobRefresher selection/batching fix (proposal-count
 * backfill). No network, no DB: exercises the pure merge/selection/batch logic.
 *
 * Verifies:
 *  - proposal-count merge rules (null->positive backfill, never decrease,
 *    unknown never overwrites known, genuine 0 handled, 50 cap)
 *  - candidate selection overlaps the fresh provider data (the refreshed=0 bug)
 *  - recency ordering of candidates (newest first, matching the fetch)
 *  - cursor/batch slicing, wrap-around, and full-cycle progression
 *  - a recent eligible job is reached; a job outside the fetch window is not
 */
import {
  computeProposalPatch,
  selectRefreshCandidates,
  buildRefreshBatch,
  type RefreshCandidate,
} from "../src/providers/ActiveJobRefresher";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

// ---------- proposal-count merge rules ----------

// null / unknown / range (parser resolves range bands to null) -> remain unknown
check('null fresh, null stored -> no write', computeProposalPatch(null, null), undefined);
check('null fresh, positive stored -> no write', computeProposalPatch(null, 7), undefined);
check('null fresh, 0 stored -> no write', computeProposalPatch(null, 0), undefined);

// confirmed positive -> backfill / advance only (never decrease)
check('null stored, positive fresh -> backfill', computeProposalPatch(10, null), 10);
check('lower stored, higher fresh -> advance', computeProposalPatch(7, 3), 7);
check('equal -> no write', computeProposalPatch(7, 7), undefined);
check('higher stored, lower fresh -> never decrease', computeProposalPatch(3, 7), undefined);
check('0 stored, positive fresh -> backfill', computeProposalPatch(10, 0), 10);

// positive never decreased to 0 or unknown
check('positive stored, 0 fresh -> never decrease', computeProposalPatch(0, 7), undefined);

// genuine literal 0 (provider exact parse, NOT a range band) -> writes 0 only
// when the stored value is not a confirmed positive
check('null stored, genuine 0 fresh -> write 0', computeProposalPatch(0, null), 0);
check('0 stored, 0 fresh -> write 0 (no-op)', computeProposalPatch(0, 0), 0);

// 50 cap (Upwork "50+" normalizes to 50)
check('60 fresh -> capped at 50', computeProposalPatch(60, null), 50);
check('100 fresh, 90 stored -> capped advance', computeProposalPatch(100, 90), 50);
check('50 fresh -> 50', computeProposalPatch(50, null), 50);
check('12 fresh -> 12 (no cap)', computeProposalPatch(12, null), 12);

// ---------- candidate selection (the refreshed=0 bug) ----------

function cand(id: string, url: string, createdAt: string, proposalCount: number | null): RefreshCandidate {
  return { id, url, proposalCount, createdAt: new Date(createdAt) };
}

const c1 = cand('a1', 'https://www.upwork.com/jobs/~02208800001', '2026-08-14T10:00:00Z', null);
const c2 = cand('a2', 'https://www.upwork.com/jobs/~02208800002', '2026-08-14T11:00:00Z', null);
const c3 = cand('a3', 'https://www.upwork.com/jobs/~02208800003', '2026-08-14T12:00:00Z', 9);
const active = [c1, c2, c3];

// fresh provider data contains c1 and c2 only (c3 aged out of the fetch window)
const byUrl = new Map<string, RefreshCandidate>([
  ['https://www.upwork.com/jobs/~02208800002', c2],
  ['https://www.upwork.com/jobs/~02208800001', c1],
]);

const selected = selectRefreshCandidates(active, byUrl);
check('only jobs with fresh data are candidates', selected.map((s) => s.id), ['a2', 'a1']);
check('candidates are newest first', selected.map((s) => s.id)[0], 'a2');
check('job outside refresh window is excluded', selected.some((s) => s.id === 'a3'), false);

// empty fresh data -> no candidates (jobs preserve stored values)
check('empty fetch -> no candidates', selectRefreshCandidates(active, new Map()).length, 0);

// URL normalization: the byUrl map is keyed by normalized urls (strips query,
// fragment, trailing slash, lowercases), so a candidate with extra cruft still
// matches its fresh data.
const byUrlNorm = new Map<string, RefreshCandidate>([
  ['https://www.upwork.com/jobs/~02208800001', c1],
]);
const candidateWithQuery = cand('a1q', 'https://www.upwork.com/jobs/~02208800001?utm_source=x#frag', '2026-08-14T10:00:00Z', null);
check('normalized url matches despite query + fragment', selectRefreshCandidates([candidateWithQuery], byUrlNorm).map((s) => s.id), ['a1q']);

// ---------- cursor / batch / wrap ----------

const many = Array.from({ length: 100 }, (_, i) =>
  cand(`job-${i}`, `https://www.upwork.com/jobs/~0220880${String(i).padStart(5, '0')}`, `2026-08-14T${String(10 + i % 12).padStart(2, '0')}:00:00Z`, null));

const b0 = buildRefreshBatch(many, '', 30);
check('run1 starts at 0', b0.startIdx, 0);
check('run1 batch size', b0.batch.length, 30);
check('run1 not at end', b0.reachedEnd, false);
check('run1 cursor = last id', b0.nextAfterId, 'job-29');

const b1 = buildRefreshBatch(many, b0.nextAfterId, 30);
check('run2 resumes after cursor', b1.startIdx, 30);
check('run2 batch ids', b1.batch.map((x) => x.id)[0], 'job-30');
check('run2 cursor', b1.nextAfterId, 'job-59');

const b2 = buildRefreshBatch(many, b1.nextAfterId, 30);
check('run3 cursor', b2.nextAfterId, 'job-89');

const b3 = buildRefreshBatch(many, b2.nextAfterId, 30);
check('run4 reaches the end', b3.reachedEnd, true);
check('run4 batch size (tail)', b3.batch.length, 10);
check('run4 cursor wraps', b3.nextAfterId, '');

// full cycle visits every candidate exactly once
const visited = [...b0.batch, ...b1.batch, ...b2.batch, ...b3.batch].map((x) => x.id).sort();
const all = many.map((x) => x.id).sort();
check('full cycle visits every candidate exactly once', visited, all);

// after wrap the next run restarts at 0
const b4 = buildRefreshBatch(many, b3.nextAfterId, 30);
check('run5 wraps to start', b4.startIdx, 0);

// unknown cursor (job purged) -> reset to start
check('unknown cursor resets to 0', buildRefreshBatch(many, 'purged-job', 30).startIdx, 0);

// cursor at the very last candidate -> wraps
check('cursor at last candidate wraps', buildRefreshBatch(many, 'job-99', 30).startIdx, 0);

// empty candidates -> empty batch, wrap
const empty = buildRefreshBatch([], '', 30);
check('empty candidates -> empty batch', empty.batch.length, 0);
check('empty candidates -> reached end', empty.reachedEnd, true);
check('empty candidates -> wrap cursor', empty.nextAfterId, '');

// batch larger than candidate list -> single batch, reached end
const b5 = buildRefreshBatch([c1, c2], '', 30);
check('oversized batch covers all', b5.batch.length, 2);
check('oversized batch reaches end', b5.reachedEnd, true);

// ---------- end-to-end scenario: recent eligible job is reached ----------

// Fresh fetch returns 2 jobs; both are stored active with null counts.
const freshMap = new Map<string, RefreshCandidate>([
  ['https://www.upwork.com/jobs/~02208800001', c1],
  ['https://www.upwork.com/jobs/~02208800002', c2],
]);
const candidates = selectRefreshCandidates(active, freshMap);
const batch = buildRefreshBatch(candidates, '', 30).batch;
// c1 stored null, fresh count 10 -> write 10 (backfill)
check('stored null + fresh 10 -> backfill 10', computeProposalPatch(10, c1.proposalCount), 10);
// c2 stored null, fresh count 4 -> write 4
check('stored null + fresh 4 -> backfill 4', computeProposalPatch(4, c2.proposalCount), 4);
check('scenario batch is non-empty and ordered', batch.map((x) => x.id), ['a2', 'a1']);

if (failures === 0) {
  console.log('\nAll refresh-batching tests passed.');
  process.exit(0);
} else {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
