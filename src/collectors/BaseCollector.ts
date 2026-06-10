import { prisma } from "@/lib/db";
import { CollectorInterface, RawOpportunity } from "./types";

export abstract class BaseCollector implements CollectorInterface {
  abstract name: string;

  // Each sub-collector must implement fetch
  abstract fetch(): Promise<RawOpportunity[]>;

  // Helper method to retry functions that might fail due to network/rate-limiting
  protected async retry<T>(
    fn: () => Promise<T>,
    retries = 3,
    delay = 1000
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (retries <= 1) {
        throw error;
      }
      console.warn(`[Collector: ${this.name}] Failed. Retrying in ${delay}ms... (${retries - 1} attempts left). Error:`, error);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.retry(fn, retries - 1, delay * 2);
    }
  }

  // Common runner method to fetch, validate, and store raw opportunities
  async run(): Promise<{ success: boolean; count: number; error?: string; data: RawOpportunity[] }> {
    console.log(`[Collector: ${this.name}] Starting collection run...`);
    try {
      // 1. Fetch raw opportunities with retry support
      const rawOpportunities = await this.retry(() => this.fetch());
      console.log(`[Collector: ${this.name}] Fetched ${rawOpportunities.length} items.`);

      let savedCount = 0;

      // 2. Filter, validate, and save each opportunity
      for (const item of rawOpportunities) {
        if (!item.title || !item.url) {
          console.warn(`[Collector: ${this.name}] Invalid item skipped. Missing title or URL:`, item);
          continue;
        }

        try {
          const cleanedBudget = item.budget?.trim() || "Undetermined";
          const baseScore = this.calculateBaseScore(item);

          const result = await prisma.opportunity.upsert({
            where: { url: item.url },
            update: {
              title: item.title.trim(),
              description: item.description.trim(),
              budget: cleanedBudget,
              platform: item.platform,
              score: baseScore,
              risk: "Medium",
              createdAt: item.postedAt || new Date(),
            },
            create: {
              title: item.title.trim(),
              description: item.description.trim(),
              budget: cleanedBudget,
              platform: item.platform,
              url: item.url,
              score: baseScore,
              risk: "Medium",
              createdAt: item.postedAt || new Date(),
            },
          });

          if (result) {
            console.log(`[Collector: ${this.name}] Successfully saved: ${item.title}`);
            savedCount++;
          }
        } catch (dbError) {
          // Log but don't break the entire collection run. Keep saving other items.
          console.error(`[Collector: ${this.name}] Error saving opportunity to DB (${item.url}):`, dbError);
        }
      }

      if (rawOpportunities.length === 0) {
        console.warn(`[Collector: ${this.name}] No opportunities fetched; returning empty data.`);
      }

      console.log(`[Collector: ${this.name}] Completed successfully. Saved ${savedCount} new opportunities.`);
      return { success: true, count: savedCount, data: rawOpportunities };
    } catch (error: any) {
      console.error(`[Collector: ${this.name}] Collection failed:`, error);
      return { success: false, count: 0, error: error?.message || "Unknown error", data: [] };
    }
  }

  // Simple heuristic scoring (0-100) before full AI evaluation
  private calculateBaseScore(item: RawOpportunity): number {
    let score = 50; // Start with baseline

    // Add points for specified budget
    if (item.budget && item.budget !== "Undetermined") {
      const budgetNum = parseInt(item.budget.replace(/[^0-9]/g, ""), 10);
      if (!isNaN(budgetNum)) {
        if (budgetNum > 2000) score += 20;
        else if (budgetNum > 500) score += 10;
      } else {
        score += 5; // Has some budget description
      }
    }

    // Add points for length/detail of description
    if (item.description.length > 500) {
      score += 15;
    } else if (item.description.length > 200) {
      score += 5;
    }

    // Cap the base score between 0 and 90 (reserving 90+ for high AI matches)
    return Math.min(Math.max(score, 20), 85);
  }
}
