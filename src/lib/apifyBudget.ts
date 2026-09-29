import { prisma } from "./db";

// Daily budget for billed Apify runs, shared across the new-job sync AND the
// active-job refresh.
//
// Pricing, read off the actor's own page rather than assumed:
// blackfalcondata/upwork-scraper is pay-per-event at $0.001 per run start
// plus $0.001 per emitted result, against $5 of monthly free credit.
//
// The old model spent that badly. Each of the four discovery queries was a
// separate billed run at 8 results each — 32 billed results per pass — and
// none of it was incremental, so the same listings were bought again on
// every pass. Measured: ~50 records returned per day against ~28 genuinely
// new Upwork rows, and only 2 passes a day actually ran before the cap bit.
// Worst case that was ~$4.3/month, 86% of the allowance, for data that was
// up to twelve hours stale.
//
// The provider now sends the four queries as ONE batched run (one
// Actor-Start instead of four) with incrementalMode and a stable stateKey,
// so a pass costs one run plus only the listings that are actually new or
// changed. A pass is therefore ~$0.001 + ~$0.003 of results instead of
// ~$0.036, and every sync can afford one.
//
// Default: 16 billed runs/day. At roughly 28 new Upwork listings a day that
// is about $0.016 of run starts plus $0.028 of results — ~$1.3/month, about
// a quarter of the allowance, with the cap still there to stop a runaway
// loop. Override with APIFY_DAILY_QUERY_BUDGET.
const BUDGET_KEY = "apify_query_budget";

export function utcDateKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function getApifyDailyBudget(): number {
  const n = Number(process.env.APIFY_DAILY_QUERY_BUDGET);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 16;
}

async function readBudget(): Promise<{ date: string; used: number } | null> {
  try {
    const rec = await prisma.systemKv.findUnique({ where: { key: BUDGET_KEY } });
    if (!rec?.value) return null;
    const parsed = JSON.parse(rec.value) as { date?: string; used?: number };
    if (typeof parsed.date !== "string") return null;
    return { date: parsed.date, used: Number(parsed.used) || 0 };
  } catch {
    return null;
  }
}

// Queries still available today (0 when exhausted). A new UTC day resets the
// counter automatically. Fails open on a KV hiccup so ingestion is never
// blocked by telemetry.
export async function getApifyBudgetRemaining(): Promise<number> {
  const budget = getApifyDailyBudget();
  const rec = await readBudget();
  if (!rec || rec.date !== utcDateKey()) return budget;
  return Math.max(0, budget - rec.used);
}

// Consumes one query-run from today's budget. Returns the remaining count
// after this query (0 when the budget is now exhausted).
export async function consumeApifyBudget(): Promise<number> {
  const budget = getApifyDailyBudget();
  const today = utcDateKey();
  try {
    const rec = await readBudget();
    const used = rec && rec.date === today ? rec.used : 0;
    const nextUsed = used + 1;
    await prisma.systemKv.upsert({
      where: { key: BUDGET_KEY },
      update: { value: JSON.stringify({ date: today, used: nextUsed }) },
      create: { key: BUDGET_KEY, value: JSON.stringify({ date: today, used: nextUsed }) },
    });
    return Math.max(0, budget - nextUsed);
  } catch {
    // Fail open: if the counter can't be written, allow the query.
    return Math.max(0, budget - 1);
  }
}