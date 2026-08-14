import { Job } from "../types/job";
import { JobProvider } from "./JobProvider";
import { ApifyUpworkProvider } from "./ApifyUpworkProvider";
import { FreelancerProvider } from "./FreelancerProvider";
import { prisma } from "../lib/db";
import { logCronRun } from "../lib/cronLogger";

// Lightweight, separate refresh flow for EXISTING active jobs. It must NOT touch
// the new-job ingestion pipeline — it only re-reads fresh provider data for a
// bounded batch of jobs already in the DB and patches their mutable competition
// signals (proposalCount / interviewingCount / hiresCount).
//
// Design notes:
// - Fetches a WIDER recency window than the new-job sync so listings that aged
//   out of the tight 12-per-query window (but are still within the 7-day active
//   window) get a chance to refresh.
// - The refresh BATCH is driven by the fresh provider results, not by raw id
//   order: candidates are the active jobs that actually appear in the fetched
//   data, ordered by recency. This guarantees the batch overlaps what the
//   provider returned, so a count that was null at first-seen can be backfilled
//   once the provider later reports a real positive value (the production
//   regression where `scanned=30, refreshed=0` was caused by batching the
//   oldest ids while the provider only returns the newest ~240 jobs).
// - Processes a small bounded batch per run (cursor cycles through candidates)
//   so a single run can never balloon.
// - Never creates duplicates and never overwrites a stored value with a missing
//   one: a field is only written when the provider returned a usable value.
const REFRESH_MAX_RESULTS = 40;   // per Upwork query (wider than the sync's 12)
const REFRESH_TOTAL_CAP = 240;    // hard ceiling on Upwork results per refresh run
const REFRESH_BATCH = 30;         // existing jobs patched per run
const REFRESH_TIME_LIMIT_MS = 90_000; // strict execution ceiling
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const CURSOR_KEY = "refresh_cursor";

export interface RefreshResult {
  refreshed: number;
  scanned: number;
  totalActive: number;
  elapsedMs: number;
}

