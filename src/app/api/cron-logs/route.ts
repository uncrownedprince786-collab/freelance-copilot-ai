import { NextResponse } from 'next/server';
import { getTodayCronLogs } from '../../../lib/cronLogger';
import { prisma } from '../../../lib/db';
import { isAdminRequest } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
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
