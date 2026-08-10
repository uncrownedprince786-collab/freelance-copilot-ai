/** UI-shaped job object (what /api/jobs and /api/jobs/search return). */
export interface SearchResultJob {
  id: string;
  title: string;
  description: string;
  url: string;
  platform: string;
  budget: string;
  budgetType: string;
  score: number;
  viewed: boolean;
  applied: boolean;
  postedAt: string;
  country: string;
  clientName: string;
  clientSpend: string;
  clientRating: string;
  clientReviews: string;
  paymentVerified: boolean;
  jobsPosted: number | null;
  memberSince: string;
  connections: number;
  skills: string[];
  experienceLevel: string;
  duration: string;
  proposalCount: number | null;
  interviewingCount: number;
  hiresCount: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: Record<string, any>;
  isNew: boolean;
}

type ShapeSource = {
  id?: string;
  url?: string;
  title?: string;
  description?: string;
  skills?: string[] | unknown;
  budget?: unknown;
  score?: number | null;
  postedAt?: string | Date;
  postedDate?: string;
  location?: string;
  client?: unknown;
  clientName?: string;
  company?: string;
  country?: string;
  clientSpend?: unknown;
  duration?: string | null;
  connectsRequired?: number | null;
  connections?: number;
  proposalCount?: number | string | null;
  interviewingCount?: number | null;
  hiresCount?: number | null;
  platform?: string;
  source?: string;
  experienceLevel?: string | null;
  viewed?: boolean;
  applied?: boolean;
};

/**
 * Single source of truth for shaping a stored/pipeline job into the UI object
 * consumed by the jobs page. Used by both /api/jobs and the smart search API.
 */
export function shapeJobForUi(job: ShapeSource): SearchResultJob {
  const jobId = (job.id || job.url || '') as string;
  const clientObj = (job.client || {}) as Record<string, unknown>;

  // Country: only show real countries, never "Remote" or generic.
  const rawCountry = (job.country || clientObj.country || job.location || '') as string;
  const countryVal = rawCountry && rawCountry.toLowerCase() !== 'remote' ? rawCountry : '';

  // Client name: filter generic placeholders.
  const rawClientName = (job.clientName || clientObj.name || job.company || '') as string;
  const genericNames = ['freelancer client', 'upwork client', 'client', ''];
  const clientNameVal = !rawClientName || genericNames.includes(rawClientName.toLowerCase()) ? '' : rawClientName;

  // Budget: object vs string.
  const budget = job.budget as unknown;
  let budgetStr = 'Negotiable';
  if (typeof budget === 'object' && budget && (budget as { amount?: unknown }).amount) {
    budgetStr = `$${(budget as { amount?: number }).amount}`;
  } else if (typeof budget === 'object' && budget && (budget as { min?: number; max?: number }).min && (budget as { min?: number; max?: number }).max) {
    const min = (budget as { min?: number }).min as number;
    const max = (budget as { max?: number }).max as number;
    budgetStr = min !== max ? `$${min}–$${max}` : `$${min}`;
  } else if (typeof budget === 'object' && budget && (budget as { min?: number }).min) {
    budgetStr = `$${(budget as { min?: number }).min}`;
  } else if (typeof budget === 'object' && budget && (budget as { type?: string }).type === 'hourly') {
    budgetStr = 'Hourly';
  } else if (typeof budget === 'string' && budget) {
    budgetStr = budget;
  }

  const budgetType = typeof budget === 'object' && budget && (budget as { type?: string }).type
    ? ((budget as { type: string }).type === 'hourly' ? 'Hourly Rate' : 'Fixed Price')
    : '';

  const expRaw = typeof job.experienceLevel === 'string' ? job.experienceLevel : '';
  const experienceLevel = expRaw ? expRaw.replace('Level', '').replace(/([A-Z])/g, ' $1').trim() : '';

  let clientSpend = '';
  if (job.clientSpend) clientSpend = String(job.clientSpend);
  else if (typeof clientObj.totalSpent === 'number' && clientObj.totalSpent > 0) clientSpend = `$${clientObj.totalSpent.toLocaleString()}`;

  const clientRating = typeof clientObj.rating === 'number' ? clientObj.rating.toFixed(1) : typeof clientObj.rating === 'string' ? Number(clientObj.rating).toFixed(1) : '';
  const paymentVerified = clientObj.paymentVerified === true;
  const jobsPosted = typeof clientObj.jobsPosted === 'number' ? clientObj.jobsPosted : null;

  return {
    id: jobId,
    title: (job.title || '') as string,
    description: (job.description || '') as string,
    url: (job.url || '') as string,
    platform: (job.platform || (job.source === 'upwork' ? 'Upwork' : job.source === 'freelancer' ? 'Freelancer' : 'Upwork')) as string,
    budget: budgetStr,
    budgetType,
    score: (job.score || 70) as number,
    viewed: Boolean(job.viewed),
    applied: Boolean(job.applied),
    postedAt: (() => {
      const raw = job.postedAt ?? job.postedDate;
      if (raw instanceof Date) return raw.toISOString();
      if (typeof raw === 'string' && raw) return raw;
      return new Date().toISOString();
    })(),
    country: countryVal,
    clientName: clientNameVal,
    clientSpend,
    clientRating,
    clientReviews: clientRating ? `${clientRating}★` : '',
    paymentVerified,
    jobsPosted,
    memberSince: (clientObj.memberSince || '') as string,
    connections: (job.connectsRequired || job.connections || 0) as number,
    skills: Array.isArray(job.skills) ? (job.skills as string[]) : [],
    experienceLevel,
    duration: (job.duration || '') as string,
    proposalCount: (job.proposalCount || null) as number | null,
    interviewingCount: (job.interviewingCount || 0) as number,
    hiresCount: (job.hiresCount || 0) as number,
    client: clientObj,
    isNew: true,
  };
}
