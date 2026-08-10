import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAdminRequest } from '@/lib/adminAuth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { jobId, applied } = body;
    const isApplied = applied !== false;

    // Only persist to server if the request carries a valid admin session.
    // Guests' applied state is managed purely in sessionStorage on the client.
    if (!(await isAdminRequest())) {
      return NextResponse.json({ success: true, jobId, applied: isApplied, persisted: false });
    }

    // Update in Prisma Opportunity table
    await prisma.opportunity.updateMany({
      where: {
        OR: [
          { id: jobId },
          { url: jobId },
        ],
      },
      data: {
        applied: isApplied,
        appliedAt: isApplied ? new Date() : null,
      },
    });

    return NextResponse.json({ success: true, jobId, applied: isApplied, persisted: true });
  } catch (error) {
    console.error('[jobs/applied] Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}