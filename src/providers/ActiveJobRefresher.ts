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
// - Processes a small bounded batch per run (cursor cycles through all active
//   jobs) so a single run can never balloon.
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

    // Step 3: Resolve the cursor (id of the last job processed last run).
    let startIdx = 0;
    try {
      const cur = await prisma.systemKv.findUnique({ where: { key: CURSOR_KEY } });
      const afterId = cur ? (JSON.parse(cur.value).afterId ?? "") : "";
      if (afterId) {
        const i = active.findIndex((o) => o.id === afterId);
        startIdx = i >= 0 ? i + 1 : 0;
        if (startIdx >= active.length) startIdx = 0; // wrapped past the end
      }
    } catch {
      startIdx = 0;
    }

    const batch = active.slice(startIdx, startIdx + batchSize);
    // Next cursor: if we reached the end of the list, wrap to the beginning.
    const reachedEnd = startIdx + batchSize >= active.length;
    const nextAfterId = reachedEnd || batch.length === 0 ? "" : batch[batch.length - 1].id;

    // Step 4: Patch each job in the batch from fresh data (only if present).
    let refreshed = 0;
    for (const op of batch) {
      if (Date.now() - startedAt > REFRESH_TIME_LIMIT_MS) {
        console.log("[ActiveJobRefresher] Strict time limit reached; stopping batch.");
        break;
      }
      const fresh = byUrl.get(normUrl(op.url));
      if (!fresh) continue; // source missing for this job -> preserve stored values

      const data: Record<string, unknown> = {};
      // proposalCount: a real number (incl. genuine 0) is usable; null means the
      // provider had no count, so we keep the stored value. Cap at 50 to match
      // the pipeline's competition convention (Upwork "50+" normalizes to 50,
      // and the sync's hard filter rejects raw counts > 50), so the refresh
      // writer can never diverge from the sync writer for the same listing.
      if (typeof fresh.proposalCount === "number") {
        data.proposalCount = Math.min(fresh.proposalCount, 50);
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

    // Step 5: Persist the cursor.
    try {
      await prisma.systemKv.upsert({
        where: { key: CURSOR_KEY },
        update: { value: JSON.stringify({ afterId: nextAfterId, at: Date.now() }) },
        create: { key: CURSOR_KEY, value: JSON.stringify({ afterId: nextAfterId, at: Date.now() }) },
      });
    } catch {
      /* non-fatal */
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[ActiveJobRefresher] Done. scanned=${batch.length}, refreshed=${refreshed}, totalActive=${active.length}, cursorStart=${startIdx}, nextAfterId=${nextAfterId || "(wrap)"}, elapsed=${elapsedMs}ms`,
    );

    // Surface refresh activity in /cron-logs (refresh runs were previously invisible).
    // A fetch that returned no fresh data is a WARNING (possible provider/token issue);
    // otherwise the run succeeded even if this batch had no counts to patch.
    const status = fetched.length === 0 ? "WARNING" : "SUCCESS";
    await logCronRun({
      status,
      jobsFetched: refreshed,
      newJobsAdded: 0,
      sourceSummary: `refresher: scanned=${batch.length} refreshed=${refreshed} totalActive=${active.length} fetched=${fetched.length}`,
    }).catch(() => {});

    return { refreshed, scanned: batch.length, totalActive: active.length, elapsedMs };
  }
}
