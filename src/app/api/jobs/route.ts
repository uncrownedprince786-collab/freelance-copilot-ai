import { NextResponse } from 'next/server';
import { getRawJobs, getAppliedSet } from '@/lib/jobsCache';

export async function GET() {
  try {
    const rawJobs = await getRawJobs();
    const appliedSet = await getAppliedSet();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jobs = rawJobs.map((job: any) => {
      const jobId = job.id || job.url;
      const isApplied = Boolean(job.applied) || appliedSet.has(jobId) || appliedSet.has(job.url);
      const clientObj = job.client || {};

      // --- Country: only show real countries, never "Remote" or generic
      const rawCountry = job.country || clientObj.country || job.location || '';
      const countryVal = (rawCountry && rawCountry.toLowerCase() !== 'remote') ? rawCountry : '';

      // --- Client name: filter out generic placeholders
      const rawClientName = job.clientName || clientObj.name || job.company || '';
      const genericNames = ['freelancer client', 'upwork client', 'client', ''];
      const clientNameVal = (!rawClientName || genericNames.includes(rawClientName.toLowerCase())) ? '' : rawClientName;

      // --- Budget: handle object vs string. Use the provider's real currency
      // symbol when present; default to "$" (Upwork has no currency field).
      let budgetStr = 'Negotiable';
      if (typeof job.budget === 'object' && job.budget) {
        const sym = job.budget.currency || '$';
        // Trim float noise from source values ("30.0" → "30") without inventing.
        const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
        const rate = job.budget.type === 'hourly' ? '/hr' : '';
        const bMin = Number(job.budget.min);
        const bMax = Number(job.budget.max);
        const bAmt = Number(job.budget.amount);
        const hasMin = Number.isFinite(bMin);
        const hasMax = Number.isFinite(bMax);
        const hasAmt = Number.isFinite(bAmt) && bAmt > 0;
        if (hasAmt) budgetStr = `${sym}${fmt(bAmt)}${rate}`;
        else if (hasMin && hasMax && bMin !== bMax) budgetStr = `${sym}${fmt(bMin)}–${sym}${fmt(bMax)}${rate}`;
        else if (hasMin) budgetStr = `${sym}${fmt(bMin)}${rate}`;
        else if (job.budget.type === 'hourly') budgetStr = 'Hourly';
      } else if (typeof job.budget === 'string' && job.budget) {
        budgetStr = job.budget;
      }

      // --- Budget type label
      const budgetType = (typeof job.budget === 'object' && job.budget?.type)
        ? (job.budget.type === 'hourly' ? 'Hourly Rate' : 'Fixed Price')
        : '';

      // --- Experience Level: clean up "IntermediateLevel" → "Intermediate"
      const expRaw = typeof job.experienceLevel === 'string' ? job.experienceLevel : '';
      const experienceLevel = expRaw
        ? expRaw.replace('Level', '').replace(/([A-Z])/g, ' $1').trim()
        : '';

      // --- Client spend
      let clientSpend = '';
      if (job.clientSpend) clientSpend = job.clientSpend;
      else if (clientObj.totalSpent && clientObj.totalSpent > 0) clientSpend = `$${clientObj.totalSpent.toLocaleString()}`;

      // --- Client rating
      const clientRating = clientObj.rating ? Number(clientObj.rating).toFixed(1) : '';

      // --- Payment verified
      const paymentVerified = clientObj.paymentVerified === true;

      // --- Jobs posted by client
      const jobsPosted = clientObj.jobsPosted || null;

      // --- Member since (from lastActivityAt or fetchedAt as fallback — not available in this data)
      const memberSince = clientObj.memberSince || '';
      // --- Lead category & opportunity reason (derived from pipeline score + client signals)
      const category =
        job.score >= 70 ? 'High'
        : job.score >= 50 ? 'Good'
        : job.score >= 30 ? 'Review'
        : 'Skip';
      const opportunityReason = clientObj.opportunityReason || '';


      return {
        id: jobId,
        title: job.title || '',
        description: job.description || '',
        url: job.url,
        platform: job.platform || (job.source === 'upwork' ? 'Upwork' : job.source === 'freelancer' ? 'Freelancer' : 'Upwork'),
        budget: budgetStr,
        budgetType,
        score: job.score ?? (job.score === 0 ? 0 : 70),
        viewed: job.viewed || false,
        applied: isApplied,
        // Provider posting time. Empty string (not "now") when unknown, so the
        // UI can honestly say "Time unknown" instead of fabricating "Just now".
        postedAt: job.postedAt || job.postedDate || '',
        // Location
        country: countryVal,
        // Client
        clientName: clientNameVal,
        clientSpend,
        clientRating,
        clientReviews: clientRating ? `${clientRating}★` : '',
        paymentVerified,
         jobsPosted,
         memberSince,
         category,
         opportunityReason,
        // Job specifics
        connections: job.connectsRequired || job.connections || 0,
        skills: Array.isArray(job.skills) ? job.skills : [],
        experienceLevel,
        duration: job.duration || '',
        proposalCount: job.proposalCount || null,
        interviewingCount: job.interviewingCount || 0,
        hiresCount: job.hiresCount || 0,
        // Meta — "New" badge only for genuinely recent listings (posted within
        // the last 24 h), never for every row.
        client: clientObj,
        isNew: new Date(job.postedAt || job.postedDate || 0).getTime() > Date.now() - 24 * 60 * 60 * 1000,
      };
    });

    return NextResponse.json(jobs);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json([]);
  }
}