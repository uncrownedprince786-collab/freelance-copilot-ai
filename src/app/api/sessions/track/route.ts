import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAdminRequest, getSessionClaims } from '@/lib/adminAuth';

// Session activity tracking.
//
// SECURITY: this route used to be unauthenticated, cast `await req.json()`
// straight to a typed interface without validating it, and spread the entire
// caller-supplied object into the stored events array with no byte cap. That
// allowed anyone to write ~2 GB per guestId (500 events x ~4 MB body) under
// unlimited guestIds, and to set their own `role: 'admin'` label so forged
// activity appeared as admin activity in the admin dashboard.
//
// It now requires a valid session, and takes the identity (guestId + role)
// from the SIGNED cookie claims rather than from the request body. Every
// stored field is explicitly picked and length-capped; nothing is spread.

const MAX_EVENTS = 200;          // per session, newest kept
const MAX_EVENT_LEN = 64;        // event name
const MAX_DETAIL_LEN = 200;      // human-readable detail (e.g. a job title)
const MAX_EVENTS_BYTES = 64_000; // hard ceiling on the serialized blob

interface StoredEvent {
  guestId: string;
  role: 'admin' | 'guest';
  event: string;
  detail?: string;
  timestamp: string;
  country?: string;
}

function getVisitorCountry(req: NextRequest): string {
  const raw = req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry') || '';
  // Edge-supplied, but still clamp: it is a header.
  return raw.replace(/[^A-Za-z-]/g, '').slice(0, 8);
}

function cleanStr(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // Strip control characters so stored text cannot corrupt log or table output.
  return v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

/** A timestamp we are willing to store: real, and not in the future. */
function safeTimestamp(v: unknown): Date {
  const now = Date.now();
  if (typeof v !== 'string') return new Date(now);
  const ms = new Date(v).getTime();
  if (!Number.isFinite(ms) || ms <= 0 || ms > now) return new Date(now);
  return new Date(ms);
}

/** Trim oldest-first until the serialized array fits the byte ceiling. */
function fitEvents(events: StoredEvent[]): StoredEvent[] {
  let out = events.slice(-MAX_EVENTS);
  while (out.length > 1 && JSON.stringify(out).length > MAX_EVENTS_BYTES) {
    out = out.slice(Math.ceil(out.length / 4));
  }
  return out;
}

export async function POST(req: NextRequest) {
  // Identity comes from the signed session, never from the body.
  const claims = await getSessionClaims();
  if (!claims) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const role: 'admin' | 'guest' = claims.role;
  const guestId = role === 'admin' ? 'admin' : cleanStr(claims.guestId, 100);
  if (!guestId) {
    return NextResponse.json({ ok: false, error: 'Session has no subject' }, { status: 400 });
  }

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
    }
    const raw = (body ?? {}) as Record<string, unknown>;

    const event = cleanStr(raw.event, MAX_EVENT_LEN);
    if (!event) {
      return NextResponse.json({ ok: false, error: 'Missing event' }, { status: 400 });
    }
    const detail = cleanStr(raw.detail, MAX_DETAIL_LEN);
    const now = safeTimestamp(raw.timestamp);
    const country = getVisitorCountry(req);

    // Explicitly constructed — no spread of caller-controlled keys.
    const entry: StoredEvent = {
      guestId,
      role,
      event,
      ...(detail ? { detail } : {}),
      timestamp: now.toISOString(),
      ...(country ? { country } : {}),
    };

    const existing = await prisma.userSession.findUnique({
      where: { guestId },
      select: { startTime: true, events: true },
    });

    let events: StoredEvent[] = [];
    if (existing?.events) {
      try {
        const parsed = JSON.parse(existing.events);
        if (Array.isArray(parsed)) events = parsed as StoredEvent[];
      } catch {
        events = [];
      }
    }
    events.push(entry);
    const serialized = JSON.stringify(fitEvents(events));

    if (event === 'session_start' || !existing) {
      await prisma.userSession.upsert({
        where: { guestId },
        update: { role, lastSeen: now, events: serialized },
        create: {
          guestId,
          role,
          startTime: now,
          lastSeen: now,
          events: JSON.stringify([entry]),
        },
      });
    } else if (event === 'session_end') {
      const startMs = existing.startTime ? new Date(existing.startTime).getTime() : now.getTime();
      await prisma.userSession.update({
        where: { guestId },
        data: {
          endTime: now,
          lastSeen: now,
          durationMs: Math.max(0, now.getTime() - startMs),
          events: serialized,
        },
      });
    } else {
      await prisma.userSession.update({
        where: { guestId },
        data: { lastSeen: now, events: serialized },
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
    const sessions = records.map((r) => {
      let evs: StoredEvent[] = [];
      try {
        const parsed = r.events ? JSON.parse(r.events) : [];
        if (Array.isArray(parsed)) evs = parsed as StoredEvent[];
      } catch {
        evs = [];
      }
      const lastSeenTime = r.lastSeen.getTime();
      const ended = r.endTime;
      let status: string;
      if (ended) {
        status = 'Offline';
      } else {
        const idleMs = now - lastSeenTime;
        // Must stay above the client heartbeat interval or every live session
        // reads as Idle between beats. HEARTBEAT_MS in src/app/page.tsx is
        // 20 minutes — raised so an open tab stops holding the scale-to-zero
        // database awake — so these thresholds moved with it.
        status = idleMs <= 25 * 60_000 ? 'Active' : idleMs <= 60 * 60_000 ? 'Idle' : 'Offline';
      }
      const location = evs.find((e) => e.country)?.country || '';
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
    return NextResponse.json({ sessions: [], error: 'Internal server error' }, { status: 500 });
  }
}
