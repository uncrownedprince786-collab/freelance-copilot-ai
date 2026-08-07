import { JobProvider } from "./JobProvider";
import { Job } from "../types/job";

export class ApifyUpworkProvider implements JobProvider {
  name = "ApifyUpwork";
  private token = process.env.APIFY_TOKEN;

  async fetchJobs(): Promise<Job[]> {
    if (!this.token) {
      console.warn('[ApifyUpworkProvider] APIFY_TOKEN is missing in environment.');
      return [];
    }

    const endpoint = `https://api.apify.com/v2/actors/blackfalcondata~upwork-scraper/run-sync-get-dataset-items?token=${this.token}`;
    const queries = [
      "client growth manager",
      "telehealth growth manager",
      "marketing strategy",
      "ecommerce growth manager",
      "full stack developer",
      "react developer",
    ];

    const results: Job[] = [];
    const seen = new Set<string>();

    for (const query of queries) {
      if (results.length >= 60) break;

      try {
        console.log(`[ApifyUpworkProvider] Fetching Upwork jobs for: "${query}"...`);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            maxResults: 12,
            sort: "recency",
          }),
        });

        if (!res.ok) {
          console.warn(`[ApifyUpworkProvider] Apify request failed with status: ${res.status}`);
          continue;
        }

        const rawItems = await res.json();
        if (!Array.isArray(rawItems)) continue;

        for (const item of rawItems) {
          if (!item.title || !item.url) continue;

          const normalizedUrl = String(item.url || item.portalUrl || '').trim();
          const dedupeKey = normalizedUrl || `${item.title}|${item.clientName || item.contactName || 'unknown'}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          const postedDate = item.publishTime ? new Date(item.publishTime) : (item.createTime ? new Date(item.createTime) : new Date());
          const country = this.cleanText(item.clientCountry || item.country || item.location || 'Remote');
          const rawContactName = item.contactName || item.clientName || item.companyName || null;
          const clientName = rawContactName && !/client$/i.test(String(rawContactName).trim()) ? String(rawContactName).trim() : null;
          const spentVal = item.clientTotalSpent ? `$${Number(item.clientTotalSpent).toLocaleString()}` : '';
          const description = this.cleanText(item.descriptionMarkdown || item.description || item.summary || item.jobDescription || '');

          let connects = item.connectsRequired ?? null;
          if (connects == null && item.budgetAmount) {
            connects = item.budgetAmount >= 1000 ? 16 : (item.budgetAmount >= 500 ? 12 : 8);
          } else if (connects == null && item.jobType === 'HOURLY') {
            connects = 12;
          }

          const job: Job = {
            id: item.jobId || item.contentHash || normalizedUrl,
            url: normalizedUrl,
            title: this.cleanText(item.title),
            description,
            skills: Array.isArray(item.skills) ? item.skills.map((skill: any) => this.cleanText(String(skill))).filter(Boolean) : [],
            budget: {
              type: item.jobType === 'HOURLY' || item.hourlyBudgetMin ? 'hourly' : 'fixed',
              amount: item.budgetAmount ?? undefined,
              min: item.hourlyBudgetMin ?? item.salaryMin ?? undefined,
              max: item.hourlyBudgetMax ?? item.salaryMax ?? undefined,
            },
            experienceLevel: this.cleanText(item.experienceLevel || item.experience || '') || null,
            duration: this.cleanText(item.engagementDuration || item.duration || '') || null,
            connectsRequired: connects,
            proposalCount: typeof item.totalApplicants === 'number' ? item.totalApplicants : (typeof item.proposalCount === 'number' ? item.proposalCount : null),
            interviewingCount: typeof item.interviewingCount === 'number' ? item.interviewingCount : 0,
            hiresCount: typeof item.totalHired === 'number' ? item.totalHired : (typeof item.hiresCount === 'number' ? item.hiresCount : 0),
            postedAt: postedDate,
            client: {
              name: clientName,
              country: country === 'Remote' ? 'Remote' : country || 'Remote',
              rating: typeof item.clientRating === 'number' ? item.clientRating : (typeof item.clientRating === 'string' ? Number(item.clientRating) || null : null),
              totalSpent: typeof item.clientTotalSpent === 'number' ? item.clientTotalSpent : null,
              jobsPosted: typeof item.clientReviewCount === 'number' ? item.clientReviewCount : null,
              totalHires: typeof item.totalHires === 'number' ? item.totalHires : null,
              paymentVerified: item.clientPaymentVerified ?? null,
              lastActivityAt: item.lastActivityAt ? new Date(item.lastActivityAt) : null,
              openJobs: typeof item.openJobs === 'number' ? item.openJobs : null,
            },
            source: 'upwork',
            score: null,
            fetchedAt: new Date(),
            platform: 'Upwork',
            country: country === 'Remote' ? 'Remote' : country || 'Remote',
            clientName: clientName ?? undefined,
            clientSpend: spentVal,
            connections: connects || 0,
            isNew: true,
          };

          results.push(job);
        }
      } catch (err: any) {
        console.error('[ApifyUpworkProvider] Error fetching:', err.message);
      }
    }

    console.log(`[ApifyUpworkProvider] Total jobs fetched: ${results.length}`);
    return results;
  }

  private cleanText(value: unknown): string {
    if (value == null) return '';
    return String(value)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
