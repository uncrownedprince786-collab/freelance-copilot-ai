import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { ActiveJobRefresher } from "../../../../providers/ActiveJobRefresher";
import { prisma } from "@/lib/db";
import { isAdminRequest } from "@/lib/adminAuth";

const LOCK_KEY = "refresh_lock";
const LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes; release-on-finally plus TTL safety net
const COOLDOWN_MS = 10 * 60 * 1000; // minimum gap between non-forced refreshes
const COOLDOWN_KEY = "last_refresh_run";

function timingSafeSecretEqual(a: string, b: string): boolean {
  const aHash = crypto.createHash("sha256").update(a).digest();
  const bHash = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

async function acquireLock(): Promise<boolean> {
  try {
    const now = Date.now();
    const existing = await prisma.systemKv.findUnique({ where: { key: LOCK_KEY } });
    if (existing) {
      try {
        const parsed = JSON.parse(existing.value) as { startedAt: number };
        if (now - parsed.startedAt < LOCK_TTL_MS) return false;
      } catch {
        /* treat corrupt/stale record as free */
      }
    }
    await prisma.systemKv.upsert({
      where: { key: LOCK_KEY },
      update: { value: JSON.stringify({ startedAt: now }) },
      create: { key: LOCK_KEY, value: JSON.stringify({ startedAt: now }) },
    });
    return true;
  } catch {
    return true; // fail-open rather than blocking the refresh
  }
}

async function releaseLock(): Promise<void> {
  await prisma.systemKv.delete({ where: { key: LOCK_KEY } }).catch(() => {});
}

async function runRefresh(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const expectedSecret = process.env.CRON_SECRET;

    let authorized = false;
    if (authHeader && expectedSecret) {
      const providedSecret = authHeader.replace(/^Bearer\s+/i, "").trim();
      authorized = timingSafeSecretEqual(providedSecret, expectedSecret);
    }
    if (!authorized && (await isAdminRequest())) {
      authorized = true;
    }
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "true";

    if (!(await acquireLock())) {
      return NextResponse.json({ error: "Refresh already in progress" }, { status: 429 });
    }

    try {
      if (!force) {
        const rec = await prisma.systemKv.findUnique({ where: { key: COOLDOWN_KEY } });
        const last = rec?.value ? JSON.parse(rec.value).at ?? 0 : 0;
        if (last && Date.now() - last < COOLDOWN_MS) {
          const nextIn = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000);
          return NextResponse.json({ success: true, skipped: true, nextRunIn: nextIn });
        }
      }

      const refresher = new ActiveJobRefresher();
      const result = await refresher.refresh();

      await prisma.systemKv
        .upsert({
          where: { key: COOLDOWN_KEY },
          update: { value: JSON.stringify({ at: Date.now() }) },
          create: { key: COOLDOWN_KEY, value: JSON.stringify({ at: Date.now() }) },
        })
        .catch(() => {});

      return NextResponse.json({ success: true, ...result });
    } finally {
      await releaseLock();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("API refresh error:", msg);
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return runRefresh(req);
}

// Vercel Cron invokes the configured path with a GET request and sends
// `Authorization: Bearer <CRON_SECRET>` when the CRON_SECRET env var is set.
export async function GET(req: NextRequest) {
  return runRefresh(req);
}
