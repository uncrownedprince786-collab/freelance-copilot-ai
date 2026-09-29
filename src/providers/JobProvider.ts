import { Job } from "../types/job";

export interface ProviderRunStatus {
  failed: boolean;
  reason: string;
  queriesTotal: number;
  queriesFailed: number;
  /** Billed provider runs this fetch actually cost. Every Apify query
   *  attempt is billed, including a failover retry on another account, so
   *  this is counted at the call site rather than inferred from the query
   *  list. Sources with no per-call cost report 0. */
  billedRuns?: number;
}

export interface JobProvider {
  name: string;
  fetchJobs(): Promise<Job[]>;
  // Set after fetchJobs() by providers that can distinguish a genuine provider
  // failure (no token / API / quota / timeout / actor failure) from a low- or
  // zero-result run. JobPipeline uses it to decide whether a fallback may run.
  lastRunStatus?: ProviderRunStatus;
}
