export const SESSION_DURATION_MS = 15 * 60 * 1000; // 15 Minutes session duration

export type UserRole = 'admin' | 'guest';

export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  const token = sessionStorage.getItem('lh_auth_token');
  const expires = sessionStorage.getItem('lh_auth_expires');
  if (!token || !expires) return false;
  if (Date.now() > parseInt(expires, 10)) {
    sessionStorage.removeItem('lh_auth_token');
    sessionStorage.removeItem('lh_auth_expires');
    sessionStorage.removeItem('lh_auth_role');
    return false;
  }
  return token === 'lh_admin_session_token' || token === 'lh_guest_session_token';
}

export function isAdmin(): boolean {
  if (typeof window === 'undefined') return false;
  const token = sessionStorage.getItem('lh_auth_token');
  const expires = sessionStorage.getItem('lh_auth_expires');
  if (!token || !expires) return false;
  if (Date.now() > parseInt(expires, 10)) return false;
  return token === 'lh_admin_session_token';
}

export function getRole(): UserRole | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('lh_auth_role') as UserRole | null;
}

export async function login(username: string, pass: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: pass }),
    });
    if (!res.ok) return false;

    // sessionStorage remains a UI-only hint; the server authorizes via the
    // httpOnly session cookie set by /api/auth/login.
    sessionStorage.setItem('lh_auth_token', 'lh_admin_session_token');
    sessionStorage.setItem('lh_auth_expires', (Date.now() + SESSION_DURATION_MS).toString());
    sessionStorage.setItem('lh_auth_role', 'admin');
    // Track admin session start
    fetch('/api/sessions/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'session_start', guestId: 'admin', role: 'admin', timestamp: new Date().toISOString() }),
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export async function loginAsGuest(): Promise<void> {
  if (typeof window === 'undefined') return;
  const guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  sessionStorage.setItem('lh_auth_token', 'lh_guest_session_token');
  sessionStorage.setItem('lh_auth_expires', (Date.now() + SESSION_DURATION_MS).toString());
  sessionStorage.setItem('lh_auth_role', 'guest');
  sessionStorage.setItem('lh_guest_id', guestId);
  // Request a signed guest session cookie (server-side identity for
  // session-protected endpoints). Awaited so subsequent analyze/view calls
  // carry a valid session. If this fails, guest browsing still works but
  // protected routes return 401.
  try {
    await fetch('/api/auth/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestId }),
    });
  } catch { /* non-critical */ }
  // Notify backend to record guest session start
  fetch('/api/sessions/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'session_start', guestId, role: 'guest', timestamp: new Date().toISOString() }),
  }).catch(() => {});
}

export function trackActivity(event: string, detail?: string): void {
  if (typeof window === 'undefined') return;
  const role = getRole();
  const guestId = sessionStorage.getItem('lh_guest_id') || sessionStorage.getItem('lh_auth_role');
  if (!role) return;
  fetch('/api/sessions/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, detail, role, guestId, timestamp: new Date().toISOString() }),
  }).catch(() => {});
}

export function logout(): void {
  if (typeof window !== 'undefined') {
    const role = getRole();
    const guestId = sessionStorage.getItem('lh_guest_id') || (role === 'admin' ? 'admin' : null);
    if (role && guestId) {
      fetch('/api/sessions/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'session_end', guestId, role, timestamp: new Date().toISOString() }),
      }).catch(() => {});
    }
    // Clear the server-side admin session cookie
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    sessionStorage.removeItem('lh_auth_token');
    sessionStorage.removeItem('lh_auth_expires');
    sessionStorage.removeItem('lh_auth_role');
    sessionStorage.removeItem('lh_guest_id');
  }
}
