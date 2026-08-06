import { NextResponse } from 'next/server';
import { JobPipeline } from '../../../providers/JobPipeline';
import * as fs from 'fs';
import * as path from 'path';

export async function POST() {
  try {
    const pipeline = new JobPipeline();
    const jobs = await pipeline.execute();

    const cacheFile = path.join(process.cwd(), '.jobs-cache.json');
    fs.writeFileSync(cacheFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      jobs: jobs
    }, null, 2));

    // Clear trends cache so next visit gets fresh AI analysis
    const trendsCacheFile = path.join(process.cwd(), '.trends-cache.json');
    if (fs.existsSync(trendsCacheFile)) {
      try { fs.unlinkSync(trendsCacheFile); } catch { /* non-critical */ }
    }

    return NextResponse.json({
      success: true,
      newJobs: jobs.length,
      jobs: jobs
    });
  } catch (err: any) {
    console.error('API sync error:', err);
    return NextResponse.json({ error: 'Sync failed: ' + err.message }, { status: 500 });
  }
}