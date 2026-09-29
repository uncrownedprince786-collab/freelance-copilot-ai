import { deriveIdentity, IdentityInput, JobIdentity } from './identity';

/**
 * The ingestion side of job identity: given an incoming listing, decide which
 * existing row (if any) it IS, and what to write on it.
 *
 * `identity.ts` stays pure. This module is the thin layer that talks to the
 * database, kept separate so the key derivation can be tested without one.
 *
 * Why this exists: both write paths — `JobPipeline.saveStore` and
 * `collectors/run.ts` — upsert on `where: { url }`. The URL is the weakest of
 * the three identity keys and the one the sources are least consistent about.
 * Freelancer emits the same project under `/projects/<slug>` and
 * `/projects/<slug>-<id>`, so a URL-keyed upsert stores it twice. Matching on
 * the source's own id first fixes that at the point of ingestion, which is the
 * only place it can be fixed without deleting rows later.
 */

/** Which key identified the existing row. Recorded so the decision is
 *  explainable rather than a silent merge. */
export type IdentityMatch = 'sourceJobId' | 'url' | 'canonicalUrl' | null;

export interface ResolvedIdentity {
  identity: JobIdentity;
  /** The row this listing already is, or null when it is genuinely new. */
  existingId: string | null;
  matchedBy: IdentityMatch;
}

/** The subset of the Prisma client this module needs. Narrowed to a structural
 *  type so the resolution logic can be tested against a stub. */
export interface IdentityLookup {
  opportunity: {
    findMany(args: {
      where: { OR: Array<Record<string, unknown>> };
      select: { id: true; platform: true; sourceJobId: true; url: true; canonicalUrl: true };
      take: number;
    }): Promise<Array<{
      id: string;
      platform: string;
      sourceJobId: string | null;
      url: string;
      canonicalUrl: string | null;
    }>>;
  };
}

/**
 * Find the row this listing already is.
 *
 * One query, not three. Neon Free bills compute time, and ingestion runs this
 * for every record of every run — three sequential round trips per listing
 * would be the single most expensive thing the pipeline does. The OR covers
 * all available keys and the priority is applied in memory.
 *
 * Priority is strongest-evidence-first:
 *   1. (platform, sourceJobId) — the source's own identity.
 *   2. url                     — exact match, what ingestion did before.
 *   3. canonicalUrl            — the same address spelled differently.
 *
 * contentHash is deliberately NOT a match key. Identical content is evidence
 * of a duplicate, not proof of one: the measured identical-content pair in
 * production carries two different budgets and two posting times a day apart,
 * so it may well be a repost — a real second opportunity. Merging on content
 * would silently destroy it. The hash is stored, and the clustering layer
 * links such rows at a stated confidence instead.
 */
export async function resolveIdentity(
  db: IdentityLookup,
  input: IdentityInput,
): Promise<ResolvedIdentity> {
  const identity = deriveIdentity(input);
  const url = typeof input.url === 'string' ? input.url.trim() : '';

  const or: Array<Record<string, unknown>> = [];
  if (identity.sourceJobId) {
    or.push({ platform: input.platform, sourceJobId: identity.sourceJobId });
  }
  if (url) or.push({ url });
  if (identity.canonicalUrl) or.push({ canonicalUrl: identity.canonicalUrl });

  if (or.length === 0) return { identity, existingId: null, matchedBy: null };

  // `take` is bounded: more than a handful of matches means the table already
  // holds duplicates of this listing, which is the clustering layer's problem,
  // not something to resolve by scanning here.
  const rows = await db.opportunity.findMany({
    where: { OR: or },
    select: { id: true, platform: true, sourceJobId: true, url: true, canonicalUrl: true },
    take: 5,
  });
  if (rows.length === 0) return { identity, existingId: null, matchedBy: null };

  if (identity.sourceJobId) {
    const bySourceId = rows.find(
      r => r.sourceJobId === identity.sourceJobId && r.platform === input.platform,
    );
    if (bySourceId) return { identity, existingId: bySourceId.id, matchedBy: 'sourceJobId' };
  }
  const byUrl = url ? rows.find(r => r.url === url) : undefined;
  if (byUrl) return { identity, existingId: byUrl.id, matchedBy: 'url' };

  const byCanonical = identity.canonicalUrl
    ? rows.find(r => r.canonicalUrl === identity.canonicalUrl)
    : undefined;
  if (byCanonical) return { identity, existingId: byCanonical.id, matchedBy: 'canonicalUrl' };

  return { identity, existingId: null, matchedBy: null };
}

/**
 * The source's posting time, clamped so it can never be in the future.
 *
 * A future `postedAt` would pin a listing to the top of a freshness-ordered
 * feed permanently and exempt it from age-based purging — the same reason the
 * migration clamps it during backfill. Returns null when the source gave
 * nothing usable, so the caller can fall back to a first-seen time and label
 * it honestly rather than presenting an invented posting time as a source
 * fact.
 */
export function sourcePostedAt(value: unknown, now: Date = new Date()): Date | null {
  if (value == null) return null;

  let ms: number;
  if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === 'number' || /^\d+$/.test(String(value).trim())) {
    // Epoch, in seconds or milliseconds. Sources emit both — Freelancer's
    // `submitdate` is seconds — and `new Date("1759000000")` does not parse as
    // either, so a bare epoch has to be handled before the string path.
    // Anything under 1e11 read as milliseconds would land in 1973 or earlier,
    // which no live listing is.
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    ms = n < 1e11 ? n * 1000 : n;
  } else {
    ms = new Date(String(value)).getTime();
  }

  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms > now.getTime() ? now : new Date(ms);
}

/**
 * Identity + time columns to write on every ingest, create or update.
 *
 * A key this fetch could not derive is OMITTED, never written as null. These
 * fields go into the update path too, and a later, poorer fetch of the same
 * listing — a slug-only URL where an earlier one carried the project id —
 * would otherwise erase an id that was already established. Losing it would
 * also release the unique-index slot that stops the listing being stored
 * twice. On a create, omitted and null are the same thing.
 *
 * `lastSeenAt` advances on every sighting. `firstSeenAt` is create-only and
 * is passed separately by the caller, because an update must never move it.
 */
export function identityFields(
  identity: JobIdentity,
  postedAt: Date | null,
  seenAt: Date,
): Record<string, unknown> {
  return {
    ...(identity.sourceJobId ? { sourceJobId: identity.sourceJobId } : {}),
    ...(identity.canonicalUrl ? { canonicalUrl: identity.canonicalUrl } : {}),
    ...(identity.contentHash ? { contentHash: identity.contentHash } : {}),
    ...(postedAt ? { postedAt } : {}),
    lastSeenAt: seenAt,
  };
}
