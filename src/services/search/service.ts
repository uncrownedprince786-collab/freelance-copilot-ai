import { JobPipeline } from '../../providers/JobPipeline';
import { getRawJobs } from '../../lib/jobsCache';
import { shapeJobForUi, type SearchResultJob } from './shape';
import { normalizeQuery, isVagueQuery, buildAlternatives, expandQuery } from './normalize';
import { rankJobs } from './rank';

export interface SearchServiceDeps {
  /** Jobs already in the feed (UI-shaped). Default: getRawJobs + shape. */
  fetchDbJobs?: () => Promise<SearchResultJob[]>;
  /** On-demand provider search (same pipeline as sync). Default: JobPipeline.search. */
  searchPipeline?: (query: string, maxJobs: number, source?: string) => Promise<SearchResultJob[]>;
  /** Reserve one provider search; returns false when quota is exhausted. */
  consumeQuota?: () => boolean;
  readCache?: (normalized: string) => Promise<SearchResultJob[] | null>;
  writeCache?: (normalized: string, results: SearchResultJob[]) => Promise<void>;
  maxJobs?: number;
}

export type SearchResponse =
  | {
      status: 'ok';
      query: string;
      normalized: string;
      cached: boolean;
      freshFetch: boolean;
      quotaExhausted: boolean;
      weak: boolean;
      results: SearchResultJob[];
      alternatives: string[];
      variants: string[];
    }
  | {
      status: 'needs_clarification';
      query: string;
      normalized: string;
      cached: boolean;
      freshFetch: boolean;
      quotaExhausted: boolean;
      weak: boolean;
      results: SearchResultJob[];
      alternatives: string[];
      variants: string[];
    };

const defaultFetchDbJobs = async (): Promise<SearchResultJob[]> =>
  (await getRawJobs()).map((job) => shapeJobForUi(job));

const defaultSearchPipeline = async (query: string, maxJobs: number, source?: string): Promise<SearchResultJob[]> =>
  (await new JobPipeline().search(query, maxJobs, source)).map((job) => shapeJobForUi(job));

const WEAK_THRESHOLD = 55;

/**
 * Execute a smart search through the same pipeline as automatic recommendations:
 *
 *   normalize → variants → check cache → match existing feed (free)
 *   → if weak, check quota → provider fetch → normalize → dedupe → rank
 *
 * Autocomplete never reaches this endpoint; suggestions are served separately.
 */
export async function runSmartSearch(rawQuery: string, deps: SearchServiceDeps = {}, source?: string): Promise<SearchResponse> {
  const maxJobs = deps.maxJobs ?? 20;
  const query = rawQuery.trim();
  const normalized = normalizeQuery(query);

  const base = {
    query,
    normalized,
    cached: false,
    freshFetch: false,
    quotaExhausted: false,
    weak: true,
    results: [] as SearchResultJob[],
    alternatives: [] as string[],
    variants: [] as string[],
  };

  if (!normalized || isVagueQuery(query)) {
    return { ...base, status: 'needs_clarification' as const, alternatives: buildAlternatives(query) };
  }

  const variants = expandQuery(query);
  base.variants = variants;

  // 1. Cache — repeated searches cost nothing.
  if (deps.readCache) {
    try {
      const cached = await deps.readCache(normalized);
      if (cached && cached.length > 0) {
        return { ...base, status: 'ok', cached: true, results: cached, weak: cached.length < 4 };
      }
    } catch {
      // fall through to a fresh search
    }
  }

  // 2. Match against the existing feed first (free, no quota).
  let dbJobs: SearchResultJob[] = [];
  try {
    dbJobs = deps.fetchDbJobs ? await deps.fetchDbJobs() : await defaultFetchDbJobs();
  } catch {
    dbJobs = [];
  }
  const dbResults = rankJobs(dbJobs, normalized.split(' '))
    .filter((j) => (j.score ?? 0) >= 45)
    .slice(0, maxJobs);

  const strongest = dbResults[0]?.score ?? 0;
  const strongEnough =
    dbResults.filter((j) => (j.score ?? 0) >= 60).length >= 3 ||
    strongest >= 70 ||
    (dbResults.length >= 8 && strongest >= 55);

  // 3. If the feed already answers well, stop here (no provider call).
  if (strongEnough) {
    await safeWriteCache(deps, normalized, dbResults);
    return { ...base, status: 'ok', results: dbResults, weak: dbResults.length === 0 || strongest < WEAK_THRESHOLD };
  }

  // 4. Weak feed matches → try a fresh provider fetch, guarded by quota.
  const consume = deps.consumeQuota ?? (() => false);
  if (consume()) {
      let fresh: SearchResultJob[] = [];
    try {
      fresh = deps.searchPipeline
        ? await deps.searchPipeline(normalized, maxJobs, source)
        : await defaultSearchPipeline(normalized, maxJobs, source);
    } catch {
      fresh = [];
    }

    const merged = rankJobs([...dbResults, ...fresh], normalized.split(' ')).slice(0, maxJobs);
    const finalWeak = merged.length === 0 || (merged[0]?.score ?? 0) < WEAK_THRESHOLD;

    await safeWriteCache(deps, normalized, merged);
    return {
      ...base,
      status: 'ok',
      freshFetch: fresh.length > 0,
      results: merged,
      weak: finalWeak,
      alternatives: finalWeak ? buildAlternatives(query) : [],
    };
  }

  // 5. Quota exhausted — still return the best existing matches, clearly flagged.
  const weak = dbResults.length === 0 || strongest < WEAK_THRESHOLD;
  await safeWriteCache(deps, normalized, dbResults);
  return {
    ...base,
    status: 'ok',
    quotaExhausted: true,
    results: dbResults,
    weak,
    alternatives: weak ? buildAlternatives(query) : [],
  };
}

async function safeWriteCache(deps: SearchServiceDeps, normalized: string, results: SearchResultJob[]): Promise<void> {
  if (!deps.writeCache) return;
  try {
    await deps.writeCache(normalized, results);
  } catch {
    // Non-critical.
  }
}
