export interface RawOpportunity {
  title: string;
  description: string;
  url: string;
  budget: string | { type?: string; amount?: number; min?: number; max?: number };
  platform: string;
  postedAt?: Date | string | null;
  postedDate?: Date | string | null;
  location?: string;
  company?: string;
  status?: string;
  country?: string;
  clientName?: string;
  clientSpend?: string;
  clientReviews?: string;
  connections?: number;
  skills?: string[];
  experienceLevel?: string | null;
  duration?: string | null;
  proposalCount?: number | null;
  interviewingCount?: number | null;
  hiresCount?: number | null;
  rating?: number | null;
  totalSpent?: number | null;
  paymentVerified?: boolean | null;
  lastActivityAt?: Date | string | null;
  openJobs?: number | null;
}

export interface CollectorInterface {
  name: string;
  fetch(): Promise<RawOpportunity[]>;
  run(): Promise<{ success: boolean; count: number; error?: string }>;
}
