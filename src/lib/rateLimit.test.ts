import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, quotaSubject } from './rateLimit';

// consumeQuota needs a database, so it is covered by the integration checks
// rather than here. These cover the pure parts.

test('in-process limiter allows up to the cap, then blocks', () => {
  const limited = createRateLimiter(3, 60_000);
  assert.equal(limited('a'), false);
  assert.equal(limited('a'), false);
  assert.equal(limited('a'), false);
  assert.equal(limited('a'), true, '4th request in the window is blocked');
});

test('in-process limiter buckets are per key', () => {
  const limited = createRateLimiter(1, 60_000);
  assert.equal(limited('a'), false);
  assert.equal(limited('b'), false, 'a different key has its own bucket');
  assert.equal(limited('a'), true);
});

test('quotaSubject prefers the signed session over the IP header', () => {
  // The session id comes from a signed cookie claim; the header does not.
  // Keying on the header alone let an attacker reset their bucket per request.
  assert.equal(quotaSubject('guest_123', '1.2.3.4'), 's:guest_123');
  assert.equal(quotaSubject(undefined, '1.2.3.4'), 'ip:1.2.3.4');
  assert.equal(quotaSubject('   ', '1.2.3.4'), 'ip:1.2.3.4', 'blank session id is not a subject');
});

test('quotaSubject uses the RIGHT-most forwarded element', () => {
  // x-forwarded-for is client-supplied on the left and appended to by each
  // proxy, so the right-most entry is the one added by the closest trusted
  // proxy. Taking the left-most made the key attacker-chosen.
  assert.equal(quotaSubject(undefined, '9.9.9.9, 10.0.0.1, 203.0.113.7'), 'ip:203.0.113.7');
  assert.equal(quotaSubject(undefined, 'spoofed, 203.0.113.7'), 'ip:203.0.113.7');
});

test('quotaSubject degrades safely with no header', () => {
  assert.equal(quotaSubject(undefined, null), 'ip:unknown');
  assert.equal(quotaSubject(undefined, ''), 'ip:unknown');
});

test('quotaSubject bounds key length', () => {
  const long = 'x'.repeat(500);
  assert.ok(quotaSubject(long, null).length <= 102);
  assert.ok(quotaSubject(undefined, long).length <= 67);
});
