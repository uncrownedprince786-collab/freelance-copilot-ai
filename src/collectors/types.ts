export interface RawOpportunity {
  title: string;
  description: string;
  url: string;
  /**
   * The source's own id for this listing, straight from its payload.
   *
   * A source fact, and the strongest identity signal there is. Carry it
   * whenever the source gives it: `lib/identity.ts` can recover an id from a
   * URL, but only 13% of live Freelancer URLs contain one.
   *
   * It must be in the SAME format as the id `extractSourceJobIdFromUrl`
   * recovers for that platform. Two formats for one source would defeat the
   * unique (platform, sourceJobId) index instead of enforcing it.
   */
  sourceJobId?: string | null;
  budget: string | { type?: string; amount?: number; min?: number; max?: number; currency?: string };
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
  jobsPosted?: number | null;
  totalHires?: number | null;
  paymentVerified?: boolean | null;
  lastActivityAt?: Date | string | null;
  openJobs?: number | null;
}

export interface CollectorInterface {
  name: string;
  fetch(): Promise<RawOpportunity[]>;
}
