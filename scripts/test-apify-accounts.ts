/**
 * Tests for Apify account rotation + failover (third Apify account).
 *
 * Verifies:
 *  - query slicing is deterministic across 1 / 2 / 3 configured accounts
 *  - the slice's primary account always heads a query's candidate order
 *  - every other account is a fallback candidate (N-account failover)
 *  - an account unavailable for the rest of the run is skipped while the
 *    remaining accounts still serve their queries
 *  - a single configured account is always retried (never skipped)
 *  - all accounts unavailable -> no candidate (that query is skipped; the rest
 *    of the run and other providers are unaffected)
 *  - a query is never assigned to the same account twice
 */
import {
  computeSliceSize,
  accountOrderForQuery,
} from "../src/providers/ApifyUpworkProvider";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

const A = 'token-a';
const B = 'token-b';
const C = 'token-c';

// --- slicing ---
check('slice size: 6 queries / 1 token', computeSliceSize(6, 1), 6);
check('slice size: 6 queries / 2 tokens', computeSliceSize(6, 2), 3);
check('slice size: 6 queries / 3 tokens', computeSliceSize(6, 3), 2);
check('slice size: guarded with 0 tokens', computeSliceSize(6, 0), 1);

// --- 3 accounts, nothing unavailable ---
check('3 tokens q0 order', accountOrderForQuery(0, [A, B, C], 2, new Set()), [A, B, C]);
check('3 tokens q1 order', accountOrderForQuery(1, [A, B, C], 2, new Set()), [A, B, C]);
check('3 tokens q2 order', accountOrderForQuery(2, [A, B, C], 2, new Set()), [B, A, C]);
check('3 tokens q4 order', accountOrderForQuery(4, [A, B, C], 2, new Set()), [C, A, B]);

// --- 3 accounts, one unavailable for the rest of the run ---
check('3 tokens q2 with A unavailable', accountOrderForQuery(2, [A, B, C], 2, new Set([A])), [B, C]);
check('3 tokens q0 with C unavailable', accountOrderForQuery(0, [A, B, C], 2, new Set([C])), [A, B]);
check('3 tokens q5 with B unavailable', accountOrderForQuery(5, [A, B, C], 2, new Set([B])), [C, A]);

// --- 2 accounts (existing behaviour preserved) ---
check('2 tokens q0 order', accountOrderForQuery(0, [A, B], 3, new Set()), [A, B]);
check('2 tokens q3 order', accountOrderForQuery(3, [A, B], 3, new Set()), [B, A]);
check('2 tokens q1 with A unavailable', accountOrderForQuery(1, [A, B], 3, new Set([A])), [B]);

// --- single account is always retried (transient failures get a chance) ---
check('1 token q0 even when unavailable', accountOrderForQuery(0, [A], 6, new Set([A])), [A]);

// --- all unavailable -> no candidate for that query ---
check('3 tokens all unavailable', accountOrderForQuery(0, [A, B, C], 2, new Set([A, B, C])), []);
check('0 tokens configured', accountOrderForQuery(0, [], 2, new Set()), []);

// --- determinism (no per-run rotation randomness) ---
check(
  'deterministic across calls',
  accountOrderForQuery(2, [A, B, C], 2, new Set()),
  accountOrderForQuery(2, [A, B, C], 2, new Set()),
);

// --- a query is never assigned to the same account twice ---
for (const qi of [0, 1, 2, 3, 4, 5]) {
  const order = accountOrderForQuery(qi, [A, B, C], 2, new Set());
  check(`no duplicate account in order for q${qi}`, new Set(order).size, order.length);
}

if (failures === 0) {
  console.log('\nAll Apify account tests passed.');
  process.exit(0);
} else {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
