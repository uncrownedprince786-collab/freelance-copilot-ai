/**
 * Per-source health, yield and backoff.
 *
 * The pipeline already records "did this source fail" in SystemKv under
 * `provider:<name>`. That answers whether a source is up. It does not answer
 * the question that actually decides where scraping effort should go:
 *
 *   how many USEFUL LEADS does this source return per unit of cost?
 *
 * Measured over the 1,332 live rows, that question has a very lopsided
 * answer:
 *
 *   Upwork       198 rows,  131 useful leads (66.2%), avg score 64.1,  0 dupes
 *   Freelancer  1,134 rows,  115 useful leads (10.1%), avg score 42.8, 28 dupes
 *
 * Upwork returns more useful leads than Freelancer from one sixth of the
 * volume — and Upwork is the only source that costs Apify budget. Counting
 * records fetched, which is what the cron log does today, makes Freelancer
 * look like the productive one. Counting useful leads reverses it.
 *
 * Everything here is derived from data the system already stores. Nothing is
 * estimated, and a metric that cannot be computed is returned as null rather
 * than as a zero — "no observations yet" and "observed to be zero" are
 * different statements and the admin surface has to be able to tell them
 * apart.
 */

/** Health is a statement about recent behaviour, not a permanent label. */
export type SourceHealthState = 'healthy' | 'degraded' | 'failing' | 'unknown';

export interface SourceRunOutcome {
  /** Did the run complete without the source erroring? */
  ok: boolean;
  /** Why it failed, verbatim from the provider. */
  reason?: string | null;
  /** Records the source returned this run. */
  records: number;
  /** Wall-clock duration of the source's fetch. */
  durationMs?: number | null;
  /** Billed units consumed (Apify query-runs). Free sources report 0. */
  billedUnits?: number;
  at?: Date;
}

export interface SourceHealthRecord {
  source: string;
  state: SourceHealthState;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  consecutiveFailures: number;
  /** Rolling totals since this record was first written. */
  runs: number;
  successes: number;
  records: number;
  billedUnits: number;
  /** Simple mean of observed run durations, or null before any observation. */
  averageDurationMs: number | null;
  /** Earliest time this source should be attempted again. */
  nextEligibleAt: string | null;
}

export function emptyHealth(source: string): SourceHealthRecord {
  return {
    source,
    state: 'unknown',
    lastRunAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
    consecutiveFailures: 0,
    runs: 0,
    successes: 0,
    records: 0,
    billedUnits: 0,
    averageDurationMs: null,
    nextEligibleAt: null,
  };
}

/** Backoff bounds. Exported so they can be argued with rather than hunted for. */
export const BACKOFF = {
  baseMs: 5 * 60_000,
  maxMs: 6 * 60 * 60_000,
  /** Failures tolerated before a source is called `failing`. */
  failingAfter: 3,
} as const;

/**
 * How long to wait before retrying a source that has failed `n` times in a
 * row. Exponential, capped, and zero while the source is healthy.
 *
 * The cap matters as much as the growth: an uncapped backoff silently retires
 * a source after a bad afternoon, and nothing in the system would say so.
 */
export function backoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  const grown = BACKOFF.baseMs * Math.pow(2, Math.min(consecutiveFailures, 10) - 1);
  return Math.min(BACKOFF.maxMs, grown);
}

export function healthState(consecutiveFailures: number, runs: number): SourceHealthState {
  if (runs === 0) return 'unknown';
  if (consecutiveFailures === 0) return 'healthy';
  if (consecutiveFailures >= BACKOFF.failingAfter) return 'failing';
  return 'degraded';
}

/**
 * Fold one run's outcome into a source's health record.
 *
 * Pure: takes the previous record and returns the next one, so the merge
 * rules are testable without a database and a concurrent write cannot
 * produce a half-updated record in memory.
 */
