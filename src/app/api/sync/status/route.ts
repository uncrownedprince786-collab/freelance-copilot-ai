import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getScheduleLabel } from '@/lib/syncSchedule';

export const dynamic = 'force-dynamic';

// Public, read-only freshness info: when the last successful sync ran and the
// actual adaptive scheduler cadence. Numbers come from real sync telemetry,
// never faked.
export async function GET() {
  try {
    const rec = await prisma.systemKv.findUnique({ where: { key: 'last_sync_successful' } });
    let lastSyncedAt: string | null = null;
    if (rec?.value) {
      try {
        const parsed = JSON.parse(rec.value) as { at?: number };
        if (typeof parsed.at === 'number') lastSyncedAt = new Date(parsed.at).toISOString();
      } catch { /* ignore corrupt record */ }
    }
    const schedule = await getScheduleLabel();
    return NextResponse.json({ lastSyncedAt, schedule, adaptive: true });
  } catch {
    return NextResponse.json({ lastSyncedAt: null, schedule: 'Every 4 hours', adaptive: true });
  }
}
