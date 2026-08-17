import { JobProvider, ProviderRunStatus } from "./JobProvider";
import { Job } from "../types/job";
import { getJson } from "serpapi";

const SERPAPI_TIMEOUT_MS = 30_000;
const MAX_JOBS = 40;

const QUERIES = [
  "site:upwork.com react developer",
  "site:upwork.com full stack developer",
  "site:upwork.com nodejs developer",
  "site:upwork.com typescript developer",
  "site:upwork.com python developer",
  "site:upwork.com mobile app developer",
  "site:upwork.com laravel php developer",
  "site:upwork.com shopify developer",
];

export class SerpApiUpworkProvider implements JobProvider {
  name = "SerpApi";
  lastRunStatus?: ProviderRunStatus;

  async fetchJobs(): Promise<Job[]> {
    if (!process.env.SERPAPI_KEY) {
      this.lastRunStatus = { failed: true, reason: "no SERPAPI_KEY set", queriesTotal: 0, queriesFailed: QUERIES.length };
      return [];
    }

    const startedAt = Date.now();
    const results: Job[] = [];
    const seen = new Set<string>();
    let successfulQueries = 0;

    for (const query of QUERIES) {
      if (results.length >= MAX_JOBS) break;

      try {
        const response = await getJson({
          api_key: process.env.SERPAPI_KEY,
          engine: "google_jobs",
          q: query,
          hl: "en",
          gl: "us",
        });

        successfulQueries++;

        const jobs = response?.jobs_results ?? [];
        for (const g of jobs) {
          const link: string = g.link || g.url || g.apply_options?.[0]?.link || "";
          if (!link.includes("upwork.com")) continue;

          const idMatch = link.match(/~([A-Za-z0-9_\-=]+)/);
          if (!idMatch) continue;
          const jobId = idMatch[1];

          if (seen.has(jobId)) continue;
          seen.add(jobId);

          const posted = g.detected_extensions?.posted_at ?? "";
          const postedAt = this.parseRelativePosted(posted);

          results.push(this.makeJob(jobId, g, postedAt));
          if (results.length >= MAX_JOBS) break;
        }

        await new Promise((r) => setTimeout(r, 1500));
      } catch (err: unknown) {
        console.error(`[SerpApiUpworkProvider] query "${query}" failed:`, err instanceof Error ? err.message : err);
      }
    }

    const failed = successfulQueries === 0 && QUERIES.length > 0;
    this.lastRunStatus = {
      failed,
      reason: failed ? "all SerpApi queries failed" : "ok",
      queriesTotal: QUERIES.length,
      queriesFailed: QUERIES.length - successfulQueries,
    };

    console.log(`[SerpApiUpworkProvider] Total: ${results.length} jobs in ${Date.now() - startedAt}ms (successfulQueries=${successfulQueries}).`);
    return results;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private makeJob(jobId: string, g: any, postedAt: Date): Job {
    const title = (g.title || "").replace(/\s*[–\-]\s*Upwork\s*$/i, "").trim() || "Untitled";
    const description = g.description || title;

    const detected = g.detected_extensions || {};
    let proposalCount: number | null = null;
    if (detected?.proposals) {
      const m = String(detected.proposals).match(/(\d+)/);
      if (m) proposalCount = Math.min(parseInt(m[1], 10), 50);
    }

    return {
      id: `upwork-${jobId}`,
      url: `https://www.upwork.com/jobs/~${jobId}`,
      title,
      description,
      skills: (g.related_links || []).map((l: { text?: string }) => l.text || "").filter(Boolean),
      budget: this.parseBudget(description),
      experienceLevel: null,
      duration: null,
      connectsRequired: null,
      proposalCount,
      interviewingCount: null,
      hiresCount: null,
      postedAt,
      client: {
        name: g.company_name && g.company_name !== "Upwork" ? g.company_name : null,
        country: g.location || "Remote",
        rating: null,
        totalSpent: null,
        jobsPosted: null,
        totalHires: null,
        paymentVerified: null,
        lastActivityAt: null,
        openJobs: null,
      },
      source: "upwork",
      score: null,
      fetchedAt: new Date(),
      platform: "Upwork",
      country: g.location || "Remote",
      clientName: g.company_name && g.company_name !== "Upwork" ? g.company_name : undefined,
      isNew: true,
    };
  }

  private parseRelativePosted(text: string): Date {
    const s = text.toLowerCase().trim();
    const now = Date.now();
    const days = s.match(/(\d+)\s*\+?\s*days? ago/);
    if (days) return new Date(now - parseInt(days[1], 10) * 86400000);
    const hours = s.match(/(\d+)\s*hours? ago/);
    if (hours) return new Date(now - parseInt(hours[1], 10) * 3600000);
    if (/just now|today/i.test(s)) return new Date(now);
    return new Date(now);
  }

  private parseBudget(text: string): Job["budget"] {
    const nums = (text.match(/\$\d[\d,]*(?:\.\d+)?/g) || []).map((n) =>
      parseFloat(n.replace(/[$,]/g, ""))
    ).filter(Number.isFinite);
    if (/\/hr|\/hour|hourly/i.test(text)) {
      return { type: "hourly", min: nums[0] ?? undefined, max: nums[1] ?? undefined };
    }
    if (nums.length >= 2) return { type: "fixed", min: nums[0], max: nums[1] };
    if (nums.length === 1) return { type: "fixed", amount: nums[0] };
    return { type: "fixed", amount: undefined };
  }
}
