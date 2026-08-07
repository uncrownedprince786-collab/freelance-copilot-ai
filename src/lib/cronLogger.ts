import { prisma } from './db';

export interface CronLogEntry {
  id: string;
  timestamp: string;
  status: 'SUCCESS' | 'WARNING' | 'FAILED';
  jobsFetched: number;
  newJobsAdded: number;
  sourceSummary: string;
}

export async function logCronRun(entry: Omit<CronLogEntry, 'id' | 'timestamp'>): Promise<CronLogEntry> {
  const timestamp = new Date();
  try {
    const created = await prisma.cronLog.create({
      data: {
        timestamp,
        status: entry.status,
        jobsFetched: entry.jobsFetched,
        newJobsAdded: entry.newJobsAdded,
        sourceSummary: entry.sourceSummary,
      },
    });
    return {
      id: created.id,
      timestamp: created.timestamp.toISOString(),
      status: created.status as any,
      jobsFetched: created.jobsFetched,
      newJobsAdded: created.newJobsAdded,
      sourceSummary: created.sourceSummary,
    };
  } catch (err: any) {
    console.error('[cronLogger] Error writing log to DB:', err.message);
    return {
      id: `cron-${Date.now()}`,
      timestamp: timestamp.toISOString(),
      ...entry,
    };
  }
}

export async function getTodayCronLogs(): Promise<CronLogEntry[]> {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const logs = await prisma.cronLog.findMany({
      where: { timestamp: { gte: twentyFourHoursAgo } },
      orderBy: { timestamp: 'desc' },
    });
    return logs.map(l => ({
      id: l.id,
      timestamp: l.timestamp.toISOString(),
      status: l.status as any,
      jobsFetched: l.jobsFetched,
      newJobsAdded: l.newJobsAdded,
      sourceSummary: l.sourceSummary,
    }));
  } catch {
    return [];
  }
}
