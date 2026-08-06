// src/collectors/RemoteApisCollector.ts
import { BaseCollector } from "./BaseCollector";
import { RawOpportunity } from "./types";

/**
 * Collector that aggregates job opportunities from multiple free public remote job APIs.
 * Sources: Remotive, ArbeitNow, RemoteOK, WeWorkRemotely RSS, Remotebase API.
 * All sources are free with no API key required.
 */
export class RemoteApisCollector extends BaseCollector {
  name = "RemoteApis";

  private devKeywords = [
    "developer", "engineer", "web", "react", "node", "python",
    "full stack", "frontend", "backend", "mobile", "javascript",
    "typescript", "php", "laravel", "wordpress", "flutter"
  ];

  private isDevJob(title: string, description: string = ""): boolean {
    const text = `${title} ${description}`.toLowerCase();
    return this.devKeywords.some(k => text.includes(k));
  }

  private cleanHtml(text: string): string {
    return text
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 2000);
  }

  // Source 1: Remotive - returns dev jobs
  private async fetchRemotive(): Promise<RawOpportunity[]> {
    try {
      const res = await fetch("https://remotive.com/api/remote-jobs?category=software-dev&limit=50", {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data?.jobs) return [];

      return data.jobs.map((job: any): RawOpportunity => ({
        title: job.title || "Untitled",
        description: this.cleanHtml(job.description || ""),
        url: job.url || "",
        budget: job.salary || "Undetermined",
        platform: "Remotive",
        postedAt: job.publication_date ? new Date(job.publication_date) : new Date(),
        company: job.company_name || "Remote Company",
        country: job.candidate_required_location || undefined,
        clientName: job.company_name || undefined,
        status: "OPEN",
      }));
    } catch (e: any) {
      console.warn("[RemoteApisCollector] Remotive failed:", e?.message);
      return [];
    }
  }

  // Source 2: ArbeitNow
  private async fetchArbeitNow(): Promise<RawOpportunity[]> {
    try {
      const res = await fetch("https://www.arbeitnow.com/api/job-board-api", {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data?.data) return [];

      return data.data
        .filter((job: any) => this.isDevJob(job.title, job.description))
        .slice(0, 30)
        .map((job: any): RawOpportunity => ({
          title: job.title || "Untitled",
          description: this.cleanHtml(job.description || ""),
          url: job.url || "",
          budget: job.salary_range || "Undetermined",
          platform: "ArbeitNow",
          postedAt: job.created_at ? new Date(job.created_at * 1000) : new Date(),
          company: job.company_name || "Company",
          country: job.location || undefined,
          clientName: job.company_name || undefined,
          status: "OPEN",
        }));
    } catch (e: any) {
      console.warn("[RemoteApisCollector] ArbeitNow failed:", e?.message);
      return [];
    }
  }

  // Source 3: RemoteOK
  private async fetchRemoteOK(): Promise<RawOpportunity[]> {
    try {
      const res = await fetch("https://remoteok.com/api?tag=dev", {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];

      return data
        .filter((job: any) => job.id && job.position && job.url)
        .slice(0, 30)
        .map((job: any): RawOpportunity => ({
          title: job.position || "Untitled",
          description: this.cleanHtml(job.description || job.tags?.join(", ") || ""),
          url: job.url || `https://remoteok.com/remote-jobs/${job.id}`,
          budget: job.salary ? `$${job.salary_min || ""} - $${job.salary_max || ""}` : "Undetermined",
          platform: "RemoteOK",
          postedAt: job.date ? new Date(job.date) : new Date(),
          company: job.company || "Remote Company",
          country: job.location || undefined,
          clientName: job.company || undefined,
          status: "OPEN",
        }));
    } catch (e: any) {
      console.warn("[RemoteApisCollector] RemoteOK failed:", e?.message);
      return [];
    }
  }

  // Source 4: WeWorkRemotely RSS (via RSS-to-JSON)
  private async fetchWWR(): Promise<RawOpportunity[]> {
    try {
      const res = await fetch(
        "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fweworkremotely.com%2Fcategories%2Fremote-programming-jobs.rss",
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) return [];
      const data = await res.json();
      if (!data?.items) return [];

      return data.items
        .filter((item: any) => item.link && item.title)
        .slice(0, 20)
        .map((item: any): RawOpportunity => ({
          title: item.title || "Untitled",
          description: this.cleanHtml(item.content || item.description || ""),
          url: item.link || "",
          budget: "Undetermined",
          platform: "WeWorkRemotely",
          postedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
          company: item.author || "Remote Company",
          status: "OPEN",
        }));
    } catch (e: any) {
      console.warn("[RemoteApisCollector] WWR RSS failed:", e?.message);
      return [];
    }
  }

  async fetch(): Promise<RawOpportunity[]> {
    console.log("[RemoteApisCollector] Fetching from all public sources...");

    const [remotive, arbeitNow, remoteOK, wwr] = await Promise.allSettled([
      this.fetchRemotive(),
      this.fetchArbeitNow(),
      this.fetchRemoteOK(),
      this.fetchWWR(),
    ]);

    const all: RawOpportunity[] = [];
    for (const result of [remotive, arbeitNow, remoteOK, wwr]) {
      if (result.status === "fulfilled") {
        all.push(...result.value);
      }
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    const unique: RawOpportunity[] = [];
    for (const op of all) {
      if (op.url && !seen.has(op.url)) {
        seen.add(op.url);
        unique.push(op);
      }
    }

    console.log(`[RemoteApisCollector] Total unique jobs: ${unique.length}`);
    return unique;
  }
}
