import { NextRequest, NextResponse } from 'next/server';
import { JobPipeline } from '../../../providers/JobPipeline';
import { prisma } from '@/lib/db';
import { isAdminRequest } from '@/lib/adminAuth';

async function runSync(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const expectedSecret = process.env.CRON_SECRET;

    // Fail-closed: authorize only with a valid Bearer CRON_SECRET (Vercel cron /
    // GitHub Actions) or a valid admin session cookie (manual sync from the UI).
    let authorized = false;
    if (authHeader && expectedSecret) {
      const providedSecret = authHeader.replace(/^Bearer\s+/i, '').trim();
      authorized = providedSecret === expectedSecret;
    }
    if (!authorized && (await isAdminRequest())) {
      authorized = true;
    }
    if (!authorized) {
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

export async function POST(req: NextRequest) {
  return runSync(req);
}

// Vercel Cron invokes the configured path with a GET request and sends
// `Authorization: Bearer <CRON_SECRET>` when the CRON_SECRET env var is set.
export async function GET(req: NextRequest) {
  return runSync(req);
}
