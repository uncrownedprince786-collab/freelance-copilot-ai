import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApifyUpworkProvider } from './ApifyUpworkProvider';

/**
 * These pin the two things that decide the Apify bill.
 *
 * The actor charges $0.001 per run start and $0.001 per emitted result. The
 * previous integration sent each of its four search terms as its own billed
 * run and re-bought every listing on every pass — measured at ~50 records a
 * day against ~28 genuinely new ones. Batching the terms into one run and
 * turning on incremental mode is worth roughly 3x on run starts and ~44% on
 * result fees, and it is the sort of thing a well-meaning refactor silently
 * undoes.
 */

// Tokens are read in a field initialiser, i.e. at construction, so setting
// them before any provider is built is enough — no dynamic import needed.
process.env.APIFY_TOKEN = 'test-token-aaaa';
delete process.env.APIFY_TOKEN2;
delete process.env.APIFY_TOKEN3;

interface Captured { url: string; body: Record<string, unknown> }

async function runWithStubbedFetch(items: unknown[]): Promise<Captured[]> {
  const calls: Captured[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(items), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    await new ApifyUpworkProvider().fetchJobs();
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls;
}

test('a discovery pass costs ONE billed run, not one per search term', async () => {
  const calls = await runWithStubbedFetch([]);
  assert.equal(calls.length, 1, `expected a single batched run, got ${calls.length}`);
});

test('all search terms travel in that one run', async () => {
  const [call] = await runWithStubbedFetch([]);
  assert.ok(Array.isArray(call.body.query), 'query must be an array to batch into one Actor-Start');
  assert.ok((call.body.query as string[]).length > 1, 'more than one term should be batched');
  for (const q of call.body.query as string[]) {
    assert.equal(typeof q, 'string');
    assert.ok(q.length > 0);
  }
});

test('incremental mode is on, with a stable state key', async () => {
  // Without these the actor re-emits — and re-bills — listings already
  // stored. This is the 44% of result spend the change was made to stop.
  const [call] = await runWithStubbedFetch([]);
  assert.equal(call.body.incrementalMode, true);
  assert.equal(typeof call.body.stateKey, 'string');
  assert.ok((call.body.stateKey as string).length > 0);
  assert.notEqual(call.body.emitUnchanged, true, 'emitting unchanged rows is exactly the spend being avoided');
});

test('results are still requested newest-first', async () => {
  const [call] = await runWithStubbedFetch([]);
  assert.equal(call.body.sort, 'recency');
});

test('a result cap is always sent', async () => {
  // Incremental mode makes this a safety bound rather than a cost driver,
  // but an unbounded run is still an unbounded bill.
  const [call] = await runWithStubbedFetch([]);
  assert.equal(typeof call.body.maxResults, 'number');
  assert.ok((call.body.maxResults as number) > 0);
});

test('an empty result set is a normal incremental outcome, not a failure', async () => {
  // Once incremental mode is on, most passes legitimately return nothing —
  // that is the feature working. Treating it as a provider failure would
  // drive the backoff and eventually disable a healthy source.
  const provider = new ApifyUpworkProvider();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  try {
    const jobs = await provider.fetchJobs();
    assert.deepEqual(jobs, []);
    assert.equal(provider.lastRunStatus?.failed, false, 'an empty incremental pass must not be a failure');
  } finally {
    globalThis.fetch = realFetch;
  }
});
