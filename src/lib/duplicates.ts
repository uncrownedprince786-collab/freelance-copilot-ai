/**
 * Duplicate clustering — deterministic, explainable, and non-destructive.
 *
 * Nothing here deletes, hides or merges a row. It groups rows into clusters,
 * picks one canonical member per cluster, and records WHY. A listing whose
 * duplicate status is uncertain stays visible and stays linked, because an
 * uncertain duplicate decision must never silently remove an opportunity.
 *
 * Measured, over the 1,332 live rows (same-platform pairs only, 661,914
 * comparisons):
 *
 *   exact normalized-title matches            39 pairs
 *   title similarity 0.80-0.99                 5 pairs
 *   title similarity 0.60-0.79                47 pairs
 *   exact contentHash matches                  1 pair
 *
 * The gap between 1 and 39 is the finding. Freelancer reposts carry a marker
 * in the TITLE while the description stays byte-identical:
 *
 *   "Independent B2B Sales Representative — U.S. Market"
 *   "Independent B2B Sales Representative — U.S. Market -- 2"
 *   "Edit Engaging Promotional Video - 29/09/2026 01:13 EDT"
 *   "Edit Engaging Promotional Video - 28/09/2026 14:13 EDT"
 *
 * A content hash over the raw title misses every one of these. Folding the
 * marker into the hash would be the wrong fix: a repost is a real second
 * posting of the opportunity, sometimes with a different budget, and Level 3
 * is supposed to mean "byte-identical content", not "probably the same".
 * So the marker is stripped for BLOCKING and scored as a SIGNAL, and the pair
 * lands in a cluster with a confidence and a reason instead of being merged.
 *
 * The thresholds below are judgement calls, not measurements. They are named
 * constants so they can be argued with, and every decision carries the signal
 * codes that produced it.
 */

/** A row as this module needs to see it. Deliberately narrow so the logic can
 *  be tested without a database. */
export interface DuplicateCandidate {
  id: string;
  platform: string;
  title: string;
  description: string;
  budget: string;
  clientName?: string | null;
  sourceJobId?: string | null;
  contentHash?: string | null;
  /** Source posting time. Null when the source gave none. */
  postedAt?: Date | null;
  /** When this row first entered this database. */
  firstSeenAt?: Date | null;
}

export type DuplicateStatus =
  | 'canonical'
  | 'duplicate'
  | 'possible_duplicate'
  | 'independent'
  | 'unknown';

/** Reason codes. Stored and shown, so a verdict can always be explained. */
export type DuplicateSignal =
  | 'exact_content'
  | 'same_normalized_title'
  | 'title_similar'
  | 'description_identical'
  | 'description_similar'
  | 'same_budget'
  | 'same_client'
  | 'posted_close_together'
  | 'repost_marker';

export type DuplicateWarning =
  | 'different_budget'
  | 'distinct_source_ids'
  | 'posted_far_apart'
  | 'short_text';

// ── Text normalisation ─────────────────────────────────────────────────

/** Freelancer's own repost conventions, observed in the live data. */
const REPOST_NUMBERED = /\s*--\s*\d+\s*$/;
const REPOST_TIMESTAMPED = /\s*[-–—]\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\s*[a-z]{2,4}\s*$/i;

/** Which repost marker (if any) the source put in this title. A signal, never
 *  a reason to fold two rows into one record. */
export function repostMarker(title: string): 'numbered' | 'timestamped' | null {
  if (REPOST_TIMESTAMPED.test(title || '')) return 'timestamped';
  if (REPOST_NUMBERED.test(title || '')) return 'numbered';
  return null;
}

/**
 * The title with source repost markers removed, punctuation flattened and
 * whitespace collapsed. Used for BLOCKING and similarity — never for display,
 * and never as an input to the content hash.
 */
