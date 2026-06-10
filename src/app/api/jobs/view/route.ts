import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const viewsFile = path.join(process.cwd(), 'viewed-jobs.json');

export async function POST(request: Request) {
  try {
    const { jobId } = await request.json();
    
    let viewedJobs: string[] = [];
    if (fs.existsSync(viewsFile)) {
      const data = JSON.parse(fs.readFileSync(viewsFile, 'utf-8'));
      viewedJobs = data.viewed || [];
    }
    
    if (!viewedJobs.includes(jobId)) {
      viewedJobs.push(jobId);
    }
    
    fs.writeFileSync(viewsFile, JSON.stringify({ viewed: viewedJobs }, null, 2));
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}