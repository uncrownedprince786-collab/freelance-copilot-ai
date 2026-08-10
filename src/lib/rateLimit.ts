export function createRateLimiter(maxRequests: number, windowMs: number) {
  const map = new Map<string, { count: number; resetAt: number }>();
  return function isRateLimited(key: string): boolean {
    const now = Date.now();
    const entry = map.get(key);
    if (!entry || now > entry.resetAt) {
      map.set(key, { count: 1, resetAt: now + windowMs });
      return false;
    }
    entry.count++;
    return entry.count > maxRequests;
  };
}
