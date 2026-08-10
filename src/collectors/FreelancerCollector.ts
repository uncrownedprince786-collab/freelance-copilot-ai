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

  async fetch(searchKeywords?: string[]): Promise<RawOpportunity[]> {
    console.log('Fetching Freelancer opportunities...\n');

    const keywords = searchKeywords && searchKeywords.length > 0 ? searchKeywords : this.keywords;
    const allJobs: RawOpportunity[] = [];

    for (const keyword of keywords) {
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
        const budgetRaw = project.budget || {};
        const budget = budgetRaw.minimum && budgetRaw.maximum
          ? `$${budgetRaw.minimum} - $${budgetRaw.maximum}`
          : (budgetRaw.minimum ? `$${budgetRaw.minimum}` : 'Negotiable');

        const owner = project.owner || {};
        const country = owner.location?.country?.name || owner.country || undefined;
        const clientName = owner.username || owner.display_name || 'Freelancer Client';
        const jobsAwarded = owner.jobs_award_count ?? owner.jobsAwarded ?? undefined;
        const clientSpend = jobsAwarded !== undefined ? `${jobsAwarded} jobs awarded` : undefined;
        const rating = owner.rating ?? owner.score ?? undefined;
        const totalSpent = owner.total_spent ?? owner.totalSpent ?? undefined;
        const paymentVerified = Boolean(owner.payment_verified ?? owner.paymentVerified ?? false);

        return {
          title: this.cleanText(project.title || 'Untitled'),
          description,
          url: `https://www.freelancer.com/projects/${project.seo_url || project.id}`,
          platform: 'Freelancer',
          budget,
          location: country || 'Remote',
          postedAt: new Date((project.submitdate || Date.now() / 1000) * 1000),
          company: clientName,
          status: 'OPEN',
          country,
          clientName,
          clientSpend,
          connections: 1,
          skills,
          experienceLevel: project.experience_level || project.experienceLevel || undefined,
          duration: project.duration || undefined,
          proposalCount: project.bid_count ?? project.bids ?? undefined,
          interviewingCount: project.interviewing_count ?? 0,
          hiresCount: project.hires_count ?? 0,
          rating,
          totalSpent,
          paymentVerified,
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