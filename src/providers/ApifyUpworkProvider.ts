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
    
    // Efficient queries to conserve Apify compute tokens
    const queries = ["developer", "full stack"];
    const results: Job[] = [];

    for (const query of queries) {
      if (results.length >= 25) break; // Hard token safety limit

      try {
        console.log(`[ApifyUpworkProvider] Fetching Upwork jobs for: "${query}"...`);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: query,
            maxResults: 15,
            sort: "recency"
          })
        });

        if (!res.ok) {
          console.warn(`[ApifyUpworkProvider] Apify request failed with status: ${res.status}`);
          continue;
        }

        const rawItems = await res.json();
        if (!Array.isArray(rawItems)) continue;

        for (const item of rawItems) {
          if (!item.title || !item.url) continue;

          const postedDate = item.publishTime ? new Date(item.publishTime) : (item.createTime ? new Date(item.createTime) : new Date());

          // Estimate or parse connects required if not directly specified
          let connects = item.connectsRequired || null;
          if (!connects && item.budgetAmount) {
            connects = item.budgetAmount >= 1000 ? 16 : (item.budgetAmount >= 500 ? 12 : 8);
          } else if (!connects && item.jobType === "HOURLY") {
            connects = 12;
          }

          const rawContactName = item.contactName || item.clientName || null;
          // Filter out generic boilerplate like "United States Client" or "Upwork Client"
          const clientName = rawContactName && !rawContactName.toLowerCase().includes('client') ? rawContactName : null;
          const country = item.clientCountry || "Remote";
          const spentVal = item.clientTotalSpent ? `$${item.clientTotalSpent.toLocaleString()}` : "";

          const job: Job = {
            id: item.jobId || item.contentHash || item.url,
            url: item.url || item.portalUrl,
            title: item.title.trim(),
            description: item.descriptionMarkdown || item.description || "",
            skills: Array.isArray(item.skills) ? item.skills : [],
            budget: {
              type: item.jobType === "HOURLY" || item.hourlyBudgetMin ? "hourly" : "fixed",
              amount: item.budgetAmount || undefined,
              min: item.hourlyBudgetMin || item.salaryMin || undefined,
              max: item.hourlyBudgetMax || item.salaryMax || undefined
            },
            experienceLevel: item.experienceLevel || null,
            duration: item.engagementDuration || null,
            connectsRequired: connects,
            proposalCount: item.totalApplicants ?? null,
            interviewingCount: item.interviewingCount ?? 0,
            hiresCount: item.totalHired ?? item.hiresCount ?? 0,
            postedAt: postedDate,
            client: {
              name: clientName,
              country: country,
              rating: item.clientRating ?? null,
              totalSpent: item.clientTotalSpent ?? null,
              jobsPosted: item.clientReviewCount ?? null,
              totalHires: null,
              paymentVerified: item.clientPaymentVerified ?? null,
              lastActivityAt: null,
              openJobs: null
            },
            source: "upwork",
            score: null,
            fetchedAt: new Date(),
            // Legacy UI compatibility
            platform: "Upwork",
            country: country,
            clientName: clientName,
            clientSpend: spentVal,
            connections: connects || 0,
            isNew: true
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
}
