import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateProfileUrl, detectPlatform, isPrivateIp, isHostPrivate } from '../src/lib/profile/url';

describe('validateProfileUrl', () => {
  it('accepts a valid upwork profile URL', () => {
    const r = validateProfileUrl('https://www.upwork.com/freelancers/~somehandle');
    assert.equal(r.ok, true);
    assert.equal(r.platform, 'upwork');
  });

  it('accepts a valid freelancer profile URL', () => {
    const r = validateProfileUrl('https://www.freelancer.com/u/someuser');
    assert.equal(r.ok, true);
    assert.equal(r.platform, 'freelancer');
  });

  it('accepts subdomains of allowed domains', () => {
    const r = validateProfileUrl('https://clients.upwork.com/freelancers/~handle');
    assert.equal(r.ok, true);
    assert.equal(r.platform, 'upwork');
  });

  it('rejects http:// URLs', () => {
    const r = validateProfileUrl('http://www.upwork.com/freelancers/~handle');
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /https/i);
  });

  it('rejects non-http schemes', () => {
    const r = validateProfileUrl('ftp://upwork.com/x');
    assert.equal(r.ok, false);
  });

  it('rejects URLs with embedded credentials', () => {
    const r = validateProfileUrl('https://user:pass@upwork.com/freelancers/~h');
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /credential/i);
  });

  it('rejects custom ports', () => {
    const r = validateProfileUrl('https://upwork.com:8080/freelancers/~h');
    assert.equal(r.ok, false);
  });

  it('rejects IP literal hosts', () => {
    const r = validateProfileUrl('https://127.0.0.1/freelancers/~h');
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /IP/i);
  });

  it('rejects unsupported domains', () => {
    const r = validateProfileUrl('https://github.com/someuser');
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /unsupported/i);
  });

  it('rejects domain-spoofing with trailing dot prefix', () => {
    const r = validateProfileUrl('https://upwork.com.evil.com/freelancers/~h');
    assert.equal(r.ok, false);
  });

  it('rejects bare-domain URLs without a profile path', () => {
    const r = validateProfileUrl('https://upwork.com');
    assert.equal(r.ok, false);
  });

  it('rejects empty input', () => {
    const r = validateProfileUrl('');
    assert.equal(r.ok, false);
  });

  it('rejects garbage input', () => {
    const r = validateProfileUrl('not a url');
    assert.equal(r.ok, false);
  });
});

describe('detectPlatform', () => {
  it('detects upwork', () => {
    assert.equal(detectPlatform('https://www.upwork.com/freelancers/~x'), 'upwork');
  });
  it('detects freelancer', () => {
    assert.equal(detectPlatform('https://www.freelancer.com/u/x'), 'freelancer');
  });
  it('returns null for unsupported host', () => {
    assert.equal(detectPlatform('https://example.com/x'), null);
  });
});

describe('isPrivateIp', () => {
  it('flags private IPv4 ranges', () => {
    assert.equal(isPrivateIp('127.0.0.1'), true);
    assert.equal(isPrivateIp('10.0.0.1'), true);
    assert.equal(isPrivateIp('192.168.1.1'), true);
    assert.equal(isPrivateIp('172.16.0.1'), true);
    assert.equal(isPrivateIp('169.254.0.1'), true);
    assert.equal(isPrivateIp('100.64.0.1'), true); // CGNAT
  });
  it('allows public IPv4', () => {
    assert.equal(isPrivateIp('8.8.8.8'), false);
    assert.equal(isPrivateIp('1.1.1.1'), false);
  });
  it('flags private IPv6', () => {
    assert.equal(isPrivateIp('::1'), true);
    assert.equal(isPrivateIp('fd00::1'), true);
    assert.equal(isPrivateIp('fe80::1'), true);
    assert.equal(isPrivateIp('::ffff:127.0.0.1'), true);
    assert.equal(isPrivateIp('::ffff:8.8.8.8'), false);
  });
});

describe('isHostPrivate', () => {
  it('fails closed for localhost', async () => {
    assert.equal(await isHostPrivate('localhost'), true);
  });
});
