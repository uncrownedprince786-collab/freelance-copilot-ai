import { Job } from "../types/job";

export interface ProviderRunStatus {
  failed: boolean;
  reason: string;
  queriesTotal: number;
  queriesFailed: number;
}

export interface JobProvider {
  name: string;
  fetchJobs(): Promise<Job[]>;
  // Set after fetchJobs() by providers that can distinguish a genuine provider
  // failure (no token / API / quota / timeout / actor failure) from a low- or
  // zero-result run. JobPipeline uses it to decide whether a fallback may run.
  lastRunStatus?: ProviderRunStatus;
}
