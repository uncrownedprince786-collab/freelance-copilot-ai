import { BaseCollector } from "./BaseCollector";
import { RawOpportunity } from "./types";

export class FreelancerCollector extends BaseCollector {
  name = "Freelancer";
  private keywords = [
    "wordpress",
    "php laravel",
    "javascript react",
    "nodejs python",
    "mobile app",
    "shopify",
    "full stack",
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
      } catch (error: any) {
        console.warn(`Freelancer search failed for ${keyword}: ${error.message}`);
      }
    }

    const uniqueJobs = this.deduplicateJobs(allJobs);
    console.log(`Total unique Freelancer jobs: ${uniqueJobs.length}`);
    return uniqueJobs;
  }

  private async searchFreelancer(keyword: string): Promise<RawOpportunity[]> {
    // Use full_description=true and user_details=true for richer data
    const params = new URLSearchParams({
      query: keyword,
      limit: "20",
      offset: "0",
      compact: "true",
      full_description: "true",
      "user_details[]": "id",
      "job_details[]": "skills",
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
      const recentProjects = data.result.projects.filter((p: any) => p.submitdate >= sevenDaysAgo);

      return recentProjects.map((project: any): RawOpportunity => {
        // Build description from available fields
        const rawDesc =
          project.description ||
          project.preview_description ||
          project.title ||
          "No description available.";
        const description = this.cleanText(rawDesc);

        const budget = project.budget?.minimum
          ? `$${project.budget.minimum} - $${project.budget.maximum}`
          : "Negotiable";

        const country = project.owner?.location?.country?.name || undefined;
        const clientName = project.owner?.username || "Freelancer Client";
        const jobsAwarded = project.owner?.jobs_award_count;
        const clientSpend = jobsAwarded !== undefined ? `${jobsAwarded} jobs awarded` : undefined;

        return {
          title: project.title?.trim() || "Untitled",
          description,
          url: `https://www.freelancer.com/projects/${project.seo_url || project.id}`,
          platform: "Freelancer",
          budget,
          location: "Remote",
          postedAt: new Date(project.submitdate * 1000),
          company: clientName,
          status: "OPEN",
          country,
          clientName,
          clientSpend,
          connections: 1,
        };
      });
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