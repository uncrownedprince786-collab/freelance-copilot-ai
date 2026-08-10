export interface JobBudget {
  type: "fixed" | "hourly";
  amount?: number;
  min?: number;
  max?: number;
}

export interface JobClient {
  name: string | null;
  country: string | null;
  rating: number | null;
  totalSpent: number | null;
  jobsPosted: number | null;
  totalHires: number | null;
  paymentVerified: boolean | null;
  lastActivityAt: Date | null;
  openJobs: number | null;
  opportunityReason?: string;
}

export interface Job {
  id: string;
  url: string;
  title: string;
  description: string;
  skills: string[];
  budget: JobBudget;
  experienceLevel: string | null;
  duration: string | null;
  connectsRequired: number | null;
  proposalCount: number | string | null;
  interviewingCount: number | null;
  hiresCount: number | null;
  postedAt: Date;
  client: JobClient;
  source: "upwork" | "freelancer" | "google" | "indeed" | "linkedin";
  score: number | null;
  fetchedAt: Date;
  // UI legacy compatibility fields
  platform?: string;
  country?: string;
  clientName?: string;
  clientSpend?: string;
  clientReviews?: string;
  connections?: number;
  budgetType?: string;
  isNew?: boolean;
  viewed?: boolean;
  applied?: boolean;
}
