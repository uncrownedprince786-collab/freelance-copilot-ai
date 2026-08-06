export const SESSION_DURATION_MS = 15 * 60 * 1000; // 15 Minutes session duration

export function isAuthenticated(): boolean {
  // Login requirement temporarily bypassed as requested ("abi k liye login wala code commit kr do")
  return true;
}

export function login(username: string, pass: string): boolean {
  if (username.trim() === 'admin' && pass === 'Admin@123') {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('lh_auth_token', 'lh_admin_session_token');
      sessionStorage.setItem('lh_auth_expires', (Date.now() + SESSION_DURATION_MS).toString());
    }
    return true;
  }
  return false;
}

export function logout(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('lh_auth_token');
    sessionStorage.removeItem('lh_auth_expires');
  }
}
