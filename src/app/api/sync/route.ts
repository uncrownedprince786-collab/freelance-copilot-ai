import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const cacheFile = path.join(process.cwd(), 'sync-results.json');

export async function POST() {
  try {
    let existingJobs: any[] = [];
    let existingJobUrls: Set<string> = new Set();
    
    if (fs.existsSync(cacheFile)) {
      const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      existingJobs = cache.jobs || [];
      existingJobUrls = new Set(existingJobs.map((j: any) => j.url));
    }
    
    console.log('Running sync to fetch new jobs...');
    
    const { stdout, stderr } = await execAsync('npm run sync --silent', {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_SYNC: 'true' }
    });
    
    if (stderr && !stderr.includes('verbose')) {
      console.error('Sync error:', stderr);
    }
    
    let newJobs: any[] = [];
    if (fs.existsSync(cacheFile)) {
      const newCache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      const allNewJobs = newCache.jobs || [];
      
      newJobs = allNewJobs.filter((job: any) => !existingJobUrls.has(job.url));
      
      const newJobsWithFlag = newJobs.map((job: any) => ({
        ...job,
        isNew: true
      }));
      
      const updatedJobs = [...newJobsWithFlag, ...existingJobs];
      
      fs.writeFileSync(cacheFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        totalJobs: updatedJobs.length,
        platforms: newCache.platforms,
        jobs: updatedJobs
      }, null, 2));
    }
    
    return NextResponse.json({
      success: true,
      newJobs: newJobs.length,
      message: newJobs.length > 0 ? `Found ${newJobs.length} new opportunities` : 'No new opportunities found'
    });
    
  } catch (error: any) {
    console.error('Sync API error:', error);
    return NextResponse.json({
      success: false,
      newJobs: 0,
      message: 'Sync failed: ' + error.message
    }, { status: 500 });
  }
}