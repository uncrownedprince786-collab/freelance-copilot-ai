import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const appliedFile = path.join(process.cwd(), 'applied-jobs.json');

export async function POST(request: Request) {
  try {
    const { jobId } = await request.json();
    
    let appliedJobs: string[] = [];
    if (fs.existsSync(appliedFile)) {
      const data = JSON.parse(fs.readFileSync(appliedFile, 'utf-8'));
      appliedJobs = data.applied || [];
    }
    
    if (!appliedJobs.includes(jobId)) {
      appliedJobs.push(jobId);
    }
    
    fs.writeFileSync(appliedFile, JSON.stringify({ applied: appliedJobs }, null, 2));
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}