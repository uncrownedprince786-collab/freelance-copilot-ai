import { prisma } from './db';

export interface RawJob {
  id?: string;
  url?: string;
  title?: string;
  description?: string;
  skills?: string[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  budget?: any;
  experienceLevel?: string;
  duration?: string;
  connectsRequired?: number;
  connections?: number;
  proposalCount?: number | null;
  interviewingCount?: number;
  hiresCount?: number;
  postedAt?: string;
  postedDate?: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: Record<string, any>;
  source?: string;
  score?: number;
  fetchedAt?: string;
  platform?: string;
  country?: string;
  clientName?: string;
  clientSpend?: string;
  viewed?: boolean;
  applied?: boolean;
  isNew?: boolean;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export async function getRawJobs(limit = 500): Promise<RawJob[]> {
  try {
    const dbOps = await prisma.opportunity.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return dbOps.map(op => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      let budgetVal: any = op.budget;
      try { budgetVal = JSON.parse(op.budget); } catch {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      let client: Record<string, any> = {};
      try { client = op.rawPayload ? JSON.parse(op.rawPayload) : {}; } catch {}
      // createdAt is the immutable first-seen retention anchor. The true source
      // posting time is preserved in rawPayload.postedAt (JobPipeline.saveStore)
      // and returned here for display/activity; fall back to createdAt.
      const sourcePostedMs = typeof client?.postedAt === 'string' ? new Date(client.postedAt).getTime() : NaN;
      const postedAt = Number.isFinite(sourcePostedMs) && sourcePostedMs > 0
        ? new Date(Math.min(sourcePostedMs, Date.now())).toISOString()
        : op.createdAt.toISOString();
      return {
        id: op.id,
        url: op.url,
        title: op.title,
        description: op.description,
        budget: budgetVal,
        budgetType: op.budgetType || '',
        score: op.score,
        platform: op.platform,
        viewed: op.viewed,
        applied: op.applied,
        postedAt,
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
        client,
      };
    });
  } catch {
    return [];
  }
}

export async function getAppliedSet(): Promise<Set<string>> {
  try {
    const appliedOps = await prisma.opportunity.findMany({
      where: { applied: true },
      select: { id: true, url: true },
    });
    const set = new Set<string>();
    appliedOps.forEach(op => {
      set.add(op.id);
      if (op.url) set.add(op.url);
    });
    return set;
  } catch {
    return new Set();
  }
}
