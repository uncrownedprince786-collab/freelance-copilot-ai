import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAdminRequest } from '@/lib/adminAuth';

interface SessionEvent {
  guestId: string;
  role: 'admin' | 'guest';
  event: string;
  detail?: string;
  timestamp: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: SessionEvent = await req.json();
    if (typeof body?.guestId !== 'string' || body.guestId.trim().length === 0 || body.guestId.length > 100) {
      return NextResponse.json({ ok: false, error: 'Missing or invalid guestId' }, { status: 400 });
    }

    const role = body.role === 'admin' ? 'admin' : 'guest';
    const existing = await prisma.userSession.findUnique({
      where: { guestId: body.guestId }
    });

    let events: SessionEvent[] = existing?.events ? JSON.parse(existing.events) : [];
    events.push({ ...body, role });
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
          events: JSON.stringify([{ ...body, role }]),
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

    const sessions = records.map(r => ({
      guestId: r.guestId,
      role: r.role as 'admin' | 'guest',
      startTime: r.startTime.toISOString(),
      endTime: r.endTime ? r.endTime.toISOString() : undefined,
      durationMs: r.durationMs ?? undefined,
      events: r.events ? JSON.parse(r.events) : [],
      lastSeen: r.lastSeen.toISOString(),
    }));

    return NextResponse.json({ sessions });
  } catch (err) {
    console.error('Session fetch error:', err);
    return NextResponse.json({ sessions: [], error: 'Internal server error' });
  }
}
