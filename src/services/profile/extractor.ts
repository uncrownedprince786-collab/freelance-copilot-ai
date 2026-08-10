import {
  validateProfileUrl,
  isHostPrivate,
  type ProfilePlatform,
} from '../../lib/profile/url';
import { getAdapter } from './platforms';
import type { ExtractionFailure, ExtractionResult } from './types';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 2;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface ProfileFetchResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type ProfileFetcher = (input: string, init?: RequestInit) => Promise<ProfileFetchResponse>;

interface FetchDeps {
  fetchFn?: ProfileFetcher;
  /** Overridable DNS safety check (defaults to fail-closed isHostPrivate). */
  checkHostPrivate?: (hostname: string) => Promise<boolean>;
}

interface FetchedHtml {
  ok: true;
  html: string;
}

/**
 * Fetch a public freelance profile and normalize it into ProfileData.
 * Returns a typed failure instead of faking data when the page is blocked,
 * missing, login-required, or JavaScript-rendered.
 */
export async function extractPublicProfile(rawUrl: string, deps: FetchDeps = {}): Promise<ExtractionResult> {
  const validated = validateProfileUrl(rawUrl);
  if (!validated.ok || !validated.url || !validated.platform) {
    const reason = /unsupported|only upwork/i.test(validated.error || '') ? 'unsupported_platform' : 'invalid_url';
    return { ok: false, reason, message: validated.error || 'Invalid profile URL.' };
  }

  const platform = validated.platform;
  const adapter = getAdapter(platform);
  const url = adapter.hintUrlFor(validated.url);

  // SSRF defense-in-depth: reject if the allowlisted host resolves to a private IP.
  const hostname = new URL(url).hostname.toLowerCase();
  const checkHostPrivate = deps.checkHostPrivate ?? isHostPrivate;
  if (await checkHostPrivate(hostname)) {
    return { ok: false, reason: 'blocked', message: 'Profile host could not be verified as safe.' };
  }

  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const fetched = await fetchWithSafeRedirects(fetchFn, url, platform, MAX_REDIRECTS);
  if (!fetched.ok) return fetched;

  const html = fetched.html;
  if (looksBlocked(html)) {
    return { ok: false, reason: 'blocked', message: 'Access to this profile was blocked by Cloudflare/anti-bot protection. Paste your profile content to analyze it instead.' };
  }
  if (looksLoginRequired(html)) {
    return { ok: false, reason: 'login_required', message: 'This profile requires login to view. Paste your profile content to analyze it instead.' };
  }

  const profile = adapter.extract(html, url);
  if (isUsableProfile(profile)) {
    return { ok: true, profile };
  }
  return { ok: false, reason: 'incomplete', message: 'The profile page loaded but no profile data could be extracted (page is likely rendered by JavaScript). Paste your profile content to analyze it instead.' };
}

async function fetchWithSafeRedirects(
  fetchFn: ProfileFetcher,
  url: string,
  platform: ProfilePlatform,
  redirectsLeft: number,
): Promise<FetchedHtml | ExtractionFailure> {
  try {
    const response = await fetchFn(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirectsLeft <= 0) {
        return { ok: false, reason: 'network_error', message: 'Profile URL redirected too many times.' };
      }
      let nextHref: string;
      try {
        nextHref = new URL(location, url).href;
      } catch {
        return { ok: false, reason: 'network_error', message: 'Profile URL contained an unsafe redirect.' };
      }
      // Only follow redirects that stay on an allowed platform domain.
      const next = validateProfileUrl(nextHref);
      if (!next.ok || next.platform !== platform) {
        return { ok: false, reason: 'blocked', message: 'Profile URL redirected to an unsafe host.' };
      }
      return fetchWithSafeRedirects(fetchFn, next.url as string, platform, redirectsLeft - 1);
    }

    if (response.status === 403) {
      // Avoidable 403: some platforms return 403 for legitimate public profiles when
      // the request headers look automated. Retry once with a fuller browser-like
      // header set before declaring the profile blocked. This does NOT bypass
      // Cloudflare/anti-bot challenges or log-in walls — it only retries a single
      // request with more realistic headers.
      let retry: ProfileFetchResponse | null = null;
      try {
        retry = await fetchFn(url, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
            "Referrer-Policy": "no-referrer-when-downgrade",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
      } catch {
        retry = null;
      }
      if (retry && retry.ok) {
        const retryText = await retry.text();
        if (retryText && retryText.trim().length > 0) {
          return { ok: true, html: retryText };
        }
      }
      return { ok: false, reason: 'blocked', message: 'Profile access was denied (HTTP 403). Anti-bot protection may be active. Paste your profile content to analyze it instead.' };
    }
    if (response.status === 404) {
      return { ok: false, reason: 'not_found', message: 'Profile not found (HTTP 404).' };
    }
    if (response.status === 429) {
      return { ok: false, reason: 'rate_limited', message: 'The profile provider rate limited this request (HTTP 429). Try again later.' };
    }
    if (!response.ok) {
      return { ok: false, reason: 'network_error', message: `Profile fetch failed with HTTP ${response.status}.` };
    }

    const text = await response.text();
    if (!text || text.trim().length === 0) {
      return { ok: false, reason: 'incomplete', message: 'Profile page returned empty content.' };
    }
    return { ok: true, html: text };
  } catch (error) {
    if (isTimeoutError(error)) {
      return { ok: false, reason: 'timeout', message: 'Profile fetch timed out.' };
    }
    return { ok: false, reason: 'network_error', message: 'Profile fetch failed due to a network error.' };
  }
}

function looksBlocked(html: string): boolean {
  const markers = [
    'cf-chl-',
    'challenge-platform',
    'cf-browser-verification',
    'just a moment',
    'attention required! | cloudflare',
    'cloudflare ray id',
    'cf-challenge',
  ];
  const lower = html.toLowerCase();
  return markers.some((m) => lower.includes(m));
}

function looksLoginRequired(html: string): boolean {
  const markers = [
    'log in to view',
    'sign in to view',
    'login to view',
    'this page is only visible to logged-in users',
    'please log in to continue',
  ];
  const lower = html.toLowerCase();
  return markers.some((m) => lower.includes(m));
}

function isUsableProfile(profile: { name?: string; title?: string; overview?: string; skills: string[]; portfolioItems?: string[] }): boolean {
  return Boolean(profile.name || profile.title || profile.overview) || profile.skills.length > 0 || (profile.portfolioItems?.length ?? 0) > 0;
}

function isTimeoutError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && ('name' in error) && (error.name === 'TimeoutError' || error.name === 'AbortError'));
}
