import { NextResponse } from 'next/server';
import { ADMIN_COOKIE, GUEST_COOKIE } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json({ success: true });
  const expire = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 0,
  };
  response.cookies.set(ADMIN_COOKIE, '', expire);
  // The guest cookie has a 24 h lifetime and authorizes /api/analyze and
  // /api/agent. Clearing only the admin cookie meant "log out" left a working
  // session behind on a shared machine.
  response.cookies.set(GUEST_COOKIE, '', expire);
  return response;
}
