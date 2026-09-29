// MUST be the first import. ES module imports are hoisted and evaluated
// before any module-body statement, so the previous form —
//   import * as dotenv from 'dotenv'; dotenv.config();
// — ran config() only AFTER ../src/providers/JobPipeline had already pulled
// in src/lib/db.ts and built the Prisma client. DATABASE_URL was therefore
// still unset at that moment, the client fell back to localhost:5432, and
// this script never once talked to the real database. Every write failed
// and it still reported success.
import 'dotenv/config';

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

    // A run that fetched jobs and then failed every write is a failed run.
    // This script printed success regardless, which is exactly how a sync
    // that never reached the database went unnoticed.
    if (pipeline.lastWriteFailures > 0) {
      console.error(
        `\nSync FAILED: ${pipeline.lastWriteFailures} database writes threw. ` +
        `Jobs were fetched but not persisted.`
      );
      process.exitCode = 1;
      return;
    }

    console.log('\nSync completed successfully!');
  } catch (err: any) {
    console.error('Pipeline execution error:', err.message);
    process.exitCode = 1;
  }
}

runSync();
