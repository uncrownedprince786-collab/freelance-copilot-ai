import { Job, JobClient } from "../types/job";
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
    const nowMs = Date.now();

    console.log('[JobPipeline] Step 1: Cleaning store - Purging jobs older than 7 days...');
    const existingStore = await this.loadExistingStore();
    const activeStore = this.purgeExpiredJobs(existingStore, nowMs);
    console.log(`[JobPipeline] Active store count after 7-day cleanup: ${activeStore.length}`);

    const existingKeys = new Set<string>();
    activeStore.forEach(j => {
      existingKeys.add(j.id);
      if (j.url) existingKeys.add(j.url);
      const u = JobPipeline.normUrlKey(j.url);
      if (u) existingKeys.add(u);
    });

    console.log('[JobPipeline] Step 2: Fetching jobs from Upwork (Apify) and Freelancer...');
    const fetchedJobs: Job[] = [];

    // Apify Upwork (primary). Multi-account failover is handled inside
    // ApifyUpworkProvider: ordered account pool, exhausted accounts are
    // skipped for the rest of the run.
    const apifyProvider = this.providers[0] as ApifyUpworkProvider;
    let apifyJobs: Job[] = [];
    let apifyFailed = false;
    let apifyFailureReason = '';
    try {
      apifyJobs = await apifyProvider.fetchJobs();
      apifyFailed = apifyProvider.lastRunStatus?.failed === true;
      apifyFailureReason = apifyProvider.lastRunStatus?.reason ?? '';
    } catch (err: unknown) {
      apifyFailed = true;
      apifyFailureReason = err instanceof Error ? err.message : String(err);
      console.error('[JobPipeline] Apify (Upwork) fetch threw:', apifyFailureReason);
    }
    console.log(`[JobPipeline] Apify (Upwork): ${apifyJobs.length} jobs (failed=${apifyFailed}).`);
    fetchedJobs.push(...apifyJobs);

    // Freelancer (complementary source)
    const freelancerJobs = await this.providers[1].fetchJobs();
    console.log(`[JobPipeline] Freelancer: ${freelancerJobs.length} jobs.`);
    fetchedJobs.push(...freelancerJobs);

    // Step 3: Local 7-Day Filter & Hard Filters
    console.log('[JobPipeline] Step 3: Applying 7-Day Age Filter & Hard Filters...');
    const validFetched = fetchedJobs.filter(job => this.applyHardFilters(job));

    // Refresh volatile competition signals on already-stored jobs
    const storeByUrl = new Map<string, Job>();
    activeStore.forEach(j => { if (j.url) storeByUrl.set(j.url, j); });
    for (const f of validFetched) {
      const ex = f.url ? storeByUrl.get(f.url) : undefined;
      if (ex) {
        if (
          typeof f.proposalCount === 'number' &&
          f.proposalCount > 0 &&
          (typeof ex.proposalCount !== 'number' || f.proposalCount > ex.proposalCount)
        ) {
          ex.proposalCount = f.proposalCount;
        }
        if (typeof f.interviewingCount === 'number' && f.interviewingCount > 0) ex.interviewingCount = f.interviewingCount;
        if (typeof f.hiresCount === 'number' && f.hiresCount > 0) ex.hiresCount = f.hiresCount;
      }
    }

    // Step 4: Deduplication against existing store
    console.log('[JobPipeline] Step 4: Deduplicating against existing store...');
    const brandNewJobs: Job[] = [];

    for (const job of validFetched) {
      if (job.id.includes('/') || job.id.includes('http')) {
        job.id = (job.source || 'job') + '-' + job.id.split('/').pop()?.replace(/[^a-zA-Z0-9_-]/g, '');
      }

      const key1 = job.id;
      const key2 = job.url;
      const key2n = JobPipeline.normUrlKey(job.url);
      if (!existingKeys.has(key1) && !existingKeys.has(key2) && !existingKeys.has(key2n)) {
        existingKeys.add(key1);
        if (key2) existingKeys.add(key2);
        if (key2n) existingKeys.add(key2n);
        brandNewJobs.push(this.calculateScore(job));
      }
    }

    console.log(`[JobPipeline] Step 5: Identified ${brandNewJobs.length} genuinely new jobs.`);

    const finalCollection = [...brandNewJobs, ...activeStore];
    finalCollection.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());

    await this.saveStore(finalCollection);

    // DB-level retention enforcement
    try {
      const unappliedCutoff = new Date(nowMs - 7 * 24 * 60 * 60 * 1000);
      const appliedCutoff = new Date(nowMs - 40 * 24 * 60 * 60 * 1000);
      const purged = await prisma.opportunity.deleteMany({
        where: {
          OR: [
            { createdAt: { lt: unappliedCutoff }, applied: false },
            { createdAt: { lt: appliedCutoff }, applied: true },
          ],
        },
      });
      if (purged.count > 0) {
        console.log(`[JobPipeline] Purged ${purged.count} rows outside the active window (7d unapplied / 40d applied).`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[JobPipeline] DB purge skipped (non-fatal):', msg);
    }

    const facts = await recordMarketFacts(finalCollection);
    console.log(`[JobPipeline] Recorded ${facts.recorded} market facts${facts.failed ? ' (skipped: table unavailable)' : ''}.`);

    // Persist provider health
    try {
      const now = new Date().toISOString();
      const upsert = (key: string, value: unknown) =>
        prisma.systemKv.upsert({
          where: { key },
          create: { key, value: JSON.stringify(value), updatedAt: new Date() },
          update: { value: JSON.stringify(value), updatedAt: new Date() },
        });
      await Promise.all([
        upsert('provider:apify', { lastRun: now, failed: apifyFailed, reason: apifyFailureReason || null, count: apifyJobs.length }),
        upsert('provider:freelancer', { lastRun: now, failed: false, count: freelancerJobs.length }),
        upsert('pipeline:lastRun', { lastRun: now, total: fetchedJobs.length, new: brandNewJobs.length, active: finalCollection.length }),
      ]);
    } catch { /* non-fatal */ }

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        let clientObj: Record<string, any> = {};
        try { clientObj = op.rawPayload ? JSON.parse(op.rawPayload) : {}; } catch {}
        const sourcePostedMs = typeof clientObj?.postedAt === 'string' ? new Date(clientObj.postedAt).getTime() : NaN;
        const postedAt = Number.isFinite(sourcePostedMs) && sourcePostedMs > 0 ? new Date(Math.min(sourcePostedMs, Date.now())) : op.createdAt;
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
          postedAt,
          fetchedAt: op.createdAt,
          firstSeenAt: op.createdAt,
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
          proposalCount: typeof op.proposalCount === 'number' ? op.proposalCount : null,
          interviewingCount: op.interviewingCount || 0,
          hiresCount: op.hiresCount || 0,
          client: clientObj as JobClient,
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
        const sourcePostedIso = job.postedAt instanceof Date
          ? job.postedAt.toISOString()
          : (typeof job.postedAt === 'string' ? new Date(job.postedAt).toISOString() : null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        const extra = clientObj as any;
        const payload: Record<string, unknown> = {
          ...(sourcePostedIso ? { postedAt: sourcePostedIso } : {}),
          ...(clientObj.country ? { country: clientObj.country } : {}),
          ...(clientObj.name ? { name: clientObj.name } : {}),
          ...(extra.clientKey ? { clientKey: extra.clientKey } : {}),
          ...(clientObj.opportunityReason ? { opportunityReason: clientObj.opportunityReason } : {}),
          ...(clientObj.totalSpent ? { totalSpent: clientObj.totalSpent } : {}),
          ...(clientObj.rating ? { rating: clientObj.rating } : {}),
          ...(clientObj.jobsPosted ? { jobsPosted: clientObj.jobsPosted } : {}),
          ...(extra.memberSince ? { memberSince: extra.memberSince } : {}),
        };

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
            proposalCount: typeof job.proposalCount === 'number' && job.proposalCount > 0 ? job.proposalCount : undefined,
            interviewingCount: typeof job.interviewingCount === 'number' && job.interviewingCount > 0 ? job.interviewingCount : undefined,
            hiresCount: typeof job.hiresCount === 'number' && job.hiresCount > 0 ? job.hiresCount : undefined,
            paymentVerified: clientObj.paymentVerified === true,
            clientRating: clientObj.rating ? String(clientObj.rating) : '',
            jobsPosted: clientObj.jobsPosted ?? null,
            applied: job.applied || false,
            rawPayload: JSON.stringify(payload),
          },
          create: {
            id: job.id,
            url: job.url,
            title: job.title || 'Untitled Job',
            description: job.description || '',
            budget: budgetStr,
            platform: job.platform || 'Upwork',
            score: job.score ?? 70,
            createdAt: new Date(),
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
            rawPayload: JSON.stringify(payload),
          },
        });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        console.error('[JobPipeline] DB upsert error:', err.message);
      }
    }
  }

  private static normUrlKey(url?: string | null): string {
    if (!url) return '';
    return String(url).trim().split('#')[0].split('?')[0].replace(/\/job-post\/~/, '/jobs/~').replace(/\/+$/, '');
  }

  private purgeExpiredJobs(jobs: Job[], nowMs: number): Job[] {
    const unappliedMaxMs = 7 * 24 * 60 * 60 * 1000;
    const appliedMaxMs = 40 * 24 * 60 * 60 * 1000;

    return jobs.filter(job => {
      const anchorMs = job.firstSeenAt
        ? new Date(job.firstSeenAt).getTime()
        : (job.postedAt ? new Date(job.postedAt).getTime() : NaN);
      if (!Number.isFinite(anchorMs)) return false;
      const ageMs = nowMs - anchorMs;
      if (job.applied) {
        return ageMs <= appliedMaxMs;
      }
      return ageMs <= unappliedMaxMs;
    });
  }

  private applyHardFilters(job: Job): boolean {
    const now = new Date().getTime();
    const maxMs = 7 * 24 * 60 * 60 * 1000;

    if (!job.postedAt) return false;
    const ageMs = now - new Date(job.postedAt).getTime();
    if (ageMs > maxMs) return false;

    if (typeof job.hiresCount === "number" && job.hiresCount > 0) return false;
    if (typeof job.interviewingCount === "number" && job.interviewingCount > 10) return false;
    if (typeof job.proposalCount === "number" && job.proposalCount >= 50) return false;

    const text = `${job.title} ${job.description}`.toLowerCase();
    if (/(academic|homework|exam|proxy|pay outside|free work|unpaid|bidding)/i.test(text)) return false;

    return true;
  }

  private calculateScore(job: Job): Job {
    let score = 50;
    const reasons: string[] = [];

    if (job.client.paymentVerified === true) {
      score += 20;
      reasons.push('Verified payment');
    } else {
      score -= 5;
      reasons.push('Unverified payment');
    }

    if (job.client.totalSpent && job.client.totalSpent > 1000) {
      score += 20;
      reasons.push('High client spend');
    } else if (job.client.totalSpent && job.client.totalSpent > 0) {
      score += 10;
    } else {
      score -= 5;
    }

    if (job.client.rating && job.client.rating >= 4.5) {
      score += 10;
      reasons.push('Excellent client rating');
    } else if (job.client.rating && job.client.rating < 3.5) {
      score -= 10;
      reasons.push('Poor client rating');
    }

    if (typeof job.proposalCount === "number") {
      if (job.proposalCount <= 5) {
        score += 15;
        reasons.push('Low competition');
      } else if (job.proposalCount <= 14) {
        reasons.push('Moderate competition');
      } else if (job.proposalCount <= 29) {
        score -= 10;
        reasons.push('High competition');
      } else {
        score -= 20;
        reasons.push('Very high competition');
      }
    }

    if (typeof job.interviewingCount === "number" && job.interviewingCount > 0) {
      score -= 15;
      reasons.push('Candidates already interviewing');
    }
    if (typeof job.hiresCount === "number" && job.hiresCount > 0) {
      score -= 25;
      reasons.push('Position already filled');
    }

    const text = `${job.title} ${job.description}`.toLowerCase();
    if (/flutter|react|nextjs|typescript|nodejs|full stack|mobile|python/i.test(text)) {
      score += 15;
      reasons.push('Strong tech stack match');
    } else {
      score -= 10;
    }

    job.score = Math.min(99, Math.max(10, score));

    let classification = "LOW/MEDIUM";
    if (job.score >= 80) classification = "HIGH OPPORTUNITY";
    else if (job.score >= 65) classification = "MEDIUM-HIGH";

    job.client.opportunityReason = `[${classification}] ${reasons.slice(0, 2).join(', ')}`;
    return job;
  }
}
