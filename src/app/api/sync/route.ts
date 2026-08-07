import { NextRequest, NextResponse } from 'next/server';
import { JobPipeline } from '../../../providers/JobPipeline';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const pipeline = new JobPipeline();
    const jobs = await pipeline.execute();

    // Clear trends cache so next visit gets fresh AI analysis
    await prisma.systemKv.delete({ where: { key: 'trends_cache' } }).catch(() => {});


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