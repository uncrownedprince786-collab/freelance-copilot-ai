import { BaseCollector } from "./BaseCollector";
import { RawOpportunity } from "./types";

export class FreelancerCollector extends BaseCollector {
  name = "Freelancer";
  private keywords = [
    "wordpress",
    "php laravel",
    "javascript typescript",
    "react nextjs nodejs",
    "python django",
    "mobile app",
    "shopify webflow",
    "full stack api development"
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
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error: any) {
        console.warn(`Freelancer search failed for ${keyword}: ${error.message}`);
      }
    }
    
    const uniqueJobs = this.deduplicateJobs(allJobs);
    console.log(`Total Freelancer jobs: ${uniqueJobs.length}`);
    
    return uniqueJobs;
  }

  private async searchFreelancer(keyword: string): Promise<RawOpportunity[]> {
    const url = `https://www.freelancer.com/api/projects/0.1/projects/active/?query=${encodeURIComponent(keyword)}&limit=20`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!response.ok) return [];
      
      const data = await response.json();
      
      if (!data.result?.projects) return [];
      
      return Promise.all(data.result.projects.map(async (project: any) => {
        const description = await this.extractDescription(project);
        return {
          title: project.title || "Untitled",
          description,
          url: `https://www.freelancer.com/projects/${project.seo_url}`,
          platform: "Freelancer",
          budget: project.budget?.minimum ? `$${project.budget.minimum}-${project.budget.maximum}` : "Negotiable",
          location: "Remote",
          postedDate: new Date(project.submitdate * 1000).toISOString(),
          company: project.owner?.username || "Freelancer Client"
        };
      }));
      
    } catch (error) {
      return [];
    }
  }

  private async extractDescription(project: any): Promise<string> {
    const candidates = [
      project.description,
      project.preview_description,
      project.description_html,
      project.preview_description_html,
      project.title
    ].filter(Boolean);

    const text = candidates[0];
    const seoUrl = project.seo_url;

    if (seoUrl) {
      const fetchedDescription = await this.fetchProjectPageDescription(seoUrl);
      if (fetchedDescription) return fetchedDescription;
    }

    if (typeof text === 'string' && text.trim().length > 80) {
      return this.normalizeText(text);
    }

    return typeof text === 'string' ? this.normalizeText(text) : 'No detailed description provided yet.';
  }

  private async fetchProjectPageDescription(seoUrl: string): Promise<string | null> {
    try {
      const response = await fetch(`https://www.freelancer.com/projects/${seoUrl}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) return null;

      const html = await response.text();
      const metaMatch = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i);
      if (metaMatch?.[1]) return this.normalizeText(metaMatch[1]);

      const ldMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
      if (ldMatch?.[1]) {
        try {
          const parsed = JSON.parse(ldMatch[1]);
          const description = typeof parsed === 'string' ? parsed : parsed?.description;
          if (description) return this.normalizeText(description);
        } catch {
          // ignore invalid JSON and fall back
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private normalizeText(text: string): string {
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
      const key = `${job.title.toLowerCase().trim()}|${job.platform}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(job);
      }
    }
    
    return unique;
  }
}