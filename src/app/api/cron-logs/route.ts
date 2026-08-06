import { NextResponse } from 'next/server';
import { getTodayCronLogs } from '../../../lib/cronLogger';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const logs = getTodayCronLogs();

    // Also return the current total in cache so UI can show it clearly
    let totalCachedJobs = 0;
    const cachePath = path.join(process.cwd(), '.jobs-cache.json');
    if (fs.existsSync(cachePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        totalCachedJobs = (data.jobs || []).length;
      } catch { /* ignore */ }
    }

    return NextResponse.json({
      success: true,
      logs,
      totalCachedJobs,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
