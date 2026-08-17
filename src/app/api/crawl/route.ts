import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import puppeteer, { Browser } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

export const maxDuration = 60;
export const runtime = 'nodejs';

const NAV_TIMEOUT_MS = 45_000;
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

  for (const url of urls) {
    try {
      const parsed = new URL(url);
      if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
        return NextResponse.json({ error: `host not allowed: ${parsed.hostname}` }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: `invalid url: ${url}` }, { status: 400 });
    }
  }

  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1920, height: 1080 },
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const results = await Promise.all(
      urls.map(async (url) => {
        let page;
        try {
          page = await browser!.newPage();
          await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          );
          await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
          });

          await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: NAV_TIMEOUT_MS,
          });

          await page.waitForSelector('body', { timeout: 5000 }).catch(() => {});

          const html = await page.content();
          return { html };
        } catch (err: unknown) {
          return { html: '', error: err instanceof Error ? err.message : String(err) };
        } finally {
          if (page) await page.close().catch(() => {});
        }
      }),
    );

    return NextResponse.json({ results });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `browser launch failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
