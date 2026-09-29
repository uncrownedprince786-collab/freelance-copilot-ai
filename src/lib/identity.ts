import { createHash } from 'node:crypto';
import { isSafeExternalUrl } from './safeUrl';

/**
 * Job identity: the three deterministic keys every ingested listing gets.
 *
 * The pipeline used to have exactly one notion of identity — the listing URL,
 * used as the upsert key. That is duplicate detection Level 2 only, and the
 * production table shows what it misses. Measured on 1,332 live rows:
 *
 *   - 985 of 1,134 Freelancer rows (87%) carry NO numeric project id in their
 *     URL. `FreelancerCollector` builds the URL as
 *     `/projects/${project.seo_url || project.id}`, and `seo_url` is sometimes
 *     the bare slug and sometimes the slug with the project id appended. The
 *     same project therefore reaches the database under two different URLs and
 *     is stored twice.
 *   - Three title collisions exist, and they are three DIFFERENT cases:
 *       "CEO Interview Presentation Creation" — byte-identical 836-char
 *         descriptions under a slug URL and a slug+id URL. One project.
 *       "Convert PDF Forms to Excel" — same title, same budget, rewritten
 *         description (934 vs 1,250 chars). Probably a repost.
 *       "Lead-Generating Social Media Campaign" — same title, two distinct
 *         project ids, different budgets and descriptions. Two real projects.
 *     Title similarity alone would merge all three. Only the first is an
 *     exact-content match, which is why the content hash is a separate key
 *     from any similarity judgement, and why nothing here merges anything.
 *   - 198 of 198 Upwork rows carry the source ciphertext in the URL, so Upwork
 *     source identity is fully recoverable.
 *   - 0 of 1,332 stored URLs currently contain a query string or fragment, so
 *     the tracking-parameter stripping below is a guard for incoming data, not
 *     a transformation of anything already stored.
 *
 * Everything here is a pure function of its input: same listing in, same keys
 * out, no clock, no database, no network, no model. That is what makes
 * ingestion idempotent, and what lets the migration defer the backfill to a
 * script instead of keeping a second copy of this logic in SQL.
 */

/** Canonical short name for a platform, for keying. */
export function platformKey(platform: string | null | undefined): string {
  return (platform || '').trim().toLowerCase();
}

// Parameters that never identify a listing — only where the click came from.
// Anything not listed here is KEPT: an unrecognised query parameter may be the
// only thing distinguishing two jobs, and dropping it would silently merge
// them.
const TRACKING_PARAMS = new Set([
  'gclid', 'fbclid', 'msclkid', 'dclid', 'yclid', 'twclid',
  'mc_cid', 'mc_eid', 'igshid', 'ref', 'referrer', 'referral',
  '_ga', '_gl', 'trk', 'trkid', 'src', 'source', 'campaign',
]);
const TRACKING_PREFIXES = ['utm_'];

function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase();
  return TRACKING_PARAMS.has(n) || TRACKING_PREFIXES.some(p => n.startsWith(p));
}

/**
 * A stable comparison key for a listing URL.
 *
 * This is NOT a link. The original `url` stays on the row untouched and is
 * what the UI opens, because a user following a source link must land on the
 * source's own page and not on something this system rewrote. `canonicalUrl`
 * exists only so two spellings of the same address compare equal.
 *
 * Returns null for anything that is not a well-formed absolute http(s) URL —
 * the same check that guards storage, so an unsafe URL cannot acquire an
 * identity here either.
 */
