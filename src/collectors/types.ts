export interface RawOpportunity {
  title: string;
  description: string;
  url: string;
  budget: string;
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
}

export interface CollectorInterface {
  name: string;
  fetch(): Promise<RawOpportunity[]>;
  run(): Promise<{ success: boolean; count: number; error?: string }>;
}
