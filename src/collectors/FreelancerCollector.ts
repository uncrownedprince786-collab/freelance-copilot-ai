import { BaseCollector } from "./BaseCollector";
import { RawOpportunity } from "./types";

export class FreelancerCollector extends BaseCollector {
  name = "Freelancer";
  private keywords = [
    "client growth manager",
    "telehealth growth manager",
    "marketing strategy",
    "ecommerce growth manager",
    "growth marketing",
    "full stack developer",
    "react developer",
    "wordpress",
    "php laravel",
    "javascript react",
    "nodejs python",
    "mobile app",
    "shopify",
    "web development"
  ];

  async fetch(): Promise<RawOpportunity[]> {
    console.log('Fetching Freelancer opportunities...\n');

    const allJobs: RawOpportunity[] = [];

    for (const keyword of this.keywords) {
      try {
        const jobs = await this.searchFreelancer(keyword);
        if (jobs.length > 0) {
          console.log(`Found ${jobs.length} jobs for "${keyword}"`);
          allJobs.push(...jobs);
        }
        await new Promise(resolve => setTimeout(resolve, 800));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        console.warn(`Freelancer search failed for ${keyword}: ${error.message}`);
      }
    }

    const uniqueJobs = this.deduplicateJobs(allJobs);
    console.log(`Total unique Freelancer jobs: ${uniqueJobs.length}`);
    return uniqueJobs;
  }

  private async searchFreelancer(keyword: string): Promise<RawOpportunity[]> {
    const params = new URLSearchParams({
      query: keyword,
      limit: '20',
      offset: '0',
      compact: 'true',
      full_description: 'true',
      'user_details[]': 'id',
      'job_details[]': 'skills',
    });

    const url = `https://www.freelancer.com/api/projects/0.1/projects/active/?${params}`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.warn(`Freelancer API returned ${response.status} for "${keyword}"`);
        return [];
      }

      const data = await response.json();
      if (!data?.result?.projects) return [];

      const sevenDaysAgo = Date.now() / 1000 - 7 * 24 * 60 * 60;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recentProjects = data.result.projects.filter((p: any) => Number(p.submitdate || 0) >= sevenDaysAgo);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
      return recentProjects.map((project: any): RawOpportunity => {
        const rawDesc = project.description || project.preview_description || project.title || 'No description available.';
        const description = this.cleanText(rawDesc);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        const skills = Array.isArray(project.skills) ? project.skills.map((s: any) => this.cleanText(s.name || s)) : [];

        // Budget — use the real source value (min/max + currency) when the API
        // provides it. Only fall back to "Negotiable" when no budget is returned.
        const budgetRaw = project.budget || {};
        const currencyRaw = project.currency || {};
        const isHourly = project.type === 'hourly';
        const budgetMin = budgetRaw.minimum != null ? Number(budgetRaw.minimum) : undefined;
        const budgetMax = budgetRaw.maximum != null ? Number(budgetRaw.maximum) : undefined;
        const hasBudget = budgetMin != null || budgetMax != null;
        const budget = hasBudget
          ? {
              type: isHourly ? 'hourly' : 'fixed',
              amount: budgetMin != null && budgetMin === budgetMax ? budgetMin : undefined,
              min: budgetMin,
              max: budgetMax,
              // Prefer the real symbol ("$") over the code ("USD") for display.
              currency: currencyRaw.sign || currencyRaw.code || undefined,
            }
          : { type: 'fixed', amount: undefined };

        // Competition — bid_stats.bid_count is the real bids-on-project figure.
        const proposalCount = project.bid_stats?.bid_count != null
          ? Number(project.bid_stats.bid_count)
          : undefined;

        // The active-projects API does not return an owner/user object, so no
        // client metrics (rating, spend, jobs, verification, country) are
        // available. Do not fabricate them.
        return {
          title: this.cleanText(project.title || 'Untitled'),
          description,
          url: `https://www.freelancer.com/projects/${project.seo_url || project.id}`,
          platform: 'Freelancer',
          budget,
          location: 'Remote',
          postedAt: new Date((project.submitdate || Date.now() / 1000) * 1000),
          company: 'Freelancer Client',
          status: 'OPEN',
          country: undefined,
          clientName: 'Freelancer Client',
          clientSpend: undefined,
          connections: 0,
          skills,
          experienceLevel: undefined,
          duration: undefined,
          proposalCount,
          interviewingCount: 0,
          hiresCount: 0,
          rating: undefined,
          totalSpent: undefined,
          paymentVerified: undefined,
        };
      });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.warn(`Freelancer fetch error for "${keyword}": ${error.message}`);
      return [];
    }
  }

  private cleanText(text: string): string {
    return text
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&#x27;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  private deduplicateJobs(jobs: RawOpportunity[]): RawOpportunity[] {
    const seen = new Set<string>();
    const unique: RawOpportunity[] = [];
    for (const job of jobs) {
      const key = job.url || `${job.title}|${job.platform}`;
      if (key && !seen.has(key)) {
        seen.add(key);
        unique.push(job);
      }
    }
    return unique;
  }
}