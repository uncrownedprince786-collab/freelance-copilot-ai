import { NextResponse } from 'next/server';
import { ADMIN_COOKIE, ADMIN_SESSION_MS, createAdminToken } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const username = String(record?.username ?? '').trim();
  const password = String(record?.password ?? '');

  const expectedUsername = process.env.ADMIN_USERNAME || 'admin';
  const expectedPassword = process.env.ADMIN_PASSWORD;

  if (!expectedPassword || username !== expectedUsername || password !== expectedPassword) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = createAdminToken();
  if (!token) {
    return NextResponse.json({ error: 'Server auth is not configured.' }, { status: 503 });
  }
  const response = NextResponse.json({ success: true, role: 'admin' });
  response.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_SESSION_MS / 1000,
  });
  return response;
}
