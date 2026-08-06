import * as fs from 'fs';
import * as path from 'path';

export interface CronLogEntry {
  id: string;
  timestamp: string;
  status: 'SUCCESS' | 'WARNING' | 'FAILED';
  jobsFetched: number;
  newJobsAdded: number;
  sourceSummary: string;
}

const cronLogsPath = path.join(process.cwd(), '.cron-logs.json');

export function logCronRun(entry: Omit<CronLogEntry, 'id' | 'timestamp'>): CronLogEntry {
  const newLog: CronLogEntry = {
    id: `cron-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString(),
    ...entry
  };

  let logs: CronLogEntry[] = [];
  try {
    if (fs.existsSync(cronLogsPath)) {
      const raw = fs.readFileSync(cronLogsPath, 'utf-8');
      logs = JSON.parse(raw);
    }
  } catch {
    logs = [];
  }

  // Prepend latest log
  logs.unshift(newLog);

  // Filter out logs older than 7 days from storage
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  logs = logs.filter(l => l.timestamp >= sevenDaysAgo);

  try {
    fs.writeFileSync(cronLogsPath, JSON.stringify(logs, null, 2));
  } catch (err: any) {
    console.error('[cronLogger] Error writing log:', err.message);
  }

  return newLog;
}

export function getTodayCronLogs(): CronLogEntry[] {
  try {
    if (!fs.existsSync(cronLogsPath)) return [];
    const raw = fs.readFileSync(cronLogsPath, 'utf-8');
    const logs: CronLogEntry[] = JSON.parse(raw);

    // Filter logs within the last 24 hours (today)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return logs.filter(l => l.timestamp >= twentyFourHoursAgo);
  } catch {
    return [];
  }
}
