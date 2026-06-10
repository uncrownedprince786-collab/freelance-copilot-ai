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
}

export interface CollectorInterface {
  name: string;
  fetch(): Promise<RawOpportunity[]>;
  run(): Promise<{ success: boolean; count: number; error?: string }>;
}
