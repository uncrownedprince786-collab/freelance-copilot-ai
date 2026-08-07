import { NextResponse } from 'next/server';
import { getTodayCronLogs } from '../../../lib/cronLogger';
import { prisma } from '../../../lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const logs = await getTodayCronLogs();
    const totalCachedJobs = await prisma.opportunity.count().catch(() => 0);

    return NextResponse.json({
      success: true,
      logs,
      totalCachedJobs,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
