import { prisma } from "./db";

// Daily budget for Apify Upwork Scraper query-runs, shared across the new-job
// sync AND the active-job refresh. The actor (blackfalcondata/upwork-scraper)
// is pay-per-event: ~$0.001 per run + ~$1.00 per 1,000 results, drawn from the
// $5/month free tier. A hard daily query cap is the only way to keep the month
// inside that budget regardless of how many cron ticks fire, because every
// query is billed even when it returns no NEW jobs.
//
// Default: 16 query-runs/day. Worst case (every query returns the max results)
// that is ~16 x $0.009 ≈ $0.14/day ≈ ~$4.3/month — safely inside the free tier
// with headroom for retries. Override with APIFY_DAILY_QUERY_BUDGET.
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