import fs from 'fs';
import path from 'path';

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

const jobsCachePath = path.join(process.cwd(), '.jobs-cache.json');
const syncResultsPath = path.join(process.cwd(), 'sync-results.json');

export function getRawJobs(): RawJob[] {
  try {
    if (fs.existsSync(jobsCachePath)) {
      const data = JSON.parse(fs.readFileSync(jobsCachePath, 'utf-8'));
      return data.jobs || [];
    }
    if (fs.existsSync(syncResultsPath)) {
      const data = JSON.parse(fs.readFileSync(syncResultsPath, 'utf-8'));
      return data.jobs || [];
    }
    return [];
  } catch {
    return [];
  }
}

export function getAppliedSet(): Set<string> {
  const appliedPath = path.join(process.cwd(), 'applied-jobs.json');
  try {
    if (!fs.existsSync(appliedPath)) return new Set();
    const appData = JSON.parse(fs.readFileSync(appliedPath, 'utf-8'));
    return Array.isArray(appData.applied) ? new Set<string>(appData.applied) : new Set<string>();
  } catch {
    return new Set();
  }
}
