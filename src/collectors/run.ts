// src/collectors/run.ts
import { UpworkCollector } from "./UpworkCollector";
import { FreelancerCollector } from "./FreelancerCollector";
import { GenericFeedCollector } from "./GenericFeedCollector";
import { RemoteApisCollector } from "./RemoteApisCollector";
import { prisma } from "@/lib/db";
import { RawOpportunity } from "./types";

// Minimum jobs we aim to import per run
const MIN_JOBS = 25;

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
  if (item.budget && item.budget !== "Undetermined") {
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
    new GenericFeedCollector(),
    new RemoteApisCollector(),
  ];

  // Parallel fetch of raw opportunities
  const fetchResults = await Promise.allSettled(collectors.map((c) => c.fetch()));

  const stats: CollectionStats[] = [];
  const allRawOps: RawOpportunity[] = [];

  fetchResults.forEach((result, idx) => {
    const collector = collectors[idx];
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
      const cleanedBudget = item.budget?.trim() || "Undetermined";
      const baseScore = calculateBaseScore(item);
      await prisma.opportunity.upsert({
        where: { url: item.url },
        update: {},
        create: {
          title: item.title?.trim() || "Untitled Job",
          description: item.description?.trim() || "",
          budget: cleanedBudget,
          platform: item.platform, // primary source
          url: item.url,
          score: baseScore,
          risk: "Medium",
          createdAt: item.postedAt || new Date(),
        },
      });
      totalImported++;
    } catch (dbError) {
      console.error(`Error upserting ${item.url}:`, dbError);
    }
  }

  // If still below minimum, attempt an extra RemoteApis run
  if (totalImported < MIN_JOBS) {
    console.warn(`Total imported (${totalImported}) < MIN_JOBS (${MIN_JOBS}); running extra RemoteApis collector.`);
    try {
      const extra = await new RemoteApisCollector().fetch();
      for (const item of extra) {
        if (!item.url) continue;
        try {
          const cleanedBudget = item.budget?.trim() || "Undetermined";
          const baseScore = calculateBaseScore(item);
          await prisma.opportunity.upsert({
            where: { url: item.url },
            update: {},
            create: {
              title: item.title?.trim() || "Untitled Job",
              description: item.description?.trim() || "",
              budget: cleanedBudget,
              platform: item.platform,
              url: item.url,
              score: baseScore,
              risk: "Medium",
              createdAt: item.postedAt || new Date(),
            },
          });
          totalImported++;
        } catch (dbError) {
          console.error(`Error upserting extra ${item.url}:`, dbError);
        }
      }
    } catch (e) {
      console.error("Extra RemoteApis run failed:", e);
    }
  }

  console.log(`Full collection run complete. Total imported: ${totalImported}.`);
  return {
    success: stats.some((s) => s.success),
    totalImported,
    stats,
  };
}
