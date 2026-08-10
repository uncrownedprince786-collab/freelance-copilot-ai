import { lookup } from 'node:dns/promises';

export type ProfilePlatform = 'upwork' | 'freelancer';

export interface PlatformRule {
  platform: ProfilePlatform;
  // Hosts ending with these are considered safe (subdomains included).
  allowedDomains: string[];
  // A profile path must be non-trivial (not just the bare domain).
  requiresPath: boolean;
}

export const PLATFORM_RULES: Record<ProfilePlatform, PlatformRule> = {
  upwork: {
    platform: 'upwork',
    allowedDomains: ['upwork.com'],
    requiresPath: true,
  },
  freelancer: {
    platform: 'freelancer',
    allowedDomains: ['freelancer.com'],
    requiresPath: true,
  },
};

const ALLOWED_HOST_SUFFIXES: { suffix: string; platform: ProfilePlatform }[] = [
  { suffix: 'upwork.com', platform: 'upwork' },
  { suffix: 'freelancer.com', platform: 'freelancer' },
];

/**
 * Detect the supported platform from a raw URL string without any network I/O.
 * Returns null when the host is not a supported domain.
 */
export function detectPlatform(rawUrl: string): ProfilePlatform | null {
  const url = tryParseHttpUrl(rawUrl);
  if (!url) return null;
  const hostname = url.hostname.toLowerCase();
  for (const { suffix, platform } of ALLOWED_HOST_SUFFIXES) {
    if (hostname === suffix || hostname.endsWith(`.${suffix}`)) {
      return platform;
    }
  }
  return null;
}

export interface UrlValidationResult {
  ok: boolean;
  url?: string;
  platform?: ProfilePlatform;
  error?: string;
}

/**
 * Validate a profile URL before fetching.
 *
 * Safety properties enforced here (pure, no network):
 * - https scheme only
 * - no userinfo / credentials
 * - default ports only (no random port smuggling)
 * - hostname must be an allowlisted supported domain (or a subdomain of it)
 * - hostname must not be an IP literal
 * - a non-trivial path is required (avoid bare-domain fetches)
 */
export function validateProfileUrl(rawUrl: string): UrlValidationResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, error: 'URL is empty.' };
  }

  const url = tryParseHttpUrl(trimmed);
  if (!url) {
    return { ok: false, error: 'Invalid URL. Use a full https:// URL.' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Only https:// URLs are supported.' };
  }

  if (url.username || url.password) {
    return { ok: false, error: 'URLs with embedded credentials are not allowed.' };
  }

  if (url.port && url.port !== '443') {
    return { ok: false, error: 'Custom ports are not allowed.' };
  }

  const hostname = url.hostname.toLowerCase();
  if (isIpLiteral(hostname)) {
    return { ok: false, error: 'IP address URLs are not allowed.' };
  }

  const platform = detectPlatform(trimmed);
  if (!platform) {
    return { ok: false, error: 'Unsupported platform. Only Upwork and Freelancer profile URLs are supported.' };
  }

  if (url.pathname.length <= 1) {
    return { ok: false, error: 'Profile URL must point to a specific profile page.' };
  }

  return { ok: true, url: url.href, platform };
}

/** Check whether an IPv4/IPv6 address falls into a non-routable/reserved block. */
export function isPrivateIp(host: string): boolean {
  const clean = host.split('%')[0]; // strip IPv6 zone id
  if (!clean) return true;
  if (clean.includes(':')) return isPrivateIpv6(clean);
  return isPrivateIpv4(clean);
}

/**
 * Resolve a hostname and confirm it does not resolve to a private/loopback IP.
 * Fail-closed: any resolution error also rejects.
 */
export async function isHostPrivate(hostname: string): Promise<boolean> {
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.some((a) => isPrivateIp(a.address));
  } catch {
    // Cannot verify the host is safe -> treat as unsafe (fail-closed).
    return true;
  }
}

function tryParseHttpUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isIpLiteral(hostname: string): boolean {
  if (hostname.includes(':')) return true; // IPv6 literal
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p));
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('::ffff:7f')) return true;
  if (lower.startsWith('::ffff:127.')) return true;
  const v4mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return isPrivateIpv4(v4mapped[1]);
  return false;
}
