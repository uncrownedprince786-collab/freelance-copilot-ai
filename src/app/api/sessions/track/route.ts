import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

const sessionsPath = path.join(process.cwd(), '.sessions.json');

interface SessionEvent {
  guestId: string;
  role: 'admin' | 'guest';
  event: string;
  detail?: string;
  timestamp: string;
}

interface Session {
  guestId: string;
  role: 'admin' | 'guest';
  startTime: string;
  endTime?: string;
  durationMs?: number;
  events: SessionEvent[];
  lastSeen: string;
}

function readSessions(): Session[] {
  try {
    if (!fs.existsSync(sessionsPath)) return [];
    return JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
  } catch { return []; }
}

function writeSessions(sessions: Session[]) {
  // Keep only last 40 days
  const cutoff = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const filtered = sessions.filter(s => s.startTime >= cutoff);
  fs.writeFileSync(sessionsPath, JSON.stringify(filtered, null, 2));
}

export async function POST(req: NextRequest) {
  try {
    const body: SessionEvent = await req.json();
    const sessions = readSessions();

    const idx = sessions.findIndex(s => s.guestId === body.guestId);

    if (body.event === 'session_start') {
      const newSession: Session = {
        guestId: body.guestId,
        role: body.role,
        startTime: body.timestamp,
        lastSeen: body.timestamp,
        events: [{ ...body }],
      };
      if (idx >= 0) sessions[idx] = newSession;
      else sessions.unshift(newSession);
    } else if (body.event === 'session_end') {
      if (idx >= 0) {
        sessions[idx].endTime = body.timestamp;
        sessions[idx].lastSeen = body.timestamp;
        sessions[idx].durationMs = new Date(body.timestamp).getTime() - new Date(sessions[idx].startTime).getTime();
        sessions[idx].events.push({ ...body });
      }
    } else {
      // Activity event
      if (idx >= 0) {
        sessions[idx].lastSeen = body.timestamp;
        sessions[idx].events.push({ ...body });
      } else {
        // Session started before tracking was set up
        sessions.unshift({
          guestId: body.guestId,
          role: body.role,
          startTime: body.timestamp,
          lastSeen: body.timestamp,
          events: [{ ...body }],
        });
      }
    }

    writeSessions(sessions);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const adminToken = req.headers.get('x-admin-token');
  if (adminToken !== 'lh_admin_session_token') {
    // Allow from server-side admin page requests
  }
  const sessions = readSessions();
  // Sort newest first
  sessions.sort((a, b) => b.startTime.localeCompare(a.startTime));
  return NextResponse.json({ sessions });
}