export function blockingTitle(title: string): string {
  return (title || '')
    .normalize('NFKC')
    .replace(REPOST_TIMESTAMPED, '')
    .replace(REPOST_NUMBERED, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words worth comparing. Very short tokens carry no signal and inflate every
 *  similarity score. */
export function contentTokens(text: string): Set<string> {
  return new Set(
    (text || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/<[^>]*>/g, ' ')
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2),
  );
}

/** Jaccard overlap of two token sets. 0 when either is empty — an empty set
 *  must not read as "identical to everything". */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

// ── Pair scoring ───────────────────────────────────────────────────────

/** Thresholds. Judgement calls, deliberately visible and adjustable. */
export const DUPLICATE_THRESHOLDS = {
  /** At or above this, the pair is reported as a duplicate. */
  duplicate: 0.85,
  /** At or above this, reported as a possible duplicate — linked, not merged. */
  possible: 0.6,
  descriptionIdentical: 0.95,
  descriptionSimilar: 0.7,
  titleSimilar: 0.8,
  /** Reposts of one opportunity cluster within days, not months. */
  closeDays: 7,
  farDays: 30,
  /** Below this many description tokens, similarity is noise. */
  minTokens: 8,
} as const;

export interface PairVerdict {
  status: Extract<DuplicateStatus, 'duplicate' | 'possible_duplicate' | 'independent'>;
  /** 0..1. Only an exact content match ever reaches 1. */
  confidence: number;
  signals: DuplicateSignal[];
  warnings: DuplicateWarning[];
}

function daysApart(a: DuplicateCandidate, b: DuplicateCandidate): number | null {
  const x = a.postedAt?.getTime();
  const y = b.postedAt?.getTime();
  if (!x || !y) return null;
  return Math.abs(x - y) / 86_400_000;
}

/**
 * How likely is it that these two rows are the same opportunity?
 *
 * Additive and transparent: every contribution has a signal code, so the sum
 * can always be explained. Confidence is capped below 1 unless the content
 * hashes match exactly — the system should not claim certainty it does not
 * have.
 */
export function classifyPair(a: DuplicateCandidate, b: DuplicateCandidate): PairVerdict {
  const signals: DuplicateSignal[] = [];
  const warnings: DuplicateWarning[] = [];

  // Two listings on different platforms are two listings. Cross-platform
  // matching needs signals this data does not have.
  if (a.platform !== b.platform) {
    return { status: 'independent', confidence: 0, signals, warnings };
  }

  if (a.contentHash && b.contentHash && a.contentHash === b.contentHash) {
    return { status: 'duplicate', confidence: 1, signals: ['exact_content'], warnings };
  }

  const ta = blockingTitle(a.title);
  const tb = blockingTitle(b.title);
  const titleScore = ta && ta === tb ? 1 : jaccard(contentTokens(ta), contentTokens(tb));

  const da = contentTokens(a.description);
  const db = contentTokens(b.description);
  const descScore = jaccard(da, db);
  if (da.size < DUPLICATE_THRESHOLDS.minTokens || db.size < DUPLICATE_THRESHOLDS.minTokens) {
    warnings.push('short_text');
  }

  let score = 0;

  if (descScore >= DUPLICATE_THRESHOLDS.descriptionIdentical) {
    score += 0.55;
    signals.push('description_identical');
  } else if (descScore >= DUPLICATE_THRESHOLDS.descriptionSimilar) {
    score += 0.3;
    signals.push('description_similar');
  }

  if (ta && ta === tb) {
    score += 0.3;
    signals.push('same_normalized_title');
  } else if (titleScore >= DUPLICATE_THRESHOLDS.titleSimilar) {
    score += 0.2;
    signals.push('title_similar');
  } else if (titleScore >= 0.6) {
    score += 0.1;
    signals.push('title_similar');
  }

  if (repostMarker(a.title) || repostMarker(b.title)) {
    score += 0.05;
    signals.push('repost_marker');
  }

  // "Negotiable" and "Undetermined" are what this pipeline stores when the
  // source stated no budget. Two rows both saying so agree on nothing, in
  // exactly the way two rows both named "Freelancer Client" agree on nothing.
  const statedBudget = (v: string) => Boolean(v) && !/^\s*(negotiable|undetermined)\s*$/i.test(v);
  if (statedBudget(a.budget) && a.budget === b.budget) {
    score += 0.1;
    signals.push('same_budget');
  } else if (statedBudget(a.budget) && statedBudget(b.budget)) {
    warnings.push('different_budget');
  }

  const client = (a.clientName || '').trim();
  if (client && client.toLowerCase() === (b.clientName || '').trim().toLowerCase()) {
    // Only when it identifies someone. Freelancer stores the literal string
    // "Freelancer Client" on every row, which identifies nobody.
    if (!/^freelancer client$/i.test(client)) {
      score += 0.1;
      signals.push('same_client');
    }
  }

  const gap = daysApart(a, b);
  if (gap != null && gap <= DUPLICATE_THRESHOLDS.closeDays) {
    score += 0.05;
    signals.push('posted_close_together');
  } else if (gap != null && gap > DUPLICATE_THRESHOLDS.farDays) {
    warnings.push('posted_far_apart');
  }

  // The source itself says these are two different postings. They may still be
  // the same opportunity reposted, which is worth linking — but it is a reason
  // to stay below certainty, not to claim it.
  if (a.sourceJobId && b.sourceJobId && a.sourceJobId !== b.sourceJobId) {
    warnings.push('distinct_source_ids');
  }

  // Nothing but an exact content match reaches 1.
  const confidence = Math.min(0.99, Number(score.toFixed(2)));

  // A pair held together only by its title is never a DUPLICATE. Titles
  // repeat constantly in this market — "Digital Marketing Project" and
  // "Digital marketing" score 0.67 on title and 0.00 on description, and they
  // are two different jobs.
  //
  // But an EXACT normalized title plus one independent agreement (budget,
  // client, or posting window) is worth surfacing as a possible duplicate: the
  // measured "Convert PDF Forms to Excel" pair is the same title, the same
  // budget, a day apart, with the description rewritten — very likely a
  // repost, and the user should see the link even though the text changed.
  // Confidence stays capped at 0.5 either way: without content agreement this
  // is a lead to check, not a finding.
  const hasContentEvidence =
    signals.includes('description_identical') || signals.includes('description_similar');
  if (!hasContentEvidence) {
    const corroborating = signals.filter(
      s => s === 'same_budget' || s === 'same_client' || s === 'posted_close_together',
    ).length;
    const exactTitle = signals.includes('same_normalized_title');
    return {
      status: exactTitle && corroborating >= 1 ? 'possible_duplicate' : 'independent',
      confidence: Math.min(confidence, 0.5),
      signals,
      warnings,
    };
  }

  const status =
    confidence >= DUPLICATE_THRESHOLDS.duplicate
      ? 'duplicate'
      : confidence >= DUPLICATE_THRESHOLDS.possible
        ? 'possible_duplicate'
        : 'independent';

  return { status, confidence, signals, warnings };
}

// ── Clustering ─────────────────────────────────────────────────────────

export interface ClusterMember {
  id: string;
  status: DuplicateStatus;
  confidence: number;
  signals: DuplicateSignal[];
  warnings: DuplicateWarning[];
}

export interface Cluster {
  /** Deterministic: derived from the member ids, so the same input always
   *  produces the same cluster id. */
  clusterId: string;
  canonicalId: string;
  canonicalReason: string;
  members: ClusterMember[];
}

/**
 * Blocking key. Only rows sharing one are ever compared, which turns an
 * all-pairs scan into something a cron job can afford — the full 1,332-row
 * cross product is 661,914 comparisons, and the table only grows.
 *
 * Rows with no usable title get no key and are never compared: a blank title
 * would otherwise block with every other blank title.
 */
export function blockKey(row: DuplicateCandidate): string | null {
  const t = blockingTitle(row.title);
  if (!t) return null;
  return `${row.platform}|${t}`;
}

/** Union-find over candidate pairs. */
class DisjointSet {
  private parent = new Map<string, string>();
  find(x: string): string {
    const p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/** How much of a listing the source actually filled in. Used only to break a
 *  tie between canonical candidates. */
function completeness(row: DuplicateCandidate): number {
  let n = 0;
  if ((row.description || '').trim().length > 50) n++;
  if (row.budget && !/^(negotiable|undetermined)$/i.test(row.budget)) n++;
  if (row.sourceJobId) n++;
  if (row.clientName && !/^freelancer client$/i.test(row.clientName)) n++;
  if (row.postedAt) n++;
  return n;
}

/**
 * Choose the canonical member and say which rule chose it.
 *
 * The rules are tried in order and the FIRST one that separates the
 * candidates decides. The returned reason names that rule, so the UI can
 * explain the choice rather than asserting "this is the original job" — which
 * this system cannot know. Earliest-seen is explicitly not the first rule:
 * different sources discover the same posting at different times, so
 * first-seen order is this database's history, not the job's.
 */
export function selectCanonical(members: DuplicateCandidate[]): { id: string; reason: string } {
  const byId = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const posted = byId.filter(m => m.postedAt);
  if (posted.length > 0) {
    const earliest = posted.reduce((best, m) =>
      m.postedAt!.getTime() < best.postedAt!.getTime() ? m : best,
    );
    const ties = posted.filter(m => m.postedAt!.getTime() === earliest.postedAt!.getTime());
    if (ties.length === 1 && posted.length === byId.length) {
      return {
        id: earliest.id,
        reason: 'earliest source posting time among the cluster members',
      };
    }
  }

  const withId = byId.filter(m => m.sourceJobId);
  if (withId.length === 1) {
    return {
      id: withId[0].id,
      reason: 'the only member carrying a source-native job id',
    };
  }

  const maxComplete = Math.max(...byId.map(completeness));
  const complete = byId.filter(m => completeness(m) === maxComplete);
  if (complete.length === 1) {
    return { id: complete[0].id, reason: 'most complete source data among the cluster members' };
  }

  const seen = complete.filter(m => m.firstSeenAt);
  if (seen.length > 0) {
    const earliestSeen = seen.reduce((best, m) =>
      m.firstSeenAt!.getTime() < best.firstSeenAt!.getTime() ? m : best,
    );
    const ties = seen.filter(m => m.firstSeenAt!.getTime() === earliestSeen.firstSeenAt!.getTime());
    if (ties.length === 1) {
      return {
        id: earliestSeen.id,
        reason: 'first seen by this system — no source posting time separated the members',
      };
    }
  }

  return {
    id: complete[0].id,
    reason: 'stable id order — no signal separated the members',
  };
}

/**
 * Group rows into duplicate clusters.
 *
 * Only pairs sharing a blocking key are compared, and only pairs that reach
 * the `possible` threshold join a cluster. A row that matches nothing is not
 * returned: it is `independent`, and the caller writes that without needing a
 * cluster for it.
 */
export function buildClusters(rows: DuplicateCandidate[]): Cluster[] {
  const blocks = new Map<string, DuplicateCandidate[]>();
  for (const row of rows) {
    const key = blockKey(row);
    if (!key) continue;
    const bucket = blocks.get(key);
    if (bucket) bucket.push(row);
    else blocks.set(key, [row]);
  }

  const ds = new DisjointSet();
  const verdicts = new Map<string, PairVerdict>();
  const linked = new Set<string>();

  for (const unordered of blocks.values()) {
    if (unordered.length < 2) continue;
    // Sorted so the pass does not depend on the order rows arrived in. Ties on
    // confidence are resolved by "first comparison wins", which is only
    // deterministic if the comparison order is.
    const bucket = [...unordered].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i];
        const b = bucket[j];
        const verdict = classifyPair(a, b);
        if (verdict.status === 'independent') continue;
        ds.union(a.id, b.id);
        linked.add(a.id);
        linked.add(b.id);
        // Keep the strongest verdict seen for each row, so a member's recorded
        // confidence reflects its best evidence rather than its last comparison.
        for (const id of [a.id, b.id]) {
          const prev = verdicts.get(id);
          if (!prev || verdict.confidence > prev.confidence) verdicts.set(id, verdict);
        }
      }
    }
  }

  const groups = new Map<string, DuplicateCandidate[]>();
  const byId = new Map(rows.map(r => [r.id, r]));
  for (const id of linked) {
    const root = ds.find(id);
    const group = groups.get(root);
    const row = byId.get(id);
    if (!row) continue;
    if (group) group.push(row);
    else groups.set(root, [row]);
  }

  const clusters: Cluster[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ids = group.map(g => g.id).sort();
    const { id: canonicalId, reason } = selectCanonical(group);
    clusters.push({
      // Deterministic and readable. Re-running on unchanged data produces the
      // same cluster id, so the pass is idempotent.
      clusterId: `c_${ids[0]}`,
      canonicalId,
      canonicalReason: reason,
      // Sorted by id: the member list is part of the output, so it has to be
      // stable across runs and independent of input order.
      members: [...group].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)).map(m => {
        const v = verdicts.get(m.id);
        return {
          id: m.id,
          status: m.id === canonicalId ? ('canonical' as const) : (v?.status ?? 'possible_duplicate'),
          confidence: v?.confidence ?? 0,
          signals: v?.signals ?? [],
          warnings: v?.warnings ?? [],
        };
      }),
    });
  }

  return clusters.sort((a, b) => (a.clusterId < b.clusterId ? -1 : 1));
}
