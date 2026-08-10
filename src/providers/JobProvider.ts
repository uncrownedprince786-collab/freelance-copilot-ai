import { Job } from "../types/job";

export interface JobProvider {
  name: string;
  fetchJobs(searchQuery?: string): Promise<Job[]>;
}
