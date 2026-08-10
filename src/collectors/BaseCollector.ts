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

  // Simple heuristic scoring (0-100) before full AI evaluation
  private calculateBaseScore(item: RawOpportunity): number {
    let score = 50; // Start with baseline

    // Add points for specified budget
    if (typeof item.budget === "string" && item.budget && item.budget !== "Undetermined") {
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
