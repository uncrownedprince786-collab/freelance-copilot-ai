import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST(request: Request) {
  try {
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
  } catch (error) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}