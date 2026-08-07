import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { jobId, applied, role } = body;
    const isApplied = applied !== false;

    // Only persist to server if the request is from an admin user
    // Guests' applied state is managed purely in sessionStorage on the client
    if (role !== 'admin') {
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
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}