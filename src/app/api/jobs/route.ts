import { NextResponse } from 'next/server';
import { buildJobFeed } from '@/lib/jobFeed';

export async function GET() {
  try {
    const jobs = await buildJobFeed();
    return NextResponse.json(jobs);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json([]);
  }
}
