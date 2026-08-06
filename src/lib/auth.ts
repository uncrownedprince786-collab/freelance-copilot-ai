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

export function login(username: string, pass: string): boolean {
  if (username.trim() === 'admin' && pass === 'Admin@123') {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('lh_auth_token', 'lh_admin_session_token');
      sessionStorage.setItem('lh_auth_expires', (Date.now() + SESSION_DURATION_MS).toString());
      sessionStorage.setItem('lh_auth_role', 'admin');
      // Track admin session start
      fetch('/api/sessions/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'session_start', guestId: 'admin', role: 'admin', timestamp: new Date().toISOString() }),
      }).catch(() => {});
    }
    return true;
  }
  return false;
}

export function loginAsGuest(): void {
  if (typeof window !== 'undefined') {
    const guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    sessionStorage.setItem('lh_auth_token', 'lh_guest_session_token');
    sessionStorage.setItem('lh_auth_expires', (Date.now() + SESSION_DURATION_MS).toString());
    sessionStorage.setItem('lh_auth_role', 'guest');
    sessionStorage.setItem('lh_guest_id', guestId);
    // Notify backend to record guest session start
    fetch('/api/sessions/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'session_start', guestId, role: 'guest', timestamp: new Date().toISOString() }),
    }).catch(() => {});
  }
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
    const guestId = sessionStorage.getItem('lh_guest_id');
    if (role) {
      fetch('/api/sessions/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'session_end', guestId, role, timestamp: new Date().toISOString() }),
      }).catch(() => {});
    }
    sessionStorage.removeItem('lh_auth_token');
    sessionStorage.removeItem('lh_auth_expires');
    sessionStorage.removeItem('lh_auth_role');
    sessionStorage.removeItem('lh_guest_id');
  }
}
