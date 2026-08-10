import { Job } from "../types/job";
import { JobProvider } from "./JobProvider";
import { ApifyUpworkProvider } from "./ApifyUpworkProvider";
import { SerpApiGoogleJobsProvider } from "./SerpApiGoogleJobsProvider";
import { FreelancerProvider } from "./FreelancerProvider";
import { IndeedProvider } from "./IndeedProvider";
import { LinkedInProvider } from "./LinkedInProvider";
import { GoogleJobsProvider } from "./GoogleJobsProvider";
import { logCronRun } from "../lib/cronLogger";
import { prisma } from "../lib/db";

/** Complementary (non-upwork) providers are always fetched alongside the primary sources. */
const COMPLEMENTARY_INDEX_START = 3;

export class JobPipeline {
  private providers: JobProvider[] = [
    new ApifyUpworkProvider(),
    new SerpApiGoogleJobsProvider(),
    new FreelancerProvider(),
    new IndeedProvider(),
    new LinkedInProvider(),
    new GoogleJobsProvider(),
  ];

  /** Return the provider that backs a given source tab, or null. */
  providerForSource(source: string): JobProvider | null {
    const map: Record<string, JobProvider> = {
      upwork: this.providers[0],
      freelancer: this.providers[2],
      indeed: this.providers[3],
      linkedin: this.providers[4],
      google: this.providers[5],
    };
    return map[source.toLowerCase()] ?? null;
  }

  async execute(): Promise<Job[]> {
    console.log('[JobPipeline] Step 1: Cleaning store - Purging jobs older than 7 days...');
    const existingStore = await this.loadExistingStore();
    const activeStore = this.purgeExpiredJobs(existingStore);
    console.log(`[JobPipeline] Active store count after 7-day cleanup: ${activeStore.length}`);

    // Build set of existing IDs/URLs to skip fetching duplicates
    const existingKeys = new Set<string>();
    activeStore.forEach(j => {
      existingKeys.add(j.id);
      if (j.url) existingKeys.add(j.url);
    });

    console.log('[JobPipeline] Step 2: Fetching new jobs from Orchestrated Providers (Apify -> SerpApi -> Freelancer)...');
    const fetchedJobs: Job[] = [];

    // Priority 1: Apify Upwork
    const apifyJobs = await this.providers[0].fetchJobs();
    if (apifyJobs.length > 0) {
      console.log(`[JobPipeline] Acquired ${apifyJobs.length} primary jobs from Apify.`);
      fetchedJobs.push(...apifyJobs);
    } else {
      console.log(`[JobPipeline] Apify returned 0 jobs. Running Fallback 1 (SerpApi)...`);
      const serpJobs = await this.providers[1].fetchJobs();
      fetchedJobs.push(...serpJobs);
    }

    // Always fetch Freelancer jobs as complementary source
    const freelancerJobs = await this.providers[2].fetchJobs();
    fetchedJobs.push(...freelancerJobs);

    // Complementary sources (Indeed, LinkedIn, Google Jobs) — always fetched.
    // These are appended after the primary Upwork/Freelancer flow so existing
    // behaviour for Upwork and Freelancer is untouched.
    const complementaryJobs: Job[] = [];
    const complementaryCounts: Record<string, number> = {};
    for (let i = COMPLEMENTARY_INDEX_START; i < this.providers.length; i++) {
      const prov = this.providers[i];
      try {
        const kjs = await prov.fetchJobs();
        complementaryJobs.push(...kjs);
        complementaryCounts[prov.name] = kjs.length;
        console.log(`[JobPipeline] ${prov.name}: ${kjs.length} complementary jobs`);
      } catch (err) {
        console.warn(`[JobPipeline] ${prov.name} failed during sync:`, err);
      }
    }
    fetchedJobs.push(...complementaryJobs);
    const compSummary = Object.entries(complementaryCounts).map(([n, c]) => `${n} (${c})`).join(', ');

    // Step 3: Local 7-Day Filter & Hard Filters
    console.log('[JobPipeline] Step 3: Applying 7-Day Age Filter & Hard Filters...');
    const validFetched = fetchedJobs.filter(job => this.applyHardFilters(job));

    // Step 4: Deduplication against existing store
    console.log('[JobPipeline] Step 4: Deduplicating against existing store...');
    const brandNewJobs: Job[] = [];

    for (const job of validFetched) {
      // Ensure clean URL-safe id
      if (job.id.includes('/') || job.id.includes('http')) {
        job.id = (job.source || 'job') + '-' + job.id.split('/').pop()?.replace(/[^a-zA-Z0-9_-]/g, '');
      }

      const key1 = job.id;
      const key2 = job.url;
      if (!existingKeys.has(key1) && !existingKeys.has(key2)) {
        existingKeys.add(key1);
        if (key2) existingKeys.add(key2);
        
        // Calculate local score
        const scoredJob = this.calculateScore(job);
        
        // Quality Gate: Only accept jobs with a score >= 50
        if ((scoredJob.score ?? 0) >= 50) {
          brandNewJobs.push(scoredJob);
        }
      }
    }

    console.log(`[JobPipeline] Step 5: Identified ${brandNewJobs.length} genuinely new jobs.`);

    // Merge active store + brand new jobs
    const finalCollection = [...brandNewJobs, ...activeStore];

    // Sort latest first
    finalCollection.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());