export function canonicalizeUrl(raw: unknown): string | null {
  if (!isSafeExternalUrl(raw)) return null;
  let u: URL;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }

  // http and https serve the same listing; normalise so they compare equal.
  const host = u.hostname.toLowerCase().replace(/^www\./, '');

  // Path case is lowercased for the two platforms whose slugs are known to be
  // case-insensitive, and left verbatim everywhere else. On a case-sensitive
  // host /A and /a can be different pages, and collapsing them would be a
  // silent merge of two real jobs.
  const knownHost = /(^|\.)(upwork|freelancer)\.com$/.test(host);
  let path = u.pathname.replace(/\/+$/, '');
  if (knownHost) path = path.toLowerCase();

  const params = [...u.searchParams.entries()]
    .filter(([k]) => !isTrackingParam(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.length
    ? '?' + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';

  // The fragment is dropped: it addresses a position within a page, never a
  // different listing.
  return `https://${host}${path}${query}`;
}

/**
 * The source's own id for a listing, recovered from its URL.
 *
 * This is the fallback path. An adapter that has the id in its payload should
 * hand it to `deriveIdentity` directly — `FreelancerCollector` already holds
 * `project.id` and merely does not carry it through yet. URL parsing is what
 * makes backfilling existing rows possible, and it is the safety net for a
 * source that only ever gives a link.
 *
 * Returns null rather than a guess. A null source id is honest, and Postgres
 * treats nulls as distinct in the unique (platform, sourceJobId) index, so the
 * 985 Freelancer rows with no recoverable id coexist instead of colliding into
 * one row.
 */
export function extractSourceJobIdFromUrl(platform: string, url: unknown): string | null {
  if (!isSafeExternalUrl(url)) return null;
  let path: string;
  try {
    path = new URL(String(url).trim()).pathname;
  } catch {
    return null;
  }

  switch (platformKey(platform)) {
    case 'upwork': {
      // Upwork addresses a job by a ciphertext: /jobs/~021234... and also
      // /jobs/Some-Title_~021234.... The `~` is the delimiter, not part of the
      // id, so it is not kept.
      const m = path.match(/~(0[0-9a-z]+)/i);
      return m ? m[1].toLowerCase() : null;
    }
    case 'freelancer': {
      // /projects/<category>/<Slug>-40730729 — the trailing run of digits is
      // the project id. Six digits minimum, so a slug that merely ends in a
      // number ("...-top-10") is not mistaken for one.
      const m = path.match(/-(\d{6,})(?:\/|$)/);
      return m ? m[1] : null;
    }
    default:
      return null;
  }
}

/** Collapse markup, entities and whitespace so formatting differences alone do
 *  not change the fingerprint. */
function normalizeText(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s
    .normalize('NFKC')
    .replace(/<[^>]*>/g, ' ')   // the same listing via RSS and via API can
    .replace(/&nbsp;/gi, ' ')   // differ only by markup
    .replace(/&amp;/gi, '&')
    .replace(/[ ​-‍﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Below this much normalized content, a hash says nothing useful. */
const MIN_FINGERPRINT_CHARS = 24;

/**
 * Exact-content fingerprint — duplicate detection Level 3.
 *
 * Two listings with the same hash have the same platform and byte-identical
 * normalized title and description. That is evidence of the same posting; it
 * is NOT on its own an instruction to merge, because the measured pairs show
 * identical content can still carry a different budget.
 *
 * Returns null when there is too little content to fingerprint. Hashing a
 * blank title and a blank description would give every malformed row the same
 * hash and mark them all exact duplicates of one another — a fabricated
 * finding, which is worse than no finding.
 */
export function contentHash(
  platform: string,
  title: unknown,
  description: unknown,
): string | null {
  const t = normalizeText(title);
  const d = normalizeText(description);
  if (t.length + d.length < MIN_FINGERPRINT_CHARS) return null;
  return createHash('sha256')
    .update(`${platformKey(platform)}\n${t}\n${d}`)
    .digest('hex');
}

export interface JobIdentity {
  /** The source's own id, or null when the source did not give one. */
  sourceJobId: string | null;
  /** Comparison key for the listing URL. Never shown, never linked. */
  canonicalUrl: string | null;
  /** Exact-content fingerprint, or null when there is too little content. */
  contentHash: string | null;
}

export interface IdentityInput {
  platform: string;
  url: unknown;
  title?: unknown;
  description?: unknown;
  /** The id straight from the source payload. Always preferred when present:
   *  it is a source fact, where a URL-parsed id is a derived one. */
  sourceJobId?: unknown;
}

/** All three identity keys for one listing. Pure, so it is safe to re-run on
 *  the same row forever — which is what makes ingestion and the backfill
 *  idempotent. */
export function deriveIdentity(input: IdentityInput): JobIdentity {
  const provided =
    typeof input.sourceJobId === 'string' || typeof input.sourceJobId === 'number'
      ? String(input.sourceJobId).trim()
      : '';
  return {
    sourceJobId: provided || extractSourceJobIdFromUrl(input.platform, input.url),
    canonicalUrl: canonicalizeUrl(input.url),
    contentHash: contentHash(input.platform, input.title, input.description),
  };
}
