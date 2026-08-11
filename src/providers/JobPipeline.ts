import { Job } from "../types/job";
import { JobProvider } from "./JobProvider";
import { ApifyUpworkProvider } from "./ApifyUpworkProvider";
import { FreelancerProvider } from "./FreelancerProvider";
import { logCronRun } from "../lib/cronLogger";
import { recordMarketFacts } from "../lib/marketFacts";
import { prisma } from "../lib/db";

export class JobPipeline {
  private providers: JobProvider[] = [
    new ApifyUpworkProvider(),
    new FreelancerProvider(),
  ];

  async execute(): Promise<{ jobs: Job[]; newJobsAdded: number }> {
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

    console.log('[JobPipeline] Step 2: Fetching jobs from Upwork (Apify) and Freelancer...');
    const fetchedJobs: Job[] = [];

    // Apify Upwork
    const apifyJobs = await this.providers[0].fetchJobs();
    console.log(`[JobPipeline] Apify (Upwork): ${apifyJobs.length} jobs.`);
    fetchedJobs.push(...apifyJobs);

    // Freelancer (complementary source)
    const freelancerJobs = await this.providers[1].fetchJobs();
    console.log(`[JobPipeline] Freelancer: ${freelancerJobs.length} jobs.`);
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
        
        // Calculate local score. Every valid new job is stored regardless of
        // score — lower-scored opportunities must remain available to the user
        // and the score filter reflects the actual database.
        brandNewJobs.push(this.calculateScore(job));
      }
    }

    console.log(`[JobPipeline] Step 5: Identified ${brandNewJobs.length} genuinely new jobs.`);

    // Merge active store + brand new jobs
    const finalCollection = [...brandNewJobs, ...activeStore];

    // Sort latest first
    finalCollection.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());

    // Save back to database
    await this.saveStore(finalCollection);

    // Persist per-day aggregate facts so market intelligence survives the
    // 7-day raw listing retention. Non-fatal if the table is not present yet.
    const facts = await recordMarketFacts(finalCollection);
    console.log(`[JobPipeline] Recorded ${facts.recorded} market facts${facts.failed ? ' (skipped: table unavailable)' : ''}.`);

    // Log execution
    await logCronRun({
      status: 'SUCCESS',
      jobsFetched: fetchedJobs.length,
      newJobsAdded: brandNewJobs.length,
      sourceSummary: `Apify (${apifyJobs.length}), Freelancer (${freelancerJobs.length})`
    });

    return { jobs: finalCollection, newJobsAdded: brandNewJobs.length };
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
            score: job.score ?? 70,
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
            score: job.score ?? 70,
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