    // Save back to database
    await this.saveStore(finalCollection);

    // Log execution
    await logCronRun({
      status: 'SUCCESS',
      jobsFetched: fetchedJobs.length,
      newJobsAdded: brandNewJobs.length,
      sourceSummary: `Apify (${apifyJobs.length}), Freelancer (${freelancerJobs.length})${compSummary ? `, ${compSummary}` : ''}`
    });

    return finalCollection;
  }

  /**
   * On-demand smart search. Runs the same providers as the scheduled sync but
   * scoped to a single query, applies the same hard filters, deduplicates
   * against the existing store, and returns freshly-scored matching jobs.
   * Results are NOT persisted (manual searches must not pollute the feed).
   *
   * When `source` is provided, only the provider backing that source is queried
   * (source isolation for manual search). Otherwise all providers run.
   */
  async search(searchQuery: string, maxJobs = 20, source?: string): Promise<Job[]> {
    const existingStore = await this.loadExistingStore();
    const existingKeys = new Set<string>();
    existingStore.forEach((j) => {
      if (j.id) existingKeys.add(j.id);
      if (j.url) existingKeys.add(j.url);
    });

    const fetchedJobs: Job[] = [];

    // Source-scoped search: only the targeted provider(s).
    if (source) {
      const scoped = this.providersForSource(searchQuery, source);
      for (const prov of scoped) {
        try {
          const kjs = await prov.fetchJobs(searchQuery);
          fetchedJobs.push(...kjs);
        } catch (err) {
          console.warn(`[JobPipeline] search ${prov.name} failed:`, err);
        }
      }
    } else {
      const apifyJobs = await this.providers[0].fetchJobs(searchQuery);
      if (apifyJobs.length > 0) {
        fetchedJobs.push(...apifyJobs);
      } else {
        const serpJobs = await this.providers[1].fetchJobs();
        fetchedJobs.push(...serpJobs);
      }
      const freelancerJobs = await this.providers[2].fetchJobs(searchQuery);
      fetchedJobs.push(...freelancerJobs);

      // Complementary sources (Indeed, LinkedIn, Google Jobs).
      for (let i = COMPLEMENTARY_INDEX_START; i < this.providers.length; i++) {
        try {
          const kjs = await this.providers[i].fetchJobs(searchQuery);
          fetchedJobs.push(...kjs);
        } catch (err) {
          console.warn(`[JobPipeline] search complementary (${this.providers[i].name}) failed:`, err);
        }
      }
    }

    const valid = fetchedJobs.filter((job) => this.applyHardFilters(job));
    const seen = new Set<string>();
    const matches: Job[] = [];

    for (const job of valid) {
      if (job.id.includes('/') || job.id.includes('http')) {
        job.id = (job.source || 'job') + '-' + job.id.split('/').pop()?.replace(/[^a-zA-Z0-9_-]/g, '');
      }
      const key1 = job.id;
      const key2 = job.url;
      if (existingKeys.has(key1) || existingKeys.has(key2)) continue;
      if (seen.has(key1) || (key2 && seen.has(key2))) continue;
      seen.add(key1);
      if (key2) seen.add(key2);

      const scored = this.calculateScore(job);
      if ((scored.score ?? 0) >= 50) matches.push(scored);
    }

    matches.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    console.log(`[JobPipeline] search "${searchQuery}" [source=${source || 'all'}] found ${matches.length} matching jobs`);
    return matches.slice(0, maxJobs);
  }

  /** Providers to query when scoping a manual search to a single source. */
  private providersForSource(searchQuery: string, source: string): JobProvider[] {
    const normalized = source.toLowerCase();
    if (normalized === 'upwork') {
      return [this.providers[0]]; // Apify Upwork (keeps existing Upwork behaviour)
    }
    const mapped = this.providerForSource(normalized);
    return mapped ? [mapped] : [];
  }

  private async loadExistingStore(): Promise<Job[]> {
    try {
      const dbOps = await prisma.opportunity.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return dbOps.map(op => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        let budgetVal: any = op.budget;
        try { budgetVal = JSON.parse(op.budget); } catch {}
        return {
          id: op.id,
          url: op.url,
          title: op.title,
          description: op.description,
          budget: budgetVal,
          budgetType: op.budgetType || '',
          score: op.score,
          platform: op.platform,
          source: (op.platform || '').toLowerCase() === 'freelancer' ? 'freelancer' : 'upwork',
          connectsRequired: op.connections ?? null,
          viewed: op.viewed,
          applied: op.applied,
          postedAt: op.createdAt,
          fetchedAt: op.createdAt,
          country: op.country || '',
          clientName: op.clientName || '',
          clientSpend: op.clientSpend || '',
          clientRating: op.clientRating || '',
          clientReviews: op.clientReviews || '',
          paymentVerified: op.paymentVerified,
          jobsPosted: op.jobsPosted || null,
          connections: op.connections || 0,
          skills: op.skills ? op.skills.split(',') : [],
          experienceLevel: op.experienceLevel || '',
          duration: op.duration || '',
          proposalCount: op.proposalCount || null,
          interviewingCount: op.interviewingCount || 0,
          hiresCount: op.hiresCount || 0,
          client: op.rawPayload ? JSON.parse(op.rawPayload) : {},
        };
      });
    } catch {
      return [];
    }
  }

  private async saveStore(jobs: Job[]) {
    for (const job of jobs) {
      if (!job.url) continue;
      try {
        const budgetStr = typeof job.budget === 'object' ? JSON.stringify(job.budget) : (job.budget || 'Negotiable');
        const skillsStr = Array.isArray(job.skills) ? job.skills.join(',') : '';
        const clientObj = job.client || {};

        await prisma.opportunity.upsert({
          where: { url: job.url },
          update: {
            title: job.title || 'Untitled Job',
            description: job.description || '',
            budget: budgetStr,
            platform: job.platform || 'Upwork',
            score: job.score || 70,
            country: job.country || clientObj.country || '',
            clientName: job.clientName || clientObj.name || '',
            clientSpend: job.clientSpend || '',
            clientReviews: job.clientReviews || '',
            connections: job.connections || 0,
            budgetType: job.budgetType || '',
            experienceLevel: job.experienceLevel || '',
            duration: job.duration || '',
            skills: skillsStr,
            proposalCount: typeof job.proposalCount === 'number' ? job.proposalCount : null,
            interviewingCount: job.interviewingCount || 0,
            hiresCount: job.hiresCount || 0,
            paymentVerified: clientObj.paymentVerified === true,
            clientRating: clientObj.rating ? String(clientObj.rating) : '',
            jobsPosted: clientObj.jobsPosted ?? null,
            applied: job.applied || false,
            rawPayload: JSON.stringify(clientObj),
          },
          create: {
            id: job.id,
            url: job.url,
            title: job.title || 'Untitled Job',
            description: job.description || '',
            budget: budgetStr,
            platform: job.platform || 'Upwork',
            score: job.score || 70,
            createdAt: job.postedAt ? new Date(job.postedAt) : new Date(),
            country: job.country || clientObj.country || '',
            clientName: job.clientName || clientObj.name || '',
            clientSpend: job.clientSpend || '',
            clientReviews: job.clientReviews || '',
            connections: job.connections || 0,
            budgetType: job.budgetType || '',
            experienceLevel: job.experienceLevel || '',
            duration: job.duration || '',
            skills: skillsStr,
            proposalCount: typeof job.proposalCount === 'number' ? job.proposalCount : null,
            interviewingCount: job.interviewingCount || 0,
            hiresCount: job.hiresCount || 0,
            paymentVerified: clientObj.paymentVerified === true,
            clientRating: clientObj.rating ? String(clientObj.rating) : '',
            jobsPosted: clientObj.jobsPosted ?? null,
            applied: job.applied || false,
            rawPayload: JSON.stringify(clientObj),
          },
        });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        console.error('[JobPipeline] DB upsert error:', err.message);
      }
    }
  }

  private purgeExpiredJobs(jobs: Job[]): Job[] {
    const now = new Date().getTime();
    const unappliedMaxMs = 7 * 24 * 60 * 60 * 1000;  // 7 days for unapplied
    const appliedMaxMs = 40 * 24 * 60 * 60 * 1000;   // 40 days for applied jobs

    return jobs.filter(job => {
      if (!job.postedAt) return false;
      const ageMs = now - new Date(job.postedAt).getTime();
      if (job.applied) {
        return ageMs <= appliedMaxMs;
      }
      return ageMs <= unappliedMaxMs;
    });
  }

  private applyHardFilters(job: Job): boolean {
    const now = new Date().getTime();
    const maxMs = 7 * 24 * 60 * 60 * 1000; // 7 days

    // Rule 1: Age <= 7 days
    if (!job.postedAt) return false;
    const ageMs = now - new Date(job.postedAt).getTime();
    if (ageMs > maxMs) return false;

    // Rule 2: hiresCount === 0 (exclude if already hired)
    if (typeof job.hiresCount === "number" && job.hiresCount > 0) {
      return false;
    }

    // Rule 3: interviewingCount <= 3 (prefer low competition)
    if (typeof job.interviewingCount === "number" && job.interviewingCount > 3) {
      return false;
    }

    // Rule 4: Reject jobs with high competition (>= 50 proposals)
    if (typeof job.proposalCount === "number" && job.proposalCount >= 50) {
      return false;
    }

    // Rule 5: Reject spam, academic fraud, or suspicious terms
    const text = `${job.title} ${job.description}`.toLowerCase();
    if (/(academic|homework|exam|proxy|pay outside|free work|unpaid|bidding)/i.test(text)) {
      return false;
    }

    return true;
  }

  private calculateScore(job: Job): Job {
    let score = 50; // Baseline
    const reasons: string[] = [];

    // Payment verified bonus
    if (job.client.paymentVerified === true) {
      score += 20;
      reasons.push('Verified payment');
    } else {
      score -= 5; 
      reasons.push('Unverified payment');
    }

    // Total spent bonus
    if (job.client.totalSpent && job.client.totalSpent > 1000) {
      score += 20;
      reasons.push('High client spend');
    } else if (job.client.totalSpent && job.client.totalSpent > 0) {
      score += 10;
    } else {
      score -= 5;
    }

    // Rating bonus
    if (job.client.rating && job.client.rating >= 4.5) {
      score += 10;
      reasons.push('Excellent client rating');
    } else if (job.client.rating && job.client.rating < 3.5) {
      score -= 10;
      reasons.push('Poor client rating');
    }

    // Low proposals bonus
    if (typeof job.proposalCount === "number") {
      if (job.proposalCount <= 5) {
        score += 15;
        reasons.push('Low competition');
      } else if (job.proposalCount > 20) {
        score -= 15;
        reasons.push('High competition');
      }
    }

    // Relevancy signal check
    const text = `${job.title} ${job.description}`.toLowerCase();
    if (/flutter|react|nextjs|typescript|nodejs|full stack|mobile|python/i.test(text)) {
      score += 15;
      reasons.push('Strong tech stack match');
    } else {
      score -= 10;
    }

    // Determine final score and classification
    job.score = Math.min(99, Math.max(10, score));
    
    let classification = "LOW/MEDIUM";
    if (job.score >= 80) classification = "HIGH OPPORTUNITY";
    else if (job.score >= 65) classification = "MEDIUM-HIGH";

    // Summarize top 2 reasons
    job.client.opportunityReason = `[${classification}] ${reasons.slice(0, 2).join(', ')}`;
    return job;
  }
}