export function applyRun(
  previous: SourceHealthRecord,
  outcome: SourceRunOutcome,
): SourceHealthRecord {
  const at = (outcome.at ?? new Date()).toISOString();
  const runs = previous.runs + 1;
  const consecutiveFailures = outcome.ok ? 0 : previous.consecutiveFailures + 1;

  const observedDuration =
    typeof outcome.durationMs === 'number' && Number.isFinite(outcome.durationMs) && outcome.durationMs >= 0
      ? outcome.durationMs
      : null;
  // Running mean over observed durations only. A run that did not time
  // itself must not be folded in as a zero.
  const averageDurationMs =
    observedDuration == null
      ? previous.averageDurationMs
      : previous.averageDurationMs == null
        ? observedDuration
        : Math.round((previous.averageDurationMs * previous.runs + observedDuration) / runs);

  const wait = backoffMs(consecutiveFailures);

  return {
    source: previous.source,
    state: healthState(consecutiveFailures, runs),
    lastRunAt: at,
    lastSuccessAt: outcome.ok ? at : previous.lastSuccessAt,
    lastFailureAt: outcome.ok ? previous.lastFailureAt : at,
    lastFailureReason: outcome.ok ? null : (outcome.reason ?? 'unspecified failure'),
    consecutiveFailures,
    runs,
    successes: previous.successes + (outcome.ok ? 1 : 0),
    records: previous.records + Math.max(0, Math.floor(outcome.records || 0)),
    billedUnits: previous.billedUnits + Math.max(0, Math.floor(outcome.billedUnits || 0)),
    averageDurationMs,
    nextEligibleAt:
      wait > 0 ? new Date((outcome.at ?? new Date()).getTime() + wait).toISOString() : null,
  };
}

/** May this source be attempted now? */
export function isEligible(record: SourceHealthRecord, now: Date = new Date()): boolean {
  if (!record.nextEligibleAt) return true;
  const t = Date.parse(record.nextEligibleAt);
  return !Number.isFinite(t) || t <= now.getTime();
}

// ── Yield ──────────────────────────────────────────────────────────────

export interface SourceYield {
  source: string;
  rows: number;
  usefulLeads: number;
  /** Share of this source's stored rows that are a high or promising lead. */
  usefulRate: number;
  averageLeadScore: number | null;
  duplicates: number;
  suspicious: number;
}

export interface SourceCost {
  source: string;
  billedUnits: number;
  records: number;
  usefulLeads: number;
  /** Billed units per useful lead. Null when nothing was billed (a free
   *  source) or when no useful lead has been seen yet — both are real
   *  states, and neither is "zero cost". */
  costPerUsefulLead: number | null;
  /** Useful leads per 100 records returned. The number that says where
   *  effort belongs, independent of how cheap the records were. */
  usefulPer100Records: number | null;
}

/**
 * Combine stored yield with rolling cost telemetry.
 *
 * Kept separate from the database so the arithmetic — especially the
 * division-by-zero cases, which are the ones that lie — is testable.
 */
export function costOf(y: SourceYield, health: SourceHealthRecord): SourceCost {
  return {
    source: y.source,
    billedUnits: health.billedUnits,
    records: health.records,
    usefulLeads: y.usefulLeads,
    costPerUsefulLead:
      health.billedUnits > 0 && y.usefulLeads > 0
        ? Number((health.billedUnits / y.usefulLeads).toFixed(3))
        : null,
    usefulPer100Records:
      health.records > 0 ? Number(((y.usefulLeads / health.records) * 100).toFixed(2)) : null,
  };
}

/** Rank sources by the metric that should drive scheduling: useful leads per
 *  record returned. Sources with no observations sort last rather than
 *  first — an unmeasured source is not a proven one. */
export function rankByYield(costs: SourceCost[]): SourceCost[] {
  return [...costs].sort((a, b) => {
    const av = a.usefulPer100Records ?? -1;
    const bv = b.usefulPer100Records ?? -1;
    if (av !== bv) return bv - av;
    return a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
  });
}

export const SOURCE_HEALTH_KEY_PREFIX = 'source:health:';

export function sourceHealthKey(source: string): string {
  return `${SOURCE_HEALTH_KEY_PREFIX}${source.trim().toLowerCase()}`;
}

/** Parse a stored record, falling back to an empty one rather than throwing.
 *  Telemetry must never be able to break ingestion. */
export function parseHealth(source: string, raw: string | null | undefined): SourceHealthRecord {
  if (!raw) return emptyHealth(source);
  try {
    const parsed = JSON.parse(raw) as Partial<SourceHealthRecord>;
    return { ...emptyHealth(source), ...parsed, source };
  } catch {
    return emptyHealth(source);
  }
}
