import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

function toSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'job';
}

function buildJobId(job: any) {
  const source = [job.url, job.platform, job.title].filter(Boolean).join('|');
  const digest = createHash('sha256').update(source || 'job').digest('hex').slice(0, 12);
  return `job-${digest}`;
}

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'sync-results.json');

    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const jobs = (data.jobs || []).map((job: any) => ({
        id: buildJobId(job),
        title: job.title,
        description: job.description || '',
        url: job.url,
        platform: job.platform || 'Upwork',
        budget: job.budget || 'Negotiable',
        score: job.score || Math.floor(Math.random() * 40) + 50,
        viewed: false,
        applied: false,
        postedAt: job.postedDate || new Date().toISOString(),
        company: job.company || 'Remote team',
        location: job.location || 'Remote',
        status: 'open'
      }));
      return NextResponse.json(jobs);
    }

    return NextResponse.json([]);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json([]);
  }
}