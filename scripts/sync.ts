import * as dotenv from 'dotenv';
dotenv.config();

import { JobPipeline } from "../src/providers/JobPipeline";
import * as fs from 'fs';
import * as path from 'path';

async function runSync() {
  console.log('========================================');
  console.log('     LEAD HUNTER - PLUGGABLE PIPELINE   ');
  console.log('========================================\n');

  const cacheFile = path.join(process.cwd(), '.jobs-cache.json');
  const pipeline = new JobPipeline();

  try {
    const { jobs } = await pipeline.execute();

    console.log(`\nWriting ${jobs.length} processed jobs to cache...`);
    fs.writeFileSync(cacheFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      jobs: jobs
    }, null, 2));

    console.log('\nSync completed successfully!');
  } catch (err: any) {
    console.error('Pipeline execution error:', err.message);
  }
}

runSync();