import { Job, JobClient } from "../types/job";
import { JobProvider } from "./JobProvider";
import { ApifyUpworkProvider } from "./ApifyUpworkProvider";
import { FreelancerProvider } from "./FreelancerProvider";
import { Crawl4AiProvider } from "./Crawl4AiProvider";
import { SerpApiUpworkProvider } from "./SerpApiUpworkProvider";
import { logCronRun } from "../lib/cronLogger";
import { recordMarketFacts } from "../lib/marketFacts";
import { prisma } from "../lib/db";

export class JobPipeline {
  private providers: JobProvider[] = [
    new ApifyUpworkProvider(),
    new FreelancerProvider(),
  ];

  async execute(): Promise<{ jobs: Job[]; newJobsAdded: number }> {
    // One shared clock for the whole run: the in-memory working-set purge and
    // the DB retention purge use the SAME cutoff, so a row kept in memory this
    // run can never be deleted by the DB purge a few minutes later (the old
    // code recomputed `now` after the provider fetches, which could delete a
    // row at the exact 7-day mark in the same run it was re-upserted).
    const nowMs = Date.now();

    console.log('[JobPipeline] Step 1: Cleaning store - Purging jobs older than 7 days...');
    const existingStore = await this.loadExistingStore();
    const activeStore = this.purgeExpiredJobs(existingStore, nowMs);
    console.log(`[JobPipeline] Active store count after 7-day cleanup: ${activeStore.length}`);

    // Build set of existing IDs/URLs to skip fetching duplicates
    const existingKeys = new Set<string>();
    activeStore.forEach(j => {
      existingKeys.add(j.id);
      if (j.url) existingKeys.add(j.url);
      const u = JobPipeline.normUrlKey(j.url);
      if (u) existingKeys.add(u);
    });

    console.log('[JobPipeline] Step 2: Fetching jobs from Upwork (Apify) and Freelancer...');
    const fetchedJobs: Job[] = [];

    // Apify Upwork (primary). A GENUINE provider failure (no token, API/quota
    // error, timeout, actor failure) triggers the self-hosted Crawl4AI fallback
    // exactly once. Zero jobs from a successful run is a normal result and
    // never activates the fallback (see ApifyUpworkProvider.lastRunStatus).
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

    let fallbackJobs: Job[] = [];
    if (apifyFailed) {
      console.warn(`[JobPipeline] Apify (Upwork) failed (${apifyFailureReason}) - activating Crawl4AI fallback (once).`);
      const fallbackStarted = Date.now();
      try {
        fallbackJobs = await new Crawl4AiProvider().fetchJobs();
        console.log(`[JobPipeline] Crawl4AI fallback: ${fallbackJobs.length} jobs in ${Date.now() - fallbackStarted}ms.`);
      } catch (err: unknown) {
        console.error('[JobPipeline] Crawl4AI fallback failed:', err instanceof Error ? err.message : err);
      }
    } else {
      console.log(`[JobPipeline] Apify (Upwork): ${apifyJobs.length} jobs.`);
    }
    fetchedJobs.push(...apifyJobs, ...fallbackJobs);

    // SerpApi/Google Jobs fallback: if Apify failed AND Crawl4AI returned
    // nothing, try SerpApi as a last resort for Upwork data.
    const upworkCount = apifyJobs.length + fallbackJobs.length;
    if (upworkCount === 0) {
      console.warn('[JobPipeline] No Upwork jobs from Apify or Crawl4AI — trying SerpApi/Google Jobs fallback.');
      try {
        const serpJobs = await new SerpApiUpworkProvider().fetchJobs();
        console.log(`[JobPipeline] SerpApi fallback: ${serpJobs.length} Upwork jobs.`);
        fallbackJobs.push(...serpJobs);
        fetchedJobs.push(...serpJobs);
      } catch (err: unknown) {
        console.error('[JobPipeline] SerpApi fallback failed:', err instanceof Error ? err.message : err);
      }
    }

    // Freelancer (complementary source)
    const freelancerJobs = await this.providers[1].fetchJobs();
    console.log(`[JobPipeline] Freelancer: ${freelancerJobs.length} jobs.`);
    fetchedJobs.push(...freelancerJobs);

    // Step 3: Local 7-Day Filter & Hard Filters
    console.log('[JobPipeline] Step 3: Applying 7-Day Age Filter & Hard Filters...');
    const validFetched = fetchedJobs.filter(job => this.applyHardFilters(job));

    // Refresh volatile competition signals on already-stored jobs so corrected
    // parse values (e.g. Upwork "50+") propagate on the next sync instead of
    // waiting for the listing to be re-discovered. This only updates counts;
    // it does not change filtering or scoring inputs. A field is only written
    // when the provider returned a usable value — a missing count must never
    // clobber a valid stored count (mirrors ActiveJobRefresher).
    const storeByUrl = new Map<string, Job>();
    activeStore.forEach(j => { if (j.url) storeByUrl.set(j.url, j); });
    for (const f of validFetched) {
      const ex = f.url ? storeByUrl.get(f.url) : undefined;
      if (ex) {
        // Proposal counts are monotonic non-decreasing: only advance on a
        // confirmed positive count that is higher than the stored value. A
        // provider 0/null is ambiguous (range band, scrape fallback) and must
        // never overwrite a stored positive count, and a lower positive count
        // (e.g. a re-scrape re-parse) must never decrease an existing one.
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
      // Ensure clean URL-safe id
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

    // Enforce the active-job window at the database level AFTER upserting the
    // working set. Only rows NOT re-saved by saveStore() can match: unapplied
    // jobs whose first-seen createdAt is older than 7 days, and applied jobs
    // older than 40 days. saveStore() re-upserts every row in finalCollection
    // (all of which passed the in-memory filter against the SAME cutoff
    // captured at the start of the run), so a row we just wrote is never
    // deleted by this query. Cleanup is independent of provider success: a
    // failed/partial sync re-upserts the whole active store and only genuinely
    // age-expired rows can match.
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

    // Persist per-day aggregate facts so market intelligence survives the
    // 7-day raw listing retention. Non-fatal if the table is not present yet.
    const facts = await recordMarketFacts(finalCollection);
    console.log(`[JobPipeline] Recorded ${facts.recorded} market facts${facts.failed ? ' (skipped: table unavailable)' : ''}.`);

    // Log execution
    await logCronRun({
      status: 'SUCCESS',
      jobsFetched: fetchedJobs.length,
      newJobsAdded: brandNewJobs.length,
      sourceSummary: `Apify (${apifyJobs.length})${fallbackJobs.length ? `, Crawl4AI fallback (${fallbackJobs.length})` : ''}, Freelancer (${freelancerJobs.length})`
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
        // True source posting time is preserved in rawPayload.postedAt for
        // display/activity; createdAt is the immutable first-seen retention
        // anchor (firstSeenAt). Fall back to createdAt when the source time is
        // missing or invalid.
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
        // Preserve the true source posting time in rawPayload.postedAt for
        // display/activity. createdAt stays the immutable first-seen retention
        // anchor (spec §8 retention model): it is set at create and never
        // rewritten on update, so a sync can never reset a job's age.
        const sourcePostedIso = job.postedAt instanceof Date
          ? job.postedAt.toISOString()
          : (typeof job.postedAt === 'string' ? new Date(job.postedAt).toISOString() : null);
        const payload = sourcePostedIso ? { ...clientObj, postedAt: sourcePostedIso } : clientObj;

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
            // Preserve stored competition signals when the fetched record has
            // no usable value: `undefined` tells Prisma to leave the column
            // untouched instead of overwriting a valid count. Proposal counts
            // are monotonic non-decreasing, so only positive advances are
            // written on update; a genuine 0 is only stored at CREATE for a new
            // job. Interview/hires counts patch positive signals only, so the
            // provider's `?? 0` default never clobbers a stored real value.
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
            createdAt: new Date(), // immutable first-seen retention anchor (spec §8); true source time lives in rawPayload.postedAt
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

  // Comparison-only key for deduplication. The same listing can surface with
  // different tracking/query variants across providers or runs (Apify, Crawl4AI,
  // Freelancer), so we compare on a normalized key while STORING the original
  // url unchanged. Strips query string, fragment and trailing slashes, and
  // folds Upwork's `/job-post/~<id>` canonical form onto `/jobs/~<id>`.
  private static normUrlKey(url?: string | null): string {
    if (!url) return '';
    return String(url).trim().split('#')[0].split('?')[0].replace(/\/job-post\/~/, '/jobs/~').replace(/\/+$/, '');
  }

  private purgeExpiredJobs(jobs: Job[], nowMs: number): Job[] {
    const unappliedMaxMs = 7 * 24 * 60 * 60 * 1000;  // 7 days for unapplied
    const appliedMaxMs = 40 * 24 * 60 * 60 * 1000;   // 40 days for applied jobs

    return jobs.filter(job => {
      // Retention age = first time the row entered THIS database
      // (Opportunity.createdAt), carried through the store as firstSeenAt.
      // Fall back to postedAt defensively for rows that predate that field.
      // A job's DB age therefore never depends on the source's posting
      // timestamp, so a job can never be purged before it has actually been in
      // the database 7 days (40 days once applied).
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
    const maxMs = 7 * 24 * 60 * 60 * 1000; // 7 days

    // Rule 1: Age <= 7 days
    if (!job.postedAt) return false;
    const ageMs = now - new Date(job.postedAt).getTime();
    if (ageMs > maxMs) return false;

    // Rule 2: hiresCount === 0 (exclude if already hired)
    if (typeof job.hiresCount === "number" && job.hiresCount > 0) {
      return false;
    }

    // Rule 3: interviewingCount <= 10 (prefer low/medium competition; Upwork's
    // "5 to 10" band stays visible so real high-signal jobs aren't dropped).
    if (typeof job.interviewingCount === "number" && job.interviewingCount > 10) {
      return false;
    }

    // Rule 4: Reject clearly saturated competition (>= 50 proposals). Upwork's
    // top band "50+" normalizes to 50, so this now rejects listings at/over that
    // threshold instead of letting every saturated job through (the previous > 50
    // check was unreachable because normalization already caps at 50).
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
      } else if (job.proposalCount >= 15) {
        score -= 20;
        reasons.push('High competition (15+ proposals)');
      } else if (job.proposalCount > 20) {
        score -= 15;
        reasons.push('High competition');
      }
    }

    // Interview/progress status penalty
    if (typeof job.interviewingCount === "number" && job.interviewingCount > 0) {
      score -= 15;
      reasons.push('Candidates already interviewing');
    }
    if (typeof job.hiresCount === "number" && job.hiresCount > 0) {
      score -= 25;
      reasons.push('Position already filled');
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
