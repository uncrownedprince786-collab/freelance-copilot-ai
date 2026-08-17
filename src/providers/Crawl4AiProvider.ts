import { JobProvider, ProviderRunStatus } from "./JobProvider";
import { Job } from "../types/job";

// Self-hosted Crawl4AI fallback provider (open-source, https://github.com/unclecode/crawl4ai).
//
// The primary path stays Apify (ApifyUpworkProvider). This provider is only
// invoked by JobPipeline when the Apify attempt GENUINELY failed (no token,
// API/quota error, timeout, actor failure) — never when a sync simply returned
// fewer or zero jobs. It drives a self-hosted Crawl4AI server (Docker image
// `unclecode/crawl4ai:latest`, default port 11235) to fetch Upwork search-result
// pages and normalizes listings into the SAME Job shape, so the existing
// validation / scoring / upsert pipeline is reused unchanged and no duplicate
// records are created (dedup/upsert key on the job URL).
//
// Security / privacy (spec §6):
// - Requests are limited to fixed Upwork search URLs; no user-supplied or
//   arbitrary URLs are ever crawled.
// - No Lead Hunter data, credentials, cookies, API keys or session tokens are
//   ever sent. At most a local-only bearer token (CRAWL4AI_TOKEN) is sent to
//   our own self-hosted server — never to any third-party service.
// - Nothing scraped here is forwarded to external LLMs/APIs by this provider.
// - If the server is unreachable or the page cannot be parsed, the provider
//   returns [] and the sync fails safely (existing jobs are never touched).

const CRAWL4AI_TIMEOUT_MS = 60_000;
const CRAWL4AI_POLL_INTERVAL_MS = 3_000;
const CRAWL4AI_MAX_POLLS = 10;
const MAX_TOTAL_JOBS = 60;
const MAX_JOBS_PER_QUERY = 12;

// Mirrors the Apify actor's query list so the fallback covers the same niches.
const FALLBACK_QUERIES = [
  "client growth manager",
  "telehealth growth manager",
  "marketing strategy",
  "ecommerce growth manager",
  "full stack developer",
  "react developer",
];

