import Parser from "rss-parser";
import { BaseCollector } from "./BaseCollector";
import { RawOpportunity } from "./types";

export class GenericFeedCollector extends BaseCollector {
  name = "GenericFeed";
  private feedUrl: string;

  constructor(customFeedUrl?: string) {
    super();
    // Default to We Work Remotely programming jobs feed which is highly stable and public
    this.feedUrl = customFeedUrl || "https://weworkremotely.com/categories/remote-programming-jobs.rss";
  }

  async fetch(): Promise<RawOpportunity[]> {
    const parser = new Parser({
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    try {
      console.log(`[Collector: GenericFeed] Fetching RSS feed from: ${this.feedUrl}`);
      const feed = await parser.parseURL(this.feedUrl);
      
      const opportunities: RawOpportunity[] = feed.items.map((item) => {
        const rawDescription = item.contentSnippet || item.content || "";
        const cleanDescription = this.stripHtml(rawDescription);

        // Standard feeds might contain budget or salary info in description or categories
        const budget = this.extractBudget(item.title || "", cleanDescription, item.categories || []);

        return {
          title: item.title || "Untitled Remote Job",
          description: cleanDescription,
          url: item.link || item.guid || "",
          budget: budget,
          platform: "WeWorkRemotely",
          postedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
        };
      });

      return opportunities;
    } catch (error: any) {
      console.warn(`[Collector: GenericFeed] Could not fetch RSS feed: ${error?.message || error}`);
      return [];
    }
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>?/gm, "").trim();
  }

  private extractBudget(title: string, description: string, categories: string[]): string {
    // 1. Check title for salary range like "$100k - $120k" or "$100,000"
    const titleSalaryMatch = title.match(/\$(\d+k?)\s*-\s*\$(\d+k?)/i) || 
                             title.match(/\$(\d+[\d,]*)/);
    if (titleSalaryMatch && titleSalaryMatch[0]) {
      return titleSalaryMatch[0];
    }

    // 2. Search description for keywords like "Salary:", "Compensation:", "Pay:"
    const descSalaryMatch = description.match(/(salary|compensation|pay|rate)\s*:\s*\$?([\d,.\-\s\w]+)/i);
    if (descSalaryMatch && descSalaryMatch[2]) {
      // Return first 30 chars of match
      return descSalaryMatch[0].replace(/^(salary|compensation|pay|rate)\s*:\s*/i, "").trim().substring(0, 30);
    }

    // 3. Search category tags
    for (const cat of categories) {
      if (cat.includes("$") || cat.toLowerCase().includes("usd") || cat.toLowerCase().includes("salary")) {
        return cat.trim();
      }
    }

    return "Undetermined";
  }
}
