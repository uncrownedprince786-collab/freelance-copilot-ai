import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const platform = url.searchParams.get('platform');
    const q = url.searchParams.get('q');
    const sort = url.searchParams.get('sort') || 'score';
    const minScore = url.searchParams.get('minScore');
    const jobType = url.searchParams.get('jobType');
    const country = url.searchParams.get('country');
    const cursor = url.searchParams.get('cursor');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 500);
    const countOnly = url.searchParams.get('count') === '1';
    const jobId = url.searchParams.get('id');

    // Single-job lookup — used by agent card clicks and job detail page.
    if (jobId) {
      const row = await prisma.opportunity.findUnique({
        where: { id: jobId },
        select: {
          id: true, url: true, title: true, description: true, budget: true,
          budgetType: true, score: true, platform: true, viewed: true, applied: true,
          createdAt: true, country: true, clientName: true, clientSpend: true,
          clientReviews: true, connections: true, skills: true, experienceLevel: true,
          duration: true, proposalCount: true, interviewingCount: true, hiresCount: true,
          paymentVerified: true, clientRating: true, jobsPosted: true, rawPayload: true,
        },
      });
      if (!row) return NextResponse.json({ jobs: [] });

      let budgetVal: unknown = row.budget;
      try { budgetVal = JSON.parse(row.budget); } catch { /* keep string */ }
      let client: Record<string, unknown> = {};
      try { client = row.rawPayload ? JSON.parse(row.rawPayload) : {}; } catch { /* ignore */ }
      const sourcePostedMs = typeof client?.postedAt === 'string' ? new Date(client.postedAt as string).getTime() : NaN;
      const postedAt = Number.isFinite(sourcePostedMs) && sourcePostedMs > 0
        ? new Date(Math.min(sourcePostedMs, Date.now())).toISOString()
        : row.createdAt.toISOString();
      const rawCountry = row.country || (client.country as string) || '';
      const countryVal = rawCountry && rawCountry.toLowerCase() !== 'remote' ? rawCountry : '';
      let budgetStr = 'Negotiable';
      if (typeof budgetVal === 'object' && budgetVal) {
        const b = budgetVal as Record<string, unknown>;
        const sym = (b.currency as string) || '$';
        const fmt = (n: number) => Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
        const rate = b.type === 'hourly' ? '/hr' : '';
        const bAmt = Number(b.amount); const bMin = Number(b.min); const bMax = Number(b.max);
        if (Number.isFinite(bAmt) && bAmt > 0) budgetStr = `${sym}${fmt(bAmt)}${rate}`;
        else if (Number.isFinite(bMin) && Number.isFinite(bMax) && bMin !== bMax) budgetStr = `${sym}${fmt(bMin)}–${sym}${fmt(bMax)}${rate}`;
        else if (Number.isFinite(bMin)) budgetStr = `${sym}${fmt(bMin)}${rate}`;
        else if (b.type === 'hourly') budgetStr = 'Hourly';
      } else if (typeof budgetVal === 'string' && budgetVal) { budgetStr = budgetVal; }
      const budgetType = (typeof budgetVal === 'object' && budgetVal && 'type' in budgetVal)
        ? ((budgetVal as Record<string, unknown>).type === 'hourly' ? 'Hourly Rate' : 'Fixed Price') : '';
      const clientRating = row.clientRating ? Number(row.clientRating).toFixed(1) : '';
      const postedMs = new Date(postedAt).getTime();
      const isFresh = Number.isFinite(postedMs) && postedMs > 0 && Date.now() - postedMs < 24 * 60 * 60 * 1000;

      const job = {
        id: row.id, title: row.title || '', description: row.description || '',
        url: row.url, platform: row.platform || 'Upwork', budget: budgetStr, budgetType,
        score: row.score ?? 70, viewed: row.viewed || false, applied: row.applied || false,
        postedAt, country: countryVal, clientName: row.clientName || '',
        clientSpend: row.clientSpend || '', clientReviews: clientRating ? `${clientRating}★` : '',
        paymentVerified: row.paymentVerified || false, jobsPosted: row.jobsPosted || null,
        connections: row.connections || 0, skills: row.skills ? row.skills.split(',') : [],
        experienceLevel: row.experienceLevel || '', duration: row.duration || '',
        proposalCount: typeof row.proposalCount === 'number' ? row.proposalCount : null,
        interviewingCount: row.interviewingCount || 0, hiresCount: row.hiresCount || 0,
        category: row.score >= 70 ? 'High' : row.score >= 50 ? 'Good' : row.score >= 30 ? 'Review' : 'Skip',
        opportunityReason: (client.opportunityReason as string) || '',
        actFast: isFresh && typeof row.proposalCount === 'number' && row.proposalCount <= 5,
        isNew: new Date(postedAt).getTime() > Date.now() - 24 * 60 * 60 * 1000,
        clientKey: (client.clientKey as string) || null,
        repeatClient: false, repeatClientCount: 0, memberSince: '',
      };
      return NextResponse.json({ jobs: [job] });
    }

    const where: Prisma.OpportunityWhereInput = {};

    if (platform && platform !== 'all') {
      where.platform = platform;
    }

    if (q && q.trim()) {
      const tokens = q.trim().split(/\s+/).filter(Boolean);
      if (tokens.length > 0) {
        where.OR = tokens.map(t => ({
          OR: [
            { title: { contains: t, mode: 'insensitive' as const } },
            { description: { contains: t, mode: 'insensitive' as const } },
            { skills: { contains: t, mode: 'insensitive' as const } },
            { clientName: { contains: t, mode: 'insensitive' as const } },
          ],
        }));
      }
    }

    if (minScore) {
      where.score = { gte: parseInt(minScore, 10) };
    }

    if (jobType && jobType !== 'all') {
      where.budgetType = { contains: jobType, mode: 'insensitive' };
    }

    if (country && country !== 'all') {
      where.country = country;
    }

    if (countOnly) {
      const count = await prisma.opportunity.count({ where });
      return NextResponse.json({ count });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let orderBy: any;
    switch (sort) {
      case 'date':
        orderBy = { createdAt: 'desc' };
        break;
      case 'competition':
        orderBy = [
          { proposalCount: 'asc' },
          { createdAt: 'desc' },
        ];
        break;
      case 'budget':
        orderBy = { createdAt: 'desc' };
        break;
      case 'score':
      default:
        orderBy = [
          { score: 'desc' },
          { createdAt: 'desc' },
        ];
        break;
    }

    const take = limit + 1;
    const queryArgs: Prisma.OpportunityFindManyArgs = {
      where,
      orderBy,
      take,
      select: {
        id: true,
        url: true,
        title: true,
        description: true,
        budget: true,
        budgetType: true,
        score: true,
        platform: true,
        viewed: true,
        applied: true,
        createdAt: true,
        country: true,
        clientName: true,
        clientSpend: true,
        clientReviews: true,
        connections: true,
        skills: true,
        experienceLevel: true,
        duration: true,
        proposalCount: true,
        interviewingCount: true,
        hiresCount: true,
        paymentVerified: true,
        clientRating: true,
        jobsPosted: true,
        rawPayload: true,
      },
    };

    if (cursor) {
      const cursorJob = await prisma.opportunity.findUnique({
        where: { id: cursor },
        select: { createdAt: true, id: true },
      });
      if (cursorJob) {
        queryArgs.cursor = { id: cursor };
        queryArgs.skip = 1;
      }
    }

    const rows = await prisma.opportunity.findMany(queryArgs);
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : null;

    const jobs = data.map(row => {
      let budgetVal: unknown = row.budget;
      try { budgetVal = JSON.parse(row.budget); } catch { /* keep string */ }

      let client: Record<string, unknown> = {};
      try { client = row.rawPayload ? JSON.parse(row.rawPayload) : {}; } catch { /* ignore */ }

      const sourcePostedMs = typeof client?.postedAt === 'string' ? new Date(client.postedAt as string).getTime() : NaN;
      const postedAt = Number.isFinite(sourcePostedMs) && sourcePostedMs > 0
        ? new Date(Math.min(sourcePostedMs, Date.now())).toISOString()
        : row.createdAt.toISOString();

      const rawCountry = row.country || (client.country as string) || '';
      const countryVal = rawCountry && rawCountry.toLowerCase() !== 'remote' ? rawCountry : '';

      let budgetStr = 'Negotiable';
      if (typeof budgetVal === 'object' && budgetVal) {
        const b = budgetVal as Record<string, unknown>;
        const sym = (b.currency as string) || '$';
        const fmt = (n: number) => Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
        const rate = b.type === 'hourly' ? '/hr' : '';
        const bAmt = Number(b.amount);
        const bMin = Number(b.min);
        const bMax = Number(b.max);
        if (Number.isFinite(bAmt) && bAmt > 0) budgetStr = `${sym}${fmt(bAmt)}${rate}`;
        else if (Number.isFinite(bMin) && Number.isFinite(bMax) && bMin !== bMax) budgetStr = `${sym}${fmt(bMin)}–${sym}${fmt(bMax)}${rate}`;
        else if (Number.isFinite(bMin)) budgetStr = `${sym}${fmt(bMin)}${rate}`;
        else if (b.type === 'hourly') budgetStr = 'Hourly';
      } else if (typeof budgetVal === 'string' && budgetVal) {
        budgetStr = budgetVal;
      }

      const budgetType = (typeof budgetVal === 'object' && budgetVal && 'type' in budgetVal)
        ? ((budgetVal as Record<string, unknown>).type === 'hourly' ? 'Hourly Rate' : 'Fixed Price')
        : '';

      const clientRating = row.clientRating ? Number(row.clientRating).toFixed(1) : '';

      const category = row.score >= 70 ? 'High' : row.score >= 50 ? 'Good' : row.score >= 30 ? 'Review' : 'Skip';
      const opportunityReason = (client.opportunityReason as string) || '';

      const postedMs = new Date(postedAt).getTime();
      const isFresh = Number.isFinite(postedMs) && postedMs > 0 && Date.now() - postedMs < 24 * 60 * 60 * 1000;

      return {
        id: row.id,
        title: row.title || '',
        description: row.description || '',
        url: row.url,
        platform: row.platform || 'Upwork',
        budget: budgetStr,
        budgetType,
        score: row.score ?? 70,
        viewed: row.viewed || false,
        applied: row.applied || false,
        postedAt,
        country: countryVal,
        clientName: row.clientName || '',
        clientSpend: row.clientSpend || '',
        clientReviews: clientRating ? `${clientRating}★` : '',
        paymentVerified: row.paymentVerified || false,
        jobsPosted: row.jobsPosted || null,
        connections: row.connections || 0,
        skills: row.skills ? row.skills.split(',') : [],
        experienceLevel: row.experienceLevel || '',
        duration: row.duration || '',
        proposalCount: typeof row.proposalCount === 'number' ? row.proposalCount : null,
        interviewingCount: row.interviewingCount || 0,
        hiresCount: row.hiresCount || 0,
        category,
        opportunityReason,
        actFast: isFresh && typeof row.proposalCount === 'number' && row.proposalCount <= 5,
        isNew: new Date(postedAt).getTime() > Date.now() - 24 * 60 * 60 * 1000,
        clientKey: (client.clientKey as string) || null,
        repeatClient: false,
        repeatClientCount: 0,
        memberSince: '',
      };
    });

    return NextResponse.json({ jobs, nextCursor, hasMore });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ jobs: [], nextCursor: null, hasMore: false });
  }
}
