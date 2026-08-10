import type { JobProvider } from "./JobProvider";
import type { Job } from "../types/job";
import { getJson } from "serpapi";

const FRESHNESS_DAYS = 15;
const MAX_RESULTS = 12;

export interface SerpApiListingsConfig {
  name: string;
  engine: string;
  platform: string;
  source: "indeed" | "linkedin" | "google";
}

function parseSerpDate(raw: unknown): Date | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.toLowerCase().trim();
  const now = new Date();
  if (!s || s === "today" || s === "just now" || s === "now" || s.includes("hour")) return now;
  let m = s.match(/(\d+)\s*week/);
  if (m) return new Date(now.getTime() - Number(m[1]) * 7 * 86400000);
  m = s.match(/(\d+)\s*day/);
  if (m) return new Date(now.getTime() - Number(m[1]) * 86400000);
  m = s.match(/(\d+)\s*month/);
  if (m) {
    // Months are ambiguous and almost always older than the freshness window.
    return null;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed;
  return null;
}

export function cleanText(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function toNumberSafe(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(String(value).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

function extractField(item: Record<string, unknown>, fields: string[]): unknown {
  for (const f of fields) {
    const v = item[f];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

export abstract class SerpApiListingsProvider implements JobProvider {
  abstract readonly name: string;
  abstract readonly platform: string;
  abstract readonly source: "indeed" | "linkedin" | "google";

  protected abstract readonly engine: string;

  fetchJobs(searchQuery?: string): Promise<Job[]> {
    if (!process.env.SERPAPI_KEY) {
      return Promise.resolve([]);
    }
    const q = (searchQuery && searchQuery.trim()) || "developer";
    return this.runFetch(q);
  }

  protected async runFetch(query: string): Promise<Job[]> {
    let response: Record<string, unknown> | null = null;
    try {
      response = (await getJson({
        api_key: process.env.SERPAPI_KEY as string,
        engine: this.engine,
        q: query,
        hl: "en",
        gl: "us",
        num: MAX_RESULTS,
      })) as Record<string, unknown>;
    } catch (err) {
      console.warn(`[${this.name}] serpapi request failed: ${err instanceof Error ? err.message : "unknown"}`);
      return [];
    }

    const list = extractField(response, ["jobs_results", "jobs"]) as unknown[] | undefined;
    if (!Array.isArray(list) || list.length === 0) return [];

    const seen = new Set<string>();
    const out: Job[] = [];
    const now = Date.now();
    const cutoffMs = FRESHNESS_DAYS * 24 * 60 * 60 * 1000;

    for (const item of list) {
      const job = this.mapRaw(item as Record<string, unknown>);
      if (!job) continue;

      let ageOk = false;
      if (job.postedAt instanceof Date && !isNaN(job.postedAt.getTime())) {
        ageOk = now - job.postedAt.getTime() <= cutoffMs && job.postedAt.getTime() <= now + 60_000;
      }
      if (!ageOk) continue;

      const key = job.url || job.id || "";
      if (!key || seen.has(key)) continue;
      seen.add(key);

      out.push(job);
      if (out.length >= MAX_RESULTS) break;
    }

    console.log(`[${this.name}] Fresh jobs kept: ${out.length}`);
    return out;
  }

  protected abstract mapRaw(item: Record<string, unknown>): Job | null;
}

export { parseSerpDate, cleanText as cleanTextShared };
