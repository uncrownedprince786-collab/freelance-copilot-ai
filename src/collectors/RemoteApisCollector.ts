// src/collectors/RemoteApisCollector.ts
import { BaseCollector } from "./BaseCollector";
import { RawOpportunity } from "./types";
import { GenericFeedCollector } from "./GenericFeedCollector";

/**
 * Collector that aggregates job opportunities from several public remote job APIs.
 * Sources: Remotive, ArbeitNow, RemoteOK.
 * Returns a curated list of RawOpportunity objects.
 */
export class RemoteApisCollector extends BaseCollector {
  name = "RemoteApis";

  private sources: string[] = [
    "https://remotive.com/api/remote-jobs",
    "https://www.arbeitnow.com/api/job-board-api",
    "https://remoteok.com/api",
  ];

  private async fetchFromSource(url: string): Promise<RawOpportunity[]> {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[RemoteApisCollector] Failed to fetch ${url}: ${res.status}`);
        return [];
      }
      const data = await res.json();
      // Different APIs have slightly different shapes; normalize them.
      if (Array.isArray(data)) {
        // RemoteOK returns an array with a first metadata element; skip if not a job.
        return data
          .filter((job: any) => job.title && job.url)
          .map((job: any) => this.mapJob(job));
      }
      if (data.jobs && Array.isArray(data.jobs)) {
        // Remotive payload
        return data.jobs.map((job: any) => this.mapJob(job));
      }
      if (data.data && Array.isArray(data.data)) {
        // ArbeitNow payload
        return data.data.map((job: any) => this.mapJob(job));
      }
      return [];
    } catch (e: any) {
      console.warn(`[RemoteApisCollector] Exception fetching ${url}: ${e?.message || e}`);
      return [];
    }
  }

  private mapJob(job: any): RawOpportunity {
    const title = job.title || job.name || "Untitled Remote Job";
    const description = job.description || job.content || "";
    const url = job.url || job.candidate_url || job.link || "";
    const budget = job.salary || job.budget || "Undetermined";
    const postedAt = job.publication_date || job.date || job.created_at || new Date();
    return {
      title,
      description: typeof description === "string" ? description : JSON.stringify(description),
      url,
      budget: typeof budget === "string" ? budget : budget?.toString() ?? "Undetermined",
      platform: this.name,
      postedAt: new Date(postedAt),
    } as RawOpportunity;
  }

  async fetch(): Promise<RawOpportunity[]> {
    const results: RawOpportunity[] = [];
    for (const src of this.sources) {
      const ops = await this.retry(() => this.fetchFromSource(src));
      results.push(...ops);
    }
    // Deduplicate within this collector (URL + title)
    const seen = new Set<string>();
    const unique: RawOpportunity[] = [];
    for (const op of results) {
      const key = `${op.url}||${op.title?.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(op);
      }
    }
    // If still empty, fallback to generic feed to ensure we never return zero.
    if (unique.length === 0) {
      console.warn(`[RemoteApisCollector] No jobs fetched; falling back to GenericFeed.`);
      const generic = new GenericFeedCollector();
      const genericOps = await generic.fetch();
      return genericOps.map((op) => ({ ...op, platform: this.name }));
    }
    return unique;
  }
}
