import { NextRequest, NextResponse } from "next/server";
import { ActiveJobRefresher } from "../../../../providers/ActiveJobRefresher";
import { prisma } from "@/lib/db";
import { isAdminRequest } from "@/lib/adminAuth";
import { hasValidCronBearer } from "@/lib/cronAuth";
import { acquireLock, releaseLock } from "@/lib/runLock";

const LOCK_KEY = "refresh_lock";
const LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes; release-on-finally plus TTL safety net
const COOLDOWN_MS = 45 * 60 * 1000; // minimum gap between non-forced refreshes
const COOLDOWN_KEY = "last_refresh_run";

// Auth and overlap prevention are shared: lib/cronAuth for the Bearer check,
// lib/runLock for a single-statement lock that two concurrent ticks cannot
// both win. Both fail closed.

async function runRefresh(req: NextRequest) {
  try {
    const authorized = hasValidCronBearer(req) || (await isAdminRequest());
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "true";

    const lock = await acquireLock(LOCK_KEY, LOCK_TTL_MS);
    if (!lock) {
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
      await releaseLock(lock);
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

// GET is restricted to the Bearer secret. A cookie-authorized GET is
// CSRF-reachable under SameSite=Lax, which would let a link an admin clicks
// spend the day's Apify budget.
export async function GET(req: NextRequest) {
  if (!hasValidCronBearer(req)) {
    return NextResponse.json(
      { error: "Use POST for interactive refresh." },
      { status: 405, headers: { Allow: "POST" } },
    );
  }
  return runRefresh(req);
}