function normUrl(u?: string | null): string {
  if (!u) return "";
  let s = String(u).trim().toLowerCase();
  s = s.split("#")[0].split("?")[0];
  if (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

// The minimal set of stored-job fields the refresher needs to select candidates,
// order them, and merge competition signals.
export interface RefreshCandidate {
  id: string;
  url: string;
  proposalCount: number | null;
  createdAt: Date;
}

// Proposal-count merge for one stored job given the fresh provider value.
// Returns the value to write, or `undefined` when the stored value must be kept
// untouched. The provider's parser never emits an estimate: a numeric 0 is a
// genuine literal zero, range bands ("0 to 5") and "Be the first to apply"
// resolve to null (unknown-exact).
//
//   fresh null            -> no write (unknown must never clobber a known count)
//   fresh > 0             -> confirmed positive, monotonic: write min(fresh, 50)
//                            only when it ADVANCES the stored value, so a stored
//                            positive count can never decrease
//   fresh === 0 (genuine) -> write 0 only when the stored value is null or 0;
//                            a genuine 0 never overwrites a stored positive
export function computeProposalPatch(
  fresh: number | null,
  stored: number | null,
): number | undefined {
  if (fresh === null) return undefined;
  if (fresh > 0) {
    if (stored === null || fresh > stored) return Math.min(fresh, 50);
    return undefined;
  }
  // fresh === 0 (genuine literal zero)
  if (stored === null || stored === 0) return 0;
  return undefined;
}

// Selects the active jobs that the fresh provider data can actually refresh:
// those whose normalized URL appears in the fetched map, ordered most-recent
// first (matching the recency-sorted fetch). A job the provider no longer
// returns is not a candidate and keeps its stored values.
export function selectRefreshCandidates(
  active: RefreshCandidate[],
  byUrl: ReadonlyMap<string, unknown>,
): RefreshCandidate[] {
  return active
    .filter((o) => o.url && byUrl.has(normUrl(o.url)))
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Resolves the cursor (id of the last processed candidate) into the next batch.
// Wraps to the start when the cursor is unknown (e.g. its job was purged) or
// when the previous run reached the end. `reachedEnd` tells the caller the
// cursor should reset on the next run.
export function buildRefreshBatch(
  candidates: RefreshCandidate[],
  afterId: string,
  batchSize: number,
): { startIdx: number; batch: RefreshCandidate[]; reachedEnd: boolean; nextAfterId: string } {
  if (candidates.length === 0) {
    return { startIdx: 0, batch: [], reachedEnd: true, nextAfterId: "" };
  }
  let startIdx = 0;
  if (afterId) {
    const i = candidates.findIndex((o) => o.id === afterId);
    startIdx = i >= 0 ? i + 1 : 0;
    if (startIdx >= candidates.length) startIdx = 0; // wrapped past the end
  }
  const batch = candidates.slice(startIdx, startIdx + batchSize);
  const reachedEnd = startIdx + batchSize >= candidates.length;
  const nextAfterId = reachedEnd || batch.length === 0 ? "" : batch[batch.length - 1].id;
  return { startIdx, batch, reachedEnd, nextAfterId };
}

export class ActiveJobRefresher {
  private providers: JobProvider[] = [
    new ApifyUpworkProvider(),
    new FreelancerProvider(),
  ];

  async refresh(batchSize: number = REFRESH_BATCH): Promise<RefreshResult> {
    const startedAt = Date.now();
    console.log("[ActiveJobRefresher] Starting bounded active-job refresh...");

    // Step 1: Pull fresh provider data (wider window for Upwork so older active
    // listings are included). Freelancer keeps its normal fetch.
    const fetched: Job[] = [];
    for (const p of this.providers) {
      try {
        const jobs =
          p.name === "ApifyUpwork"
            ? await (p as ApifyUpworkProvider).fetchJobs({
                maxResults: REFRESH_MAX_RESULTS,
                totalCap: REFRESH_TOTAL_CAP,
              })
            : await p.fetchJobs();
        fetched.push(...jobs);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ActiveJobRefresher] ${p.name} fetch failed:`, msg);
      }
    }

    const byUrl = new Map<string, Job>();
    for (const j of fetched) {
      const key = normUrl(j.url);
      if (key) byUrl.set(key, j);
    }
    console.log(`[ActiveJobRefresher] Fresh listings fetched: ${fetched.length}, unique urls: ${byUrl.size}`);

    // Step 2: Load active jobs (within the existing 7-day window) for the cursor.
    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);
    const active = await prisma.opportunity.findMany({
      where: { createdAt: { gte: cutoff } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        url: true,
        proposalCount: true,
        interviewingCount: true,
        hiresCount: true,
        platform: true,
        createdAt: true,
      },
    });

    if (active.length === 0) {
      console.log("[ActiveJobRefresher] No active jobs to refresh.");
      await logCronRun({
        status: "SUCCESS",
        jobsFetched: 0,
        newJobsAdded: 0,
        sourceSummary: "refresher: no active jobs within 7-day window",
      }).catch(() => {});
      return { refreshed: 0, scanned: 0, totalActive: 0, elapsedMs: Date.now() - startedAt };
    }

    // Step 3: Refresh candidates = active jobs that the fresh provider data
    // actually returned, newest first. This is the core fix: the provider fetch
    // is recency-sorted and capped, so a batch chosen from raw id order (oldest
    // first) almost never overlaps the fetched set and counts never backfill.
    // By construction the batch can only contain jobs with fresh data.
    const candidates = selectRefreshCandidates(active as RefreshCandidate[], byUrl);

    if (candidates.length === 0) {
      console.log("[ActiveJobRefresher] No active jobs match the fresh provider data.");
      await logCronRun({
        status: fetched.length === 0 ? "WARNING" : "SUCCESS",
        jobsFetched: 0,
        newJobsAdded: 0,
        sourceSummary: `refresher: 0 candidates within fresh fetch window fetched=${fetched.length} totalActive=${active.length}`,
      }).catch(() => {});
      return { refreshed: 0, scanned: 0, totalActive: active.length, elapsedMs: Date.now() - startedAt };
    }

    // Step 4: Resolve the cursor (id of the last candidate processed last run)
    // against the current candidate list and slice the next batch.
    let afterId = "";
    try {
      const cur = await prisma.systemKv.findUnique({ where: { key: CURSOR_KEY } });
      afterId = cur ? (JSON.parse(cur.value).afterId ?? "") : "";
    } catch {
      afterId = "";
    }

    const { startIdx, batch, nextAfterId } = buildRefreshBatch(candidates, afterId, batchSize);

    // Step 5: Patch each candidate in the batch from fresh data (only if the
    // stored value should change).
    let refreshed = 0;
    let completed = true;
    let lastProcessedId = "";
    for (const op of batch) {
      if (Date.now() - startedAt > REFRESH_TIME_LIMIT_MS) {
        console.log("[ActiveJobRefresher] Strict time limit reached; stopping batch.");
        completed = false;
        break;
      }
      const fresh = byUrl.get(normUrl(op.url));
      lastProcessedId = op.id; // considered this run even if no fresh value
      if (!fresh) continue;

      const data: Record<string, unknown> = {};
      // proposalCount: monotonic non-decreasing. Only confirmed positive counts
      // advance the stored value; a genuine literal 0 (provider exact parse,
      // never a range band) backfills a null/0 stored value but never decreases
      // a positive one; null/unknown never overwrites a known count. Cap at 50
      // to match the pipeline's competition convention (Upwork "50+" normalizes
      // to 50, and the sync's hard filter rejects raw counts > 50), so the
      // refresh writer can never diverge from the sync writer. A non-numeric
      // provider value (string) is treated as unknown-exact and never written.
      const freshProposalCount = typeof fresh.proposalCount === "number" ? fresh.proposalCount : null;
      const proposalPatch = computeProposalPatch(freshProposalCount, op.proposalCount);
      if (proposalPatch !== undefined) {
        data.proposalCount = proposalPatch;
      }
      // interviewingCount / hiresCount: only patch positive signals so the
      // provider's `?? 0` default never clobbers a stored real value.
      if (typeof fresh.interviewingCount === "number" && fresh.interviewingCount > 0) {
        data.interviewingCount = fresh.interviewingCount;
      }
      if (typeof fresh.hiresCount === "number" && fresh.hiresCount > 0) {
        data.hiresCount = fresh.hiresCount;
      }

      if (Object.keys(data).length === 0) continue;
      try {
        await prisma.opportunity.update({ where: { url: op.url }, data });
        refreshed++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ActiveJobRefresher] update failed for ${op.url}:`, msg);
      }
    }

    // Step 6: Persist the cursor. If the time limit stopped the batch early, the
    // cursor points at the LAST job actually processed so the unprocessed tail
    // of this batch is not skipped on the next run; otherwise the planned
    // nextAfterId ("" when wrapping) is used.
    const effectiveNextAfterId = completed ? nextAfterId : lastProcessedId || "";
    try {
      await prisma.systemKv.upsert({
        where: { key: CURSOR_KEY },
        update: { value: JSON.stringify({ afterId: effectiveNextAfterId, at: Date.now() }) },
        create: { key: CURSOR_KEY, value: JSON.stringify({ afterId: effectiveNextAfterId, at: Date.now() }) },
      });
    } catch {
      /* non-fatal */
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[ActiveJobRefresher] Done. scanned=${batch.length}, refreshed=${refreshed}, totalActive=${active.length}, candidates=${candidates.length}, cursorStart=${startIdx}, nextAfterId=${effectiveNextAfterId || "(wrap)"}, elapsed=${elapsedMs}ms`,
    );

    // Surface refresh activity in /cron-logs (refresh runs were previously invisible).
    // A fetch that returned no fresh data is a WARNING (possible provider/token issue);
    // otherwise the run succeeded even if this batch had no counts to patch.
    const status = fetched.length === 0 ? "WARNING" : "SUCCESS";
    await logCronRun({
      status,
      jobsFetched: refreshed,
      newJobsAdded: 0,
      sourceSummary: `refresher: scanned=${batch.length} refreshed=${refreshed} totalActive=${active.length} candidates=${candidates.length} fetched=${fetched.length}`,
    }).catch(() => {});

    return { refreshed, scanned: batch.length, totalActive: active.length, elapsedMs };
  }
}
