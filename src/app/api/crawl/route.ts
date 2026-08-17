import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const FETCH_TIMEOUT_MS = 30_000;
const MAX_URLS = 6;

const ALLOWED_HOSTS = ['www.upwork.com', 'upwork.com'];

function timingSafeSecretEqual(a: string, b: string): boolean {
  const aHash = crypto.createHash('sha256').update(a).digest();
  const bHash = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

function authorize(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  const expected = process.env.CRAWL4AI_TOKEN || process.env.CRON_SECRET;
  if (!authHeader || !expected) return false;
  const provided = authHeader.replace(/^Bearer\s+/i, '').trim();
  return timingSafeSecretEqual(provided, expected);
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { urls?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const urls = body.urls?.filter(Boolean).slice(0, MAX_URLS);
  if (!urls || urls.length === 0) {
    return NextResponse.json({ error: 'No urls provided' }, { status: 400 });
  }

  const browserUA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const parsed = new URL(url);
        if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
          return { html: '', error: `host not allowed: ${parsed.hostname}` };
        }

        const res = await fetch(url, {
          headers: {
            'User-Agent': browserUA,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!res.ok) {
          return { html: '', error: `HTTP ${res.status}` };
        }

        const html = await res.text();
        return { html };
      } catch (err: unknown) {
        return { html: '', error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  return NextResponse.json({ results });
}
