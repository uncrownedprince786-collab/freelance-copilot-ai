import { createRequire } from 'module';
import type { Job } from '../src/types/job';

// Next aliases "server-only" to an empty module at build time; under plain tsx
// the real package throws. This script only exercises JobPipeline's pure
// retention/dedup logic (no DB calls), so stub the module exactly like Next
// does before loading the module graph.
const req = createRequire(import.meta.url);
try {
  const serverOnlyId = req.resolve('server-only');
  req.cache[serverOnlyId] = { id: serverOnlyId, filename: serverOnlyId, loaded: true, exports: {} } as NodeModule;
} catch { /* not installed */ }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { JobPipeline } = req('../src/providers/JobPipeline') as typeof import('../src/providers/JobPipeline');

const DAY = 24 * 60 * 60 * 1000;
const nowMs = Date.now();

let pass = 0;
let fail = 0;
function assert(label: string, got: boolean) {
  if (got) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
}

function mkJob(ageMs: number, applied = false, firstSeen = true): Job {
  return {
    id: `t-${ageMs}`,
    url: `https://www.upwork.com/jobs/~x${ageMs}`,
    title: 't',
    description: '',
    skills: [],
    budget: { type: 'fixed', amount: 100 },
    experienceLevel: null,
    duration: null,
    connectsRequired: null,
    proposalCount: null,
    interviewingCount: null,
    hiresCount: null,
    postedAt: new Date(nowMs - ageMs),
    firstSeenAt: firstSeen ? new Date(nowMs - ageMs) : undefined,
    applied,
    client: { name: null, country: null, rating: null, totalSpent: null, jobsPosted: null, totalHires: null, paymentVerified: null, lastActivityAt: null, openJobs: null },
    source: 'upwork',
    score: null,
    fetchedAt: new Date(),
    platform: 'Upwork',
  };
}

const pipeline = new JobPipeline();
const purge = (pipeline as unknown as { purgeExpiredJobs(jobs: Job[], nowMs: number): Job[] }).purgeExpiredJobs.bind(pipeline);
const norm = (JobPipeline as unknown as { normUrlKey(url: string): string }).normUrlKey;

console.log('[1] Retention boundary (unapplied, first-seen anchored):');
assert('2 hours old -> KEEP', purge([mkJob(2 * 60 * 60 * 1000)], nowMs).length === 1);
assert('3 days old -> KEEP', purge([mkJob(3 * DAY)], nowMs).length === 1);
assert('6d23h old -> KEEP', purge([mkJob(6 * DAY + 23 * 60 * 60 * 1000)], nowMs).length === 1);
assert('exactly 7d old -> KEEP (<= 7d; DB delete uses strict <)', purge([mkJob(7 * DAY)], nowMs).length === 1);
assert('8 days old -> PURGE', purge([mkJob(8 * DAY)], nowMs).length === 0);

console.log('[2] Applied retention (40 days):');
assert('applied 30d -> KEEP', purge([mkJob(30 * DAY, true)], nowMs).length === 1);
assert('applied 39d23h -> KEEP', purge([mkJob(39 * DAY + 23 * 60 * 60 * 1000, true)], nowMs).length === 1);
assert('applied 41d -> PURGE', purge([mkJob(41 * DAY, true)], nowMs).length === 0);

console.log('[3] Age anchored to first-seen, NOT source postedAt:');
const drifted = mkJob(7 * DAY); // postedAt 7d ago but first-seen 2h ago
drifted.firstSeenAt = new Date(nowMs - 2 * 60 * 60 * 1000);
assert('postedAt 7d old, first-seen 2h ago -> KEEP (age not reset by source drift)', purge([drifted], nowMs).length === 1);
const neverSeen = mkJob(9 * DAY, false, false); // no firstSeenAt -> falls back to postedAt
assert('no firstSeenAt -> falls back to postedAt (9d -> PURGE)', purge([neverSeen], nowMs).length === 0);

console.log('[4] Dedup key normalization (JobPipeline.normUrlKey):');
assert('strips query string', norm('https://www.upwork.com/jobs/~abc?source=r&foo=1') === 'https://www.upwork.com/jobs/~abc');
assert('strips fragment', norm('https://www.upwork.com/jobs/~abc#details') === 'https://www.upwork.com/jobs/~abc');
assert('folds /job-post/~ onto /jobs/~', norm('https://www.upwork.com/job-post/~abc') === 'https://www.upwork.com/jobs/~abc');
assert('strips trailing slash', norm('https://www.upwork.com/jobs/~abc/') === 'https://www.upwork.com/jobs/~abc');
assert('empty input', norm('') === '');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
