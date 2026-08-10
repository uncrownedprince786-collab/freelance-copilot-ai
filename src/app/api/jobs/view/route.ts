import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAuthenticatedRequest } from '@/lib/adminAuth';

export async function POST(request: Request) {
  try {
    if (!(await isAuthenticatedRequest())) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { jobId } = await request.json();
    if (jobId) {
      await prisma.opportunity.updateMany({
        where: {
          OR: [
            { id: jobId },
            { url: jobId },
          ],
        },
        data: {
          viewed: true,
          viewedAt: new Date(),
        },
      });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}