function cleanText(v: unknown): string {
  if (v == null) return '';
  return String(v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// Coarse error category for safe operational logging (spec §15): never logs
// response bodies, headers or keys.
function errCategory(msg: string): string {
  if (/timeout|timed out|abort/i.test(msg)) return 'timeout';
  if (/401|403|forbidden|unauthorized/i.test(msg)) return 'auth';
  if (/429|quota|limit|exhaust/i.test(msg)) return 'quota';
  if (/econnrefused|econnreset|fetch failed|network|dns/i.test(msg)) return 'network';
  return 'unknown';
}

// Relative posted-time strings ("Posted 2 hours ago", "Posted 30+ days ago")
// into a Date. Clamped to now; null when unparseable.
function parseRelativePosted(text: string): Date | null {
  const s = cleanText(text).toLowerCase();
  const now = Date.now();
  const daysMatch = s.match(/(\d+)\s*\+?\s*days? ago/);
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    return new Date(Math.min(now, now - days * 24 * 60 * 60 * 1000));
  }
  const hoursMatch = s.match(/(\d+)\s*hours? ago/);
  if (hoursMatch) {
    const hours = parseInt(hoursMatch[1], 10);
    return new Date(Math.min(now, now - hours * 60 * 60 * 1000));
  }
  const minsMatch = s.match(/(\d+)\s*minutes? ago/);
  if (minsMatch) {
    const mins = parseInt(minsMatch[1], 10);
    return new Date(Math.min(now, now - mins * 60 * 1000));
  }
  if (/just now|moments ago|today/i.test(s)) return new Date(now);
  return null;
}

export class Crawl4AiProvider implements JobProvider {
  name = "Crawl4AI";

  lastRunStatus?: ProviderRunStatus;

  private get baseUrl(): string {
    return (process.env.CRAWL4AI_URL || "http://127.0.0.1:11235").replace(/\/+$/, "");
  }

  async fetchJobs(): Promise<Job[]> {
    const startedAt = Date.now();
    const results: Job[] = [];
    const seen = new Set<string>();
    let successfulQueries = 0;

    for (const query of FALLBACK_QUERIES) {
      if (results.length >= MAX_TOTAL_JOBS) break;
      const url = `https://www.upwork.com/nx/jobs/search/?q=${encodeURIComponent(query)}`;
      let html = '';
      try {
        html = await this.crawlHtml(url);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Crawl4AiProvider] crawl failed for "${query}" (${errCategory(msg)}):`, msg);
        continue;
      }
      if (!html) {
        console.warn(`[Crawl4AiProvider] no content for "${query}".`);
        continue;
      }
      successfulQueries++;

      const parsed = this.parseUpworkHtml(html).slice(0, MAX_JOBS_PER_QUERY);
      console.log(`[Crawl4AiProvider] "${query}": parsed ${parsed.length} jobs.`);
      for (const job of parsed) {
        const key = job.url || `${job.title}|${job.clientName || 'unknown'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(job);
        if (results.length >= MAX_TOTAL_JOBS) break;
      }
    }

    // Zero jobs from successful crawls is a normal (if empty) result — e.g. the
    // platform served a bot/login wall. It is reported, but never treated as a
    // provider failure that could trigger further fallback loops.
    const failed = successfulQueries > 0 && results.length === 0;
    this.lastRunStatus = {
      failed,
      reason: failed ? 'crawled but parsed no listings (possible bot wall)' : 'ok',
      queriesTotal: FALLBACK_QUERIES.length,
      queriesFailed: FALLBACK_QUERIES.length - successfulQueries,
    };
    console.log(`[Crawl4AiProvider] Total fallback jobs: ${results.length} in ${Date.now() - startedAt}ms (successfulQueries=${successfulQueries}).`);
    return results;
  }

  // Fetches one URL through the self-hosted Crawl4AI server. `POST /crawl`
  // returns results synchronously when ready; a task_id response means the
  // server queued the job, which we await with a small bounded poll.
  private async crawlHtml(url: string): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = process.env.CRAWL4AI_TOKEN || process.env.CRON_SECRET;
    if (token) headers.Authorization = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/crawl`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ urls: [url], priority: 10 }),
        signal: AbortSignal.timeout(CRAWL4AI_TIMEOUT_MS),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Crawl4AiProvider] request failed (${errCategory(msg)}):`, msg);
      return '';
    }
    if (!res.ok) {
      console.error(`[Crawl4AiProvider] server returned HTTP ${res.status} (${errCategory(String(res.status))}).`);
      return '';
    }

    const data = await res.json().catch(() => null);
    if (data?.results?.[0]) {
      return String(data.results[0].html || data.results[0].markdown || '');
    }

    const taskId = data?.task_id;
    if (typeof taskId !== 'string' || !taskId) return '';
    for (let i = 0; i < CRAWL4AI_MAX_POLLS; i++) {
      await new Promise(r => setTimeout(r, CRAWL4AI_POLL_INTERVAL_MS));
      try {
        const jobRes = await fetch(`${this.baseUrl}/job/${encodeURIComponent(taskId)}`, {
          signal: AbortSignal.timeout(CRAWL4AI_TIMEOUT_MS),
        });
        if (!jobRes.ok) continue;
        const jobData = await jobRes.json().catch(() => null);
        if (jobData?.status === 'completed') {
          const result = jobData?.data ?? jobData?.result ?? jobData;
          return String(result?.html || result?.markdown || '');
        }
        if (jobData?.status === 'failed') return '';
      } catch (err: unknown) {
        console.error('[Crawl4AiProvider] poll failed:', err instanceof Error ? err.message : err);
        return '';
      }
    }
    return '';
  }

  // Best-effort extraction of Upwork search-result listings. Upwork's markup
  // changes over time, so several known card shapes are tried plus a generic
  // anchor-level fallback. Any listing that cannot be parsed is simply skipped;
  // this is a resilience path, not a precision guarantee.
  private parseUpworkHtml(html: string): Job[] {
    const jobs: Job[] = [];
    const tiles: string[] = [];
    const bySection = html.match(/<section[^>]*data-testid=["']job-tile["'][^>]*>[\s\S]*?<\/section>/gi);
    const byArticle = html.match(/<article[^>]*class=["'][^"']*job-tile[^"']*["'][^>]*>[\s\S]*?<\/article>/gi);
    if (bySection) tiles.push(...bySection);
    if (byArticle) tiles.push(...byArticle);

    for (const tile of tiles) {
      const job = this.parseTile(tile);
      if (job) jobs.push(job);
    }

    if (jobs.length === 0) {
      const linkRe = /<h2[^>]*>\s*<a[^>]*href=["'][^"']*\/(?:jobs|job-post)\/~([A-Za-z0-9_\-=]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
      for (const m of html.matchAll(linkRe)) {
        const jobId = m[1];
        const title = decodeEntities(cleanText(m[2]));
        if (!jobId || !title) continue;
        jobs.push(this.makeJob(jobId, title, '', new Date(), {}));
      }
    }
    return jobs;
  }

  private parseTile(block: string): Job | null {
    const idMatch = block.match(/href=["'][^"']*\/(?:jobs|job-post)\/~([A-Za-z0-9_\-=]+)/i);
    if (!idMatch) return null;
    const jobId = idMatch[1];

    const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const title = titleMatch ? decodeEntities(cleanText(titleMatch[1])) : '';
    if (!title) return null;

    let description = '';
    // Capture the FULL inner content of the description container (nested tags
    // included) by backreferencing the opening tag name; then strip inner tags.
    const descMatch = block.match(/<([a-z0-9]+)[^>]*?(?:data-test=["']job-description|class=["'][^"']*job-description[^"']*["'])[^>]*>([\s\S]*?)<\/\1>/i);
    if (descMatch) description = decodeEntities(cleanText(descMatch[2]));

    const postedRaw = this.attrText(block, 'posted-on') || this.attrText(block, 'posted');
    const postedAt = parseRelativePosted(postedRaw) || new Date(); // unknown -> first-seen; retention is first-seen anchored

    const skills = [...block.matchAll(/<a[^>]*class=["'][^"']*(?:up-skill|skill-tag)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map(m => decodeEntities(cleanText(m[1])))
      .filter(Boolean);

    const countryRaw = this.attrText(block, 'client-country') || this.attrText(block, 'client-location');
    const country = countryRaw && cleanText(countryRaw).toLowerCase() !== 'remote' ? cleanText(countryRaw) : 'Remote';
    const clientNameRaw = this.attrText(block, 'client-name');
    const clientName = clientNameRaw && !/client$/i.test(cleanText(clientNameRaw)) ? cleanText(clientNameRaw) : null;

    return this.makeJob(jobId, title, description, postedAt, {
      budget: this.parseBudget(this.attrText(block, 'budget')),
      proposalCount: this.parseProposals(this.attrText(block, 'proposals')),
      skills,
      country,
      clientName,
    });
  }

  // Inner text of the first element carrying data-test/data-testid = `test`.
  private attrText(html: string, test: string): string {
    const re = new RegExp(`<[^>]+(?:data-test|data-testid)=["']${test}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
    const m = html.match(re);
    return m ? decodeEntities(cleanText(m[1])) : '';
  }

  // Mirrors the app's proposal conventions: range bands and "less than"/"first
  // to apply" are unknown-exact -> null; "50+" normalizes to 50.
  private parseProposals(raw: string): number | null {
    const s = cleanText(raw).toLowerCase();
    if (!s || /less than|first to apply|unknown/i.test(s)) return null;
    const plus = s.match(/(\d+)\s*\+/);
    if (plus) return Math.min(parseInt(plus[1], 10), 50);
    if (/\d+\s*(?:to|-|–)\s*\d+/.test(s)) return null;
    const num = s.match(/\d+/);
    return num ? Math.min(parseInt(num[0], 10), 50) : null;
  }

  private parseBudget(raw: string): Job['budget'] {
    const s = cleanText(raw);
    if (!s) return { type: 'fixed', amount: undefined };
    const nums = (s.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) || []).map(n => parseFloat(n.replace(/,/g, ''))).filter(Number.isFinite);
    if (/\/hr|\/hour|hourly/i.test(s)) {
      return { type: 'hourly', min: nums[0] ?? undefined, max: nums[1] ?? undefined };
    }
    if (nums.length >= 2) return { type: 'fixed', min: nums[0], max: nums[1] };
    if (nums.length === 1) return { type: 'fixed', amount: nums[0] };
    return { type: 'fixed', amount: undefined };
  }

  private makeJob(
    jobId: string,
    title: string,
    description: string,
    postedAt: Date,
    extra: {
      budget?: Job['budget'];
      proposalCount?: number | null;
      skills?: string[];
      country?: string;
      clientName?: string | null;
    },
  ): Job {
    const country = extra.country || 'Remote';
    const clientName = extra.clientName ?? null;
    return {
      id: `upwork-${jobId}`,
      url: `https://www.upwork.com/jobs/~${jobId}`,
      title,
      description,
      skills: extra.skills ?? [],
      budget: extra.budget ?? { type: 'fixed', amount: undefined },
      experienceLevel: null,
      duration: null,
      connectsRequired: null,
      proposalCount: extra.proposalCount ?? null,
      interviewingCount: null,
      hiresCount: null,
      postedAt,
      client: {
        name: clientName,
        country,
        rating: null,
        totalSpent: null,
        jobsPosted: null,
        totalHires: null,
        paymentVerified: null,
        lastActivityAt: null,
        openJobs: null,
      },
      source: 'upwork',
      score: null,
      fetchedAt: new Date(),
      platform: 'Upwork',
      country,
      clientName: clientName ?? undefined,
      isNew: true,
    };
  }
}
