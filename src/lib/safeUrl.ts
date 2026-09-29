// Scraped URLs are untrusted input.
//
// A listing URL comes from a third-party scraper payload and is stored
// verbatim. The job detail page opens it with `window.open(job.url, ...)`,
// which is an imperative call — React's JSX URL sanitisation does not apply
// there — so a stored `javascript:` or `data:` URL would execute in a window
// that inherits the opener's origin. The HTML-scrape path is the softest
// entry: it only requires an href to contain "upwork.com", which
// `javascript:/*upwork.com/jobs/~*/alert(1)` satisfies.
//
// Validate on write (so nothing bad is stored) and again on use.

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** True when `url` is a well-formed absolute http(s) URL. */
export function isSafeExternalUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url.trim()).protocol);
  } catch {
    return false;
  }
}

/** The URL when it is safe to navigate to, otherwise null. */
export function safeExternalUrl(url: unknown): string | null {
  return isSafeExternalUrl(url) ? (url as string).trim() : null;
}
