import { NextResponse } from 'next/server';
import { getRawJobs, getAppliedSet } from '@/lib/jobsCache';
import { shapeJobForUi } from '@/services/search/shape';

export async function GET() {
  try {
    const rawJobs = await getRawJobs();
    const appliedSet = await getAppliedSet();

    const jobs = rawJobs.map((job) => {
      const shaped = shapeJobForUi(job);
      const isApplied = Boolean(job.applied) || appliedSet.has(shaped.id) || appliedSet.has(shaped.url);
      return { ...shaped, applied: isApplied };
    });

    return NextResponse.json(jobs);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json([]);
  }
}