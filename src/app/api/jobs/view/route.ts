import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAdminRequest } from '@/lib/adminAuth';

// Marks a job as viewed in the database. This is an admin-only operation:
// guest views are tracked client-side (sessionStorage) and must not write to
// the shared opportunities table.
export async function POST(request: Request) {
  try {
    if (!(await isAdminRequest())) {
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