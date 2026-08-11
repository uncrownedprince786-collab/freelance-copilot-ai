import * as dotenv from 'dotenv';
dotenv.config();
import { JobPipeline } from '../src/providers/JobPipeline';
import * as fs from 'fs';
import * as path from 'path';

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

async function runScheduledSync() {
  console.log(`[CronScheduler] Running scheduled sync at ${new Date().toISOString()}...`);
  try {
    const pipeline = new JobPipeline();
    const { jobs } = await pipeline.execute();

    const cacheFile = path.join(process.cwd(), '.jobs-cache.json');
    fs.writeFileSync(cacheFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      jobs: jobs
    }, null, 2));

    console.log(`[CronScheduler] Successfully updated ${jobs.length} jobs in cache.`);
  } catch (err: any) {
    console.error(`[CronScheduler] Sync failed:`, err.message);
  }
}

// Execute immediately on startup
runScheduledSync();

// Schedule every 4 hours
setInterval(() => {
  runScheduledSync();
}, FOUR_HOURS_MS);

console.log('[CronScheduler] Scheduled job hunter sync every 4 hours active.');
