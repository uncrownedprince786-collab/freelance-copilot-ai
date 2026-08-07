import { prisma } from './db';

export interface RawJob {
  id?: string;
  url?: string;
  title?: string;
  description?: string;
  skills?: string[];
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
  [key: string]: any;
}

export async function getRawJobs(): Promise<RawJob[]> {
  try {
    const dbOps = await prisma.opportunity.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return dbOps.map(op => {
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
        viewed: op.viewed,
        applied: op.applied,
        postedAt: op.createdAt.toISOString(),
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
