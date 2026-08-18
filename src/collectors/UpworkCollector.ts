import { BaseCollector } from "./BaseCollector";
import { RawOpportunity } from "./types";
import * as fs from 'fs';
import { getStoragePath } from "@/lib/storage";

export class UpworkCollector extends BaseCollector {
  name = "Upwork";
  private get quotaFile() { return getStoragePath('.upwork-quota.json'); }
  private totalQuota = 100;
  private searchesUsed = 0;

  private queries = [
    "wordpress php laravel developer upwork",
    "javascript typescript react nextjs developer upwork",
    "nodejs python django developer upwork",
    "full stack web app developer upwork",
    "mobile app developer upwork",
    "react native flutter ios android developer upwork",
    "shopify webflow magento developer upwork",
    "api saas backend developer upwork"
  ];

  private authenticityBlocklist = [
    "data entry",
    "virtual assistant",
    "customer support",
    "video editing",
    "transcription",
    "social media manager",
    "copywriting",
    "article writer",
    "cheap",
    "quick fix",
    "simple website",
    "simple landing page",
    "easy project",
    "low budget"
  ];

  private stackSignals = [
    "wordpress",
    "php",
    "laravel",
    "javascript",
    "typescript",
    "react",
    "nextjs",
    "next.js",
    "node",
    "nodejs",
    "python",
    "django",
    "full stack",
    "mobile",
    "react native",
    "flutter",
    "ios",
    "android",
    "api",
    "web app",
    "saas",
    "shopify",
    "magento",
    "webflow",
    "cms"
  ];

  constructor() {
    super();
    this.loadQuota();
  }

  private loadQuota() {
    try {
      if (fs.existsSync(this.quotaFile)) {
        const data = JSON.parse(fs.readFileSync(this.quotaFile, 'utf-8'));
        const lastReset = new Date(data.lastReset);
        const today = new Date();
        if (lastReset.toDateString() !== today.toDateString()) {
          this.searchesUsed = 0;
          this.saveQuota();
        } else {
          this.searchesUsed = data.searchesUsed || 0;
        }
      }
    } catch {
      this.searchesUsed = 0;
    }
  }

  private saveQuota() {
    fs.writeFileSync(this.quotaFile, JSON.stringify({
      searchesUsed: this.searchesUsed,
      lastReset: new Date().toISOString()
    }, null, 2));
  }

  private showQuotaStatus() {
    const remaining = this.totalQuota - this.searchesUsed;
    console.log('\n========================================');
    console.log('     UPWORK API QUOTA');
    console.log('========================================');
    console.log(`Used: ${this.searchesUsed}/100`);
    console.log(`Remaining: ${remaining}`);
    console.log(`Usage: ${((this.searchesUsed / this.totalQuota) * 100).toFixed(1)}%`);
    if (remaining < 20) {
      console.log(`WARNING: Only ${remaining} searches left!`);
    }
    console.log('========================================\n');
  }

