import { NextResponse } from 'next/server';
import { getTodayCronLogs } from '../../../lib/cronLogger';

export async function GET() {
  try {
    const logs = getTodayCronLogs();
    return NextResponse.json({
      success: true,
      logs: logs
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
