import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const appliedFile = path.join(process.cwd(), 'applied-jobs.json');
const cacheFile = path.join(process.cwd(), '.jobs-cache.json');

export async function POST(request: Request) {
  try {
    const { jobId, applied } = await request.json();
    const isApplied = applied !== false; // default true if toggled

    // 1. Update applied-jobs.json
    let appliedJobs: string[] = [];
    if (fs.existsSync(appliedFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(appliedFile, 'utf-8'));
        appliedJobs = data.applied || [];
      } catch {
        appliedJobs = [];
      }
    }

    if (isApplied) {
      if (!appliedJobs.includes(jobId)) appliedJobs.push(jobId);
    } else {
      appliedJobs = appliedJobs.filter(id => id !== jobId);
    }

    fs.writeFileSync(appliedFile, JSON.stringify({ applied: appliedJobs }, null, 2));

    // 2. Update .jobs-cache.json so dashboard & pipeline state syncs immediately
    if (fs.existsSync(cacheFile)) {
      try {
        const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        if (Array.isArray(cacheData.jobs)) {
          cacheData.jobs = cacheData.jobs.map((job: any) => {
            if (job.id === jobId || job.url === jobId) {
              return { ...job, applied: isApplied };
            }
            return job;
          });
          fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
        }
      } catch (err) {
        console.error('Error updating cache file:', err);
      }
    }

    return NextResponse.json({ success: true, jobId, applied: isApplied });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}