import { JobProvider } from "./JobProvider";
import { Job } from "../types/job";

// Upwork reports competition as an exact number, a ceiling band ("50+"), range
// bands ("0 to 5", "5 to 10", "20 to 50"), or phrases like "Be the first to
// apply". Range bands carry no exact value: coercing them to their numeric floor
// is an estimate, and "0 to 5" would become a false literal 0. For PROPOSAL
// counts they therefore resolve to null (unknown-exact), so a false/estimated
// value is never stored, displayed, or allowed to overwrite a stored positive
// count. "50+" resolves to 50 (a confirmed high-competition signal); a pure
// numeric value, including a literal 0, is treated as exact.
function parseUpworkProposalCount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Upwork's ceiling band "50+" is a confirmed high-competition signal -> 50.
  const plus = s.match(/^(\d+)\s*\+\s*$/);
  if (plus) return parseInt(plus[1], 10);
  // Range bands (e.g. "0 to 5", "5 to 10", "20 to 50") are unknown-exact: never
  // coerce to a floor (especially not 0) and never let them override a precise
  // count in a later candidate field.
  if (/\d+\s*(?:to|-|–|—)\s*\d+/i.test(s)) return null;
  // A pure numeric value is exact (a literal 0 means zero proposals).
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  // Anything else (e.g. "Be the first to apply") carries no exact count.
  return null;
}

// For interview/hires competition signals keep the numeric floor of a band
// ("5 to 10" -> 5) so their existing display is unchanged; range-aware parsing
// applies only to proposal counts, where a false 0 must never be stored.
function parseUpworkCount(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/\d+/);
  if (!m) return null;
  return parseInt(m[0], 10);
}

// Upwork's Apify scraper names the competition fields inconsistently across
// actor versions, so try every known candidate and take the first usable value.
// The parser decides whether a value is precise ("50+" -> 50, literal counts)
// or unknown (range bands / "Be the first to apply" -> null).
function firstCount(parse: (v: unknown) => number | null, ...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = parse(v);
    if (n !== null) return n;
  }
  return null;
}

// Upwork's top competition band is "50+". Normalize that band to 50 (its floor)
// so a genuinely busy listing is kept and refreshed instead of being coerced to 0.
// Exact counts below 50 pass through untouched; a true 0 is preserved.
function normalizeProposalCount(v: number | null): number | null {
  if (v === null) return null;
  return v >= 50 ? 50 : v;
}

export class ApifyUpworkProvider implements JobProvider {
  name = "ApifyUpwork";

  // Two authorized Apify accounts are available (APIFY_TOKEN + APIFY_TOKEN2).
  // The query workload is split deterministically between them — no per-run
  // rotation. With both tokens present, the query list is partitioned into
  // contiguous slices and each slice is ALWAYS served by the same account, so
  // free-tier usage is spread evenly and one account is never exhausted while
  // the other sits idle. With a single token configured, every query uses it.
  //
  // SMART FAILOVER (per run): when the assigned account fails with a
  // usage-limit / auth / quota error (e.g. free tier exceeded), that query is
  // retried once on the other account, and the failing account is remembered as
  // unavailable for the REST of this run so subsequent queries skip it instead
  // of wasting calls on an exhausted account. The switch works in both
  // directions (whichever account errors out is bypassed). A query is never run
  // on both accounts for a single fetch. The memory is per-instance (per
  // sync/refresh request), so the next run re-tries both accounts normally.
  private tokens: string[] = [process.env.APIFY_TOKEN, process.env.APIFY_TOKEN2]
    .filter((t): t is string => Boolean(t && t.trim()));

  private unavailableTokens = new Set<string>();

