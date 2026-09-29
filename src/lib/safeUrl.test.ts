import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeExternalUrl, safeExternalUrl } from './safeUrl';

// These cases are the reason the guard exists: a scraped listing URL is
// eventually handed to window.open(), which is an imperative sink React does
// not sanitise. The HTML-scrape path only required an href to CONTAIN
// "upwork.com", so a javascript: URL carrying that substring passed.

test('accepts ordinary http(s) listing URLs', () => {
  assert.equal(isSafeExternalUrl('https://www.upwork.com/jobs/~021234'), true);
  assert.equal(isSafeExternalUrl('http://example.com/a?b=c#d'), true);
  assert.equal(isSafeExternalUrl('  https://www.freelancer.com/projects/1  '), true);
});

test('rejects script-capable and non-navigable schemes', () => {
  for (const bad of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'javascript:/*upwork.com/jobs/~*/alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://example.com/abc',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ]) {
    assert.equal(isSafeExternalUrl(bad), false, `should reject ${bad}`);
  }
});

test('rejects malformed, relative and non-string values', () => {
  for (const bad of ['', '   ', 'not a url', '/jobs/~021', '//example.com', null, undefined, 42, {}]) {
    assert.equal(isSafeExternalUrl(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test('safeExternalUrl returns a trimmed URL or null', () => {
  assert.equal(safeExternalUrl('  https://a.test/x '), 'https://a.test/x');
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(safeExternalUrl(''), null);
});
