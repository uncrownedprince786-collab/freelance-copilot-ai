import { Job } from "../types/job";
import { JobProvider } from "./JobProvider";
import { ApifyUpworkProvider } from "./ApifyUpworkProvider";
import { SerpApiGoogleJobsProvider } from "./SerpApiGoogleJobsProvider";
import { FreelancerProvider } from "./FreelancerProvider";
import { logCronRun } from "../lib/cronLogger";
import * as fs from 'fs';
import * as path from 'path';

export class JobPipeline {
  private providers: JobProvider[] = [
    new ApifyUpworkProvider(),
    new SerpApiGoogleJobsProvider(),
    new FreelancerProvider()
  ];

  private cacheFile = path.join(process.cwd(), '.jobs-cache.json');

  async execute(): Promise<Job[]> {
    console.log('[JobPipeline] Step 1: Cleaning store - Purging jobs older than 7 days...');
    const existingStore = this.loadExistingStore();
    const activeStore = this.purgeExpiredJobs(existingStore, 7);
    console.log(`[JobPipeline] Active store count after 7-day cleanup: ${activeStore.length}`);

    // Build set of existing IDs/URLs to skip fetching duplicates
    const existingKeys = new Set<string>();
    activeStore.forEach(j => {
      existingKeys.add(j.id);
      if (j.url) existingKeys.add(j.url);
    });

    console.log('[JobPipeline] Step 2: Fetching new jobs from Orchestrated Providers (Apify -> SerpApi -> Freelancer)...');
    let fetchedJobs: Job[] = [];

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
        brandNewJobs.push(scoredJob);
      }
    }

    console.log(`[JobPipeline] Step 5: Identified ${brandNewJobs.length} genuinely new jobs.`);

    // Merge active store + brand new jobs
    const finalCollection = [...brandNewJobs, ...activeStore];

    // Sort latest first
    finalCollection.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());

    // Save back to store
    this.saveStore(finalCollection);

    // Log execution
    logCronRun({
      status: 'SUCCESS',
      jobsFetched: fetchedJobs.length,
      newJobsAdded: brandNewJobs.length,
      sourceSummary: `Apify (${apifyJobs.length}), Freelancer (${freelancerJobs.length})`
    });

    return finalCollection;
  }

  private loadExistingStore(): Job[] {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const raw = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8'));
        return Array.isArray(raw.jobs) ? raw.jobs : [];
      }
    } catch {
      return [];
    }
    return [];
  }

  private saveStore(jobs: Job[]) {
    try {
      fs.writeFileSync(this.cacheFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        jobs: jobs
      }, null, 2));
    } catch (err: any) {
      console.error('[JobPipeline] Error saving store:', err.message);
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

    return true;
  }

  private calculateScore(job: Job): Job {
    let score = 65; // Baseline

    // Payment verified bonus
    if (job.client.paymentVerified === true) {
      score += 15;
    }

    // Total spent bonus
    if (job.client.totalSpent && job.client.totalSpent > 1000) {
      score += 15;
    } else if (job.client.totalSpent && job.client.totalSpent > 0) {
      score += 5;
    }

    // Rating bonus
    if (job.client.rating && job.client.rating >= 4.5) {
      score += 10;
    }

    // Low proposals bonus
    if (typeof job.proposalCount === "number") {
      if (job.proposalCount <= 5) score += 10;
      else if (job.proposalCount > 20) score -= 15;
    }

    // Relevancy signal check
    const text = `${job.title} ${job.description}`.toLowerCase();
    if (/flutter|react|nextjs|typescript|nodejs|full stack|mobile|python/i.test(text)) {
      score += 10;
    }

    job.score = Math.min(99, Math.max(30, score));
    return job;
  }
}