  // `opts` is only used by the Active Job Refresh flow, which fetches a wider
  // recency window to catch older-but-still-active listings. The new-job sync
  // calls fetchJobs() with no args, so its behavior is unchanged (12 / 60).
  async fetchJobs(opts?: { maxResults?: number; totalCap?: number }): Promise<Job[]> {
    if (this.tokens.length === 0) {
      console.warn('[ApifyUpworkProvider] APIFY_TOKEN / APIFY_TOKEN2 are missing in environment.');
      return [];
    }

    const queries = [
      "client growth manager",
      "telehealth growth manager",
      "marketing strategy",
      "ecommerce growth manager",
      "full stack developer",
      "react developer",
    ];

    const results: Job[] = [];
    const seen = new Set<string>();

    const maxResults = opts?.maxResults ?? 12;
    const totalCap = opts?.totalCap ?? 60;
    // One contiguous slice per account: 2 tokens -> each serves half the query
    // list (deterministic); 1 token -> one slice serves everything.
    const slice = Math.max(1, Math.ceil(queries.length / this.tokens.length));

    for (let qi = 0; qi < queries.length; qi++) {
      if (results.length >= totalCap) break;
      const query = queries[qi];

      const primaryIdx = Math.min(Math.floor(qi / slice), this.tokens.length - 1);
      const tokenOrder =
        this.tokens.length === 1
          ? [this.tokens[0]]
          : [this.tokens[primaryIdx], this.tokens[primaryIdx === 0 ? 1 : 0]];

      let rawItems: any[] | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
      for (const token of tokenOrder) {
        // Skip an account already confirmed unavailable (usage limit / auth /
        // quota) earlier in this run; with no alternative (single token) keep
        // trying so a transient failure still gets a chance.
        if (this.tokens.length > 1 && this.unavailableTokens.has(token)) continue;

        const res = await this.runQuery(query, token, maxResults);
        if (res.exhausted) {
          this.unavailableTokens.add(token);
          console.warn(`[ApifyUpworkProvider] Account ...${token.slice(-4)} unavailable for the rest of this run; switching accounts.`);
        }
        if (res.items !== null) {
          rawItems = res.items;
          break;
        }
      }
      if (rawItems === null || rawItems.length === 0) continue;

      for (const item of rawItems) {
        if (!item.title || !item.url) continue;

        const normalizedUrl = String(item.url || item.portalUrl || '').trim();
        const dedupeKey = normalizedUrl || `${item.title}|${item.clientName || item.contactName || 'unknown'}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const rawPostedMs = item.publishTime ? new Date(item.publishTime).getTime() : (item.createTime ? new Date(item.createTime).getTime() : NaN);
        // Never persist a posting time in the future (e.g. provider clock
        // skew): a future timestamp would pin the record at the top of the
        // feed and exempt it from age-based purging. Fall back to first-seen.
        const postedDate = Number.isFinite(rawPostedMs) && rawPostedMs > 0 ? new Date(Math.min(rawPostedMs, Date.now())) : new Date();
        const country = this.cleanText(item.clientCountry || item.country || item.location || 'Remote');
        const rawContactName = item.contactName || item.clientName || item.companyName || null;
        const clientName = rawContactName && !/client$/i.test(String(rawContactName).trim()) ? String(rawContactName).trim() : null;
        const spentVal = item.clientTotalSpent ? `$${Number(item.clientTotalSpent).toLocaleString()}` : '';
        const description = this.cleanText(item.descriptionMarkdown || item.description || item.summary || item.jobDescription || '');

        let connects = item.connectsRequired ?? null;
        if (connects == null && item.budgetAmount) {
          connects = item.budgetAmount >= 1000 ? 16 : (item.budgetAmount >= 500 ? 12 : 8);
        } else if (connects == null && item.jobType === 'HOURLY') {
          connects = 12;
        }

        const job: Job = {
          id: item.jobId || item.contentHash || normalizedUrl,
          url: normalizedUrl,
          title: this.cleanText(item.title),
          description,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          skills: Array.isArray(item.skills) ? item.skills.map((skill: any) => this.cleanText(String(skill))).filter(Boolean) : [],
          budget: {
            type: item.jobType === 'HOURLY' || item.hourlyBudgetMin ? 'hourly' : 'fixed',
            amount: item.budgetAmount ?? undefined,
            min: item.hourlyBudgetMin ?? item.salaryMin ?? undefined,
            max: item.hourlyBudgetMax ?? item.salaryMax ?? undefined,
          },
          experienceLevel: this.cleanText(item.experienceLevel || item.experience || '') || null,
          duration: this.cleanText(item.engagementDuration || item.duration || '') || null,
          connectsRequired: connects,
          proposalCount: normalizeProposalCount(firstCount(
            parseUpworkProposalCount,
            item.totalApplicants,
            item.applicants,
            item.applicantCount,
            item.proposalCount,
            item.proposals,
            item.numberOfProposals,
            item.bidCount,
            item.bids,
          )),
          interviewingCount: firstCount(parseUpworkCount, item.interviewing, item.interviewingCount, item.interviews) ?? 0,
          hiresCount: firstCount(parseUpworkCount, item.hires, item.totalHired, item.hiresCount, item.hired) ?? 0,
          postedAt: postedDate,
          client: {
            name: clientName,
            country: country === 'Remote' ? 'Remote' : country || 'Remote',
            rating: typeof item.clientRating === 'number' ? item.clientRating : (typeof item.clientRating === 'string' ? Number(item.clientRating) || null : null),
            totalSpent: typeof item.clientTotalSpent === 'number' ? item.clientTotalSpent : null,
            jobsPosted: typeof item.clientReviewCount === 'number' ? item.clientReviewCount : null,
            totalHires: typeof item.totalHires === 'number' ? item.totalHires : null,
            paymentVerified: item.clientPaymentVerified ?? null,
            lastActivityAt: item.lastActivityAt ? new Date(item.lastActivityAt) : null,
            openJobs: typeof item.openJobs === 'number' ? item.openJobs : null,
          },
          source: 'upwork',
          score: null,
          fetchedAt: new Date(),
          platform: 'Upwork',
          country: country === 'Remote' ? 'Remote' : country || 'Remote',
          clientName: clientName ?? undefined,
          clientSpend: spentVal,
          connections: connects || 0,
          isNew: true,
        };

        results.push(job);
      }
    }

    console.log(`[ApifyUpworkProvider] Total jobs fetched: ${results.length}`);
    return results;
  }

  // Runs one Upwork query against one Apify account. Returns the raw item list
  // (or null when the account failed) plus whether the account is UNAVAILABLE
  // for the remainder of the run (usage limit exceeded / auth / quota — retrying
  // it would keep failing). An empty array is a valid result (the query matched
  // nothing) and is NOT treated as a failure. A transient server/network error
  // (5xx / fetch failure) returns items=null with exhausted=false so the caller
  // fails over for that query but keeps the account for later queries.
  private async runQuery(
    query: string,
    token: string,
    maxResults: number
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ items: any[] | null; exhausted: boolean }> {
    const endpoint = `https://api.apify.com/v2/actors/blackfalcondata~upwork-scraper/run-sync-get-dataset-items?token=${token}`;
    try {
      console.log(`[ApifyUpworkProvider] Fetching Upwork jobs for: "${query}" (account ...${token.slice(-4)})...`);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          maxResults,
          sort: "recency",
        }),
      });

      if (!res.ok) {
        console.warn(`[ApifyUpworkProvider] Apify request failed with status: ${res.status}`);
        let exhausted = res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429;
        try {
          const body = await res.text();
          if (/usage|limit|quota|exceed|billing|forbidden|invalid token|unauthorized/i.test(body)) {
            exhausted = true;
          }
        } catch { /* non-fatal */ }
        return { items: null, exhausted };
      }

      const rawItems = await res.json();
      return { items: Array.isArray(rawItems) ? rawItems : [], exhausted: false };
    } catch (err) {
      console.error('[ApifyUpworkProvider] Error fetching:', err instanceof Error ? err.message : err);
      return { items: null, exhausted: false };
    }
  }

  private cleanText(value: unknown): string {
    if (value == null) return '';
    return String(value)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