  private getDaysOld(dateString: string): number {
    const today = new Date();
    const posted = new Date(dateString);
    const diffTime = today.getTime() - posted.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  private isRecent(postedDate: string | Date | null | undefined): boolean {
    if (!postedDate) return false;
    const normalized = typeof postedDate === 'string' ? postedDate : postedDate?.toISOString();
    if (!normalized) return false;
    const daysOld = this.getDaysOld(normalized);
    return daysOld <= 2;
  }

  async fetch(): Promise<RawOpportunity[]> {
    console.log('Fetching Upwork opportunities (last 3 days only)...\n');
    
    const remaining = this.totalQuota - this.searchesUsed;
    if (remaining <= 0) {
      console.error('Daily quota exhausted!');
      this.showQuotaStatus();
      return [];
    }

    this.showQuotaStatus();

    const allJobs: RawOpportunity[] = [];
    let searchesUsed = 0;
    
    for (const query of this.queries) {
      if (allJobs.length >= 60) break;
      if (searchesUsed >= remaining) break;
      
      console.log(`Searching: ${query}`);
      
      try {
        const jobs = await this.searchGoogleJobs(query);
        searchesUsed++;
        this.searchesUsed++;
        
        let fallbackJobs: RawOpportunity[] = [];
        if (jobs.length === 0) {
          fallbackJobs = await this.searchPublicUpworkJobs(query);
          if (fallbackJobs.length > 0) {
            console.log(`Used public fallback for: ${query}`);
          }
        }

        const recentJobs = [...jobs, ...fallbackJobs].filter(job => this.isRecent(job.postedDate));
        const openJobs = recentJobs.filter(job => this.isOpen(job.title, job.description));
        
        if (openJobs.length > 0) {
          console.log(`Found ${openJobs.length} recent open jobs`);
          allJobs.push(...openJobs);
        } else {
          console.log('No recent open jobs found');
        }
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        console.warn(`Search failed: ${error.message}`);
      }
    }
    
    this.saveQuota();
    
    const uniqueJobs = this.deduplicateJobs(allJobs);
    
    console.log(`\nTotal unique recent open jobs: ${uniqueJobs.length}`);
    this.showQuotaStatus();
    
    return uniqueJobs;
  }

  private isOpen(title: string, description: string): boolean {
    const text = (title + " " + description).toLowerCase();
    const closedIndicators = ['hired', 'filled', 'closed', 'position filled', 'no longer accepting'];
    return !closedIndicators.some(ind => text.includes(ind));
  }

  private isLikelyAuthenticJob(job: RawOpportunity): boolean {
    const text = `${job.title} ${job.description}`.toLowerCase();
    if (this.authenticityBlocklist.some((keyword) => text.includes(keyword))) {
      return false;
    }

    const hasStackSignal = this.stackSignals.some((keyword) => text.includes(keyword));
    const hasRoleSignal = /developer|engineer|architect|programmer|full stack|backend|frontend|mobile app|web app|api/i.test(text);

    return hasStackSignal && hasRoleSignal;
  }

  private async searchGoogleJobs(_query: string): Promise<RawOpportunity[]> {
    return [];
  }

  private async searchPublicUpworkJobs(query: string): Promise<RawOpportunity[]> {
    const searchUrls = [
      `https://www.upwork.com/nx/jobs/search/?q=${encodeURIComponent(query)}`,
      `https://www.upwork.com/nx/search/jobs/?q=${encodeURIComponent(query)}`
    ];

    for (const searchUrl of searchUrls) {
      try {
        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'text/html,application/xhtml+xml'
          }
        });
        if (!response.ok) continue;

        const html = await response.text();
        const hrefMatches = html.matchAll(/href=["']([^"']*\/jobs\/~[^"']+)["']/gi);
        const jobs: RawOpportunity[] = [];

        for (const match of hrefMatches) {
          const href = match[1];
          if (!href.includes('upwork.com')) continue;

          const normalizedUrl = href.startsWith('http') ? href : `https://www.upwork.com${href}`;
          const jobId = normalizedUrl.match(/~([A-Za-z0-9_\-=]+)/)?.[1];
          if (!jobId) continue;

          const normalizedJob: RawOpportunity = {
            title: this.cleanTitle(query),
            description: `Public Upwork search result for ${query}`,
            url: normalizedUrl,
            platform: 'Upwork',
            budget: 'Negotiable',
            location: 'Remote',
            postedDate: new Date().toISOString(),
            company: 'Client',
            status: "OPEN",
            connections: 0
          };

          if (this.isLikelyAuthenticJob(normalizedJob)) {
            jobs.push(normalizedJob);
          }
        }

        if (jobs.length > 0) return jobs;
      } catch (error) {
        console.warn(`Public fallback failed for ${query}:`, error);
      }
    }

    return [];
  }

  private parsePostedDate(dateString: string): string | null {
    const now = new Date();
    const ds = dateString.toLowerCase();
    
    if (ds.includes('just now') || ds.includes('moments ago') || ds.includes('today')) {
      return now.toISOString();
    }
    
    const daysMatch = ds.match(/(\d+)\s+days? ago/);
    if (daysMatch) {
      const days = parseInt(daysMatch[1]);
      const date = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      return date.toISOString();
    }
    
    const hoursMatch = ds.match(/(\d+)\s+hours? ago/);
    if (hoursMatch) {
      const hours = parseInt(hoursMatch[1]);
      const date = new Date(now.getTime() - hours * 60 * 60 * 1000);
      return date.toISOString();
    }

    const weeksMatch = ds.match(/(\d+)\s+weeks? ago/);
    if (weeksMatch) {
      const weeks = parseInt(weeksMatch[1]);
      const date = new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
      return date.toISOString();
    }

    const monthsMatch = ds.match(/(\d+)\s+months? ago/);
    if (monthsMatch) {
      const months = parseInt(monthsMatch[1]);
      const date = new Date(now.getTime() - months * 30 * 24 * 60 * 60 * 1000);
      return date.toISOString();
    }

    if (ds.includes('last month')) {
      const date = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return date.toISOString();
    }
    
    return null;
  }

  private cleanTitle(title: string): string {
    return title.replace(/\s*[–\-]\s*Upwork\s*$/i, '').replace(/^Upwork\s*[–\-]\s*/i, '').trim();
  }

  private extractBudget(description: string): string {
    const match = description.match(/\$\d+(?:,\d{3})*(?:\s*-\s*\$\d+(?:,\d{3})*)?/i);
    return match ? match[0] : "Negotiable";
  }

  private deduplicateJobs(jobs: RawOpportunity[]): RawOpportunity[] {
    const seen = new Set<string>();
    const unique: RawOpportunity[] = [];
    
    for (const job of jobs) {
      const match = job.url.match(/~([A-Za-z0-9_\-=]+)/);
      const jobId = match ? match[1] : job.url;
      
      if (!seen.has(jobId)) {
        seen.add(jobId);
        unique.push(job);
      }
    }
    
    return unique;
  }
}