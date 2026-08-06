import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const jobsCachePath = path.join(process.cwd(), '.jobs-cache.json');
    const syncResultsPath = path.join(process.cwd(), 'sync-results.json');
    const appliedPath = path.join(process.cwd(), 'applied-jobs.json');

    let rawJobs: any[] = [];
    let appliedSet = new Set<string>();

    if (fs.existsSync(appliedPath)) {
      try {
        const appData = JSON.parse(fs.readFileSync(appliedPath, 'utf-8'));
        if (Array.isArray(appData.applied)) {
          appliedSet = new Set(appData.applied);
        }
      } catch {}
    }

    if (fs.existsSync(jobsCachePath)) {
      const data = JSON.parse(fs.readFileSync(jobsCachePath, 'utf-8'));
      rawJobs = data.jobs || [];
    } else if (fs.existsSync(syncResultsPath)) {
      const data = JSON.parse(fs.readFileSync(syncResultsPath, 'utf-8'));
      rawJobs = data.jobs || [];
    }

    const jobs = rawJobs.map((job: any) => {
      const jobId = job.id || job.url;
      const isApplied = Boolean(job.applied) || appliedSet.has(jobId) || appliedSet.has(job.url);
      const clientObj = job.client || {};
      const countryVal = job.country || clientObj.country || job.location || 'Remote';
      const clientNameVal = job.clientName || clientObj.name || job.company || 'Client';

      return {
        id: jobId,
        title: job.title,
        description: job.description || '',
        url: job.url,
        platform: job.platform || (job.source === 'upwork' ? 'Upwork' : job.source === 'freelancer' ? 'Freelancer' : 'Upwork'),
        budget: typeof job.budget === 'object' 
          ? (job.budget.amount ? `$${job.budget.amount}` : (job.budget.min ? `$${job.budget.min}-$${job.budget.max}` : 'Negotiable'))
          : (job.budget || 'Negotiable'),
        score: job.score || 70,
        viewed: job.viewed || false,
        applied: isApplied,
        postedAt: job.postedAt || job.postedDate || new Date().toISOString(),
        country: countryVal,
        clientName: clientNameVal,
        clientSpend: job.clientSpend || (clientObj.totalSpent ? `$${clientObj.totalSpent.toLocaleString()}` : ''),
        clientReviews: clientObj.rating ? `${clientObj.rating}★` : '',
        connections: job.connectsRequired || job.connections || 0,
        skills: job.skills || [],
        client: clientObj,
        isNew: true
      };
    });

    return NextResponse.json(jobs);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json([]);
  }
}