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

      // --- Budget: handle object vs string
      let budgetStr = 'Negotiable';
      if (typeof job.budget === 'object' && job.budget) {
        if (job.budget.amount) budgetStr = `$${job.budget.amount}`;
        else if (job.budget.min && job.budget.max && job.budget.min !== job.budget.max) budgetStr = `$${job.budget.min}–$${job.budget.max}`;
        else if (job.budget.min) budgetStr = `$${job.budget.min}`;
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
        score: job.score || 70,
        viewed: job.viewed || false,
        applied: isApplied,
        postedAt: job.postedAt || job.postedDate || new Date().toISOString(),
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
        // Meta
        client: clientObj,
        isNew: true,
      };
    });

    return NextResponse.json(jobs);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json([]);
  }
}