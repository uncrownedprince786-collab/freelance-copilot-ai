// src/collectors/run.ts
import { UpworkCollector } from "./UpworkCollector";
import { FreelancerCollector } from "./FreelancerCollector";
import { prisma } from "@/lib/db";
import { RawOpportunity } from "./types";

// In-scope CLI collection sources: Upwork + Freelancer only. Generic/public
// remote feeds were intentionally removed to keep collection focused.

export interface CollectionStats {
  platform: string;
  success: boolean;
  imported: number; // raw items fetched before dedupe
  error?: string;
  modeUsed?: string;
}

/** Simple heuristic scoring (mirrored from BaseCollector) */
function calculateBaseScore(item: RawOpportunity): number {
  let score = 50;
  if (typeof item.budget === "string" && item.budget && item.budget !== "Undetermined") {
    const budgetNum = parseInt(item.budget.replace(/[^0-9]/g, ""), 10);
    if (!isNaN(budgetNum)) {
      if (budgetNum > 2000) score += 20;
      else if (budgetNum > 500) score += 10;
    } else {
      score += 5;
    }
  }
  if (item.description.length > 500) score += 15;
  else if (item.description.length > 200) score += 5;
  return Math.min(Math.max(score, 20), 85);
}

export async function runAllCollectors(): Promise<{
  success: boolean;
  totalImported: number;
  stats: CollectionStats[];
}> {
  console.log("Starting full Freelance Copilot AI collection run...");

  const collectors = [
    new UpworkCollector(),
    new FreelancerCollector(),
  ];

  // Parallel fetch of raw opportunities
  const fetchResults = await Promise.allSettled(collectors.map((c) => c.fetch()));

  const stats: CollectionStats[] = [];
  const allRawOps: RawOpportunity[] = [];

  fetchResults.forEach((result, idx) => {
    const collector = collectors[idx];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mode = (collector as any).modeUsed;
    if (result.status === "fulfilled") {
      const raw = result.value as RawOpportunity[];
      allRawOps.push(...raw);
      stats.push({
        platform: collector.name,
        success: true,
        imported: raw.length,
        modeUsed: mode,
      });
    } else {
      console.error(`Collector ${collector.name} failed:`, result.reason);
      stats.push({
        platform: collector.name,
        success: false,
        imported: 0,
        error: result.reason?.message || "Collector error",
        modeUsed: mode,
      });
    }
  });

  // Deduplicate by URL, keep first‑seen as primary and track secondary sources
  const jobMap = new Map<string, RawOpportunity & { sources: string[] }>();
  for (const op of allRawOps) {
    if (!op.url) continue;
    const key = op.url;
    const source = op.platform || "unknown";
    if (!jobMap.has(key)) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      jobMap.set(key, { ...op, sources: [source] } as any);
    } else {
      const existing = jobMap.get(key)!;
      if (!existing.sources.includes(source)) existing.sources.push(source);
    }
  }

  let uniqueOps = Array.from(jobMap.values());

  // Ensure feed is never empty – force Upwork & Freelancer if needed
  if (uniqueOps.length === 0) {
    console.warn("⚠ Feed empty → forcing Upwork and Freelancer collectors.");
    try {
      const upwork = await new UpworkCollector().fetch();
      const freelancer = await new FreelancerCollector().fetch();
      const forced = [...upwork, ...freelancer];
      forced.forEach((op) => {
        const key = op.url;
        const source = op.platform || "unknown";
        if (!jobMap.has(key)) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          jobMap.set(key, { ...op, sources: [source] } as any);
        } else {
          const existing = jobMap.get(key)!;
          if (!existing.sources.includes(source)) existing.sources.push(source);
        }
      });
      uniqueOps = Array.from(jobMap.values());
    } catch (e) {
      console.error("Forced collectors failed:", e);
    }
  }

  // Upsert each unique opportunity (primary source retained)
  let totalImported = 0;
  for (const item of uniqueOps) {
    if (!item.url) continue;
    try {
      const cleanedBudget = typeof item.budget === "string" ? (item.budget.trim() || "Undetermined") : "Undetermined";
      const baseScore = calculateBaseScore(item);
      // Normalize the posted date - different collectors use different field names
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const postedAt = (item.postedAt || item.postedDate) ? new Date((item.postedAt || item.postedDate) as any) : new Date();
      await prisma.opportunity.upsert({
        where: { url: item.url },
        update: {
          title: item.title?.trim() || "Untitled Job",
          description: item.description?.trim() || "",
          budget: cleanedBudget,
          platform: item.platform,
          country: item.country,
          clientName: item.clientName,
          clientSpend: item.clientSpend,
          clientReviews: item.clientReviews,
          connections: item.connections,
        },
        create: {
          title: item.title?.trim() || "Untitled Job",
          description: item.description?.trim() || "",
          budget: cleanedBudget,
          platform: item.platform, // primary source
          url: item.url,
          score: baseScore,
          risk: "Medium",
          createdAt: postedAt,
          status: item.status || "OPEN",
          country: item.country,
          clientName: item.clientName,
          clientSpend: item.clientSpend,
          clientReviews: item.clientReviews,
          connections: item.connections,
        },
      });
      totalImported++;
    } catch (dbError) {
      console.error(`Error upserting ${item.url}:`, dbError);
    }
  }

  // In-scope sources are Upwork + Freelancer only; no extra public-feed fallback.
  console.log(`Full collection run complete. Total imported: ${totalImported}.`);
  return {
    success: stats.some((s) => s.success),
    totalImported,
    stats,
  };
}
