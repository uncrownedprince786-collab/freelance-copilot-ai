import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAdminRequest } from '@/lib/adminAuth';

interface SessionEvent {
  guestId: string;
  role: 'admin' | 'guest';
  event: string;
  detail?: string;
  timestamp: string;
  country?: string;
}

function getVisitorCountry(req: NextRequest): string {
  return req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry') || '';
}

export async function POST(req: NextRequest) {
  try {
    const body: SessionEvent = await req.json();
    if (typeof body?.guestId !== 'string' || body.guestId.trim().length === 0 || body.guestId.length > 100) {
      return NextResponse.json({ ok: false, error: 'Missing or invalid guestId' }, { status: 400 });
    }

    const role = body.role === 'admin' ? 'admin' : 'guest';
    const country = getVisitorCountry(req);
    const existing = await prisma.userSession.findUnique({
      where: { guestId: body.guestId }
    });

    let events: SessionEvent[] = existing?.events ? JSON.parse(existing.events) : [];
    events.push({ ...body, role, country });
    if (events.length > 500) events = events.slice(-500);

    const now = new Date(body.timestamp || Date.now());

    if (body.event === 'session_start' || !existing) {
      await prisma.userSession.upsert({
        where: { guestId: body.guestId },
        update: {
          role,
          lastSeen: now,
          events: JSON.stringify(events),
        },
        create: {
          guestId: body.guestId,
          role,
          startTime: now,
          lastSeen: now,
          events: JSON.stringify([{ ...body, role, country }]),
        },
      });
    } else if (body.event === 'session_end') {
      const startTime = existing.startTime ? new Date(existing.startTime).getTime() : now.getTime();
      const durationMs = Math.max(0, now.getTime() - startTime);
      await prisma.userSession.update({
        where: { guestId: body.guestId },
        data: {
          endTime: now,
          lastSeen: now,
          durationMs,
          events: JSON.stringify(events),
        },
      });
    } else {
      await prisma.userSession.update({
        where: { guestId: body.guestId },
        data: {
          lastSeen: now,
          events: JSON.stringify(events),
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Session track DB error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const records = await prisma.userSession.findMany({
      orderBy: { startTime: 'desc' },
      take: 100,
    });

    const now = Date.now();
    const sessions = records.map(r => {
      const evs: SessionEvent[] = r.events ? JSON.parse(r.events) : [];
      const lastSeenTime = r.lastSeen.getTime();
      const ended = r.endTime;
      let status: string;
      if (ended) {
        status = 'Offline';
      } else {
        const idleMs = now - lastSeenTime;
        status = idleMs <= 90_000 ? 'Active' : idleMs <= 15 * 60_000 ? 'Idle' : 'Offline';
      }
      const location = evs.find(e => e.country)?.country || '';
      return {
        guestId: r.guestId,
        role: r.role as 'admin' | 'guest',
        startTime: r.startTime.toISOString(),
        endTime: ended ? ended.toISOString() : undefined,
        durationMs: r.durationMs ?? undefined,
        events: evs,
        lastSeen: r.lastSeen.toISOString(),
        status,
        location,
      };
    });

    return NextResponse.json({ sessions });
  } catch (err) {
    console.error('Session fetch error:', err);
    return NextResponse.json({ sessions: [], error: 'Internal server error' });
  }
}
