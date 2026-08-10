import { JobProvider } from "./JobProvider";
import { Job } from "../types/job";
import { getJson } from "serpapi";

export class SerpApiGoogleJobsProvider implements JobProvider {
  name = "SerpApiGoogleJobs";

  async fetchJobs(): Promise<Job[]> {
    if (!process.env.SERPAPI_KEY) {
      console.warn('[SerpApiGoogleJobsProvider] SERPAPI_KEY is missing.');
      return [];
    }

    const results: Job[] = [];
    const queries = ["flutter developer upwork", "full stack developer upwork"];

    for (const query of queries) {
      try {
        console.log(`[SerpApiGoogleJobsProvider] Searching: ${query}...`);
        const response = await getJson({
          api_key: process.env.SERPAPI_KEY,
          engine: "google_jobs",
          q: query,
          hl: "en",
          gl: "us"
        });

        if (!response?.jobs_results) continue;

        for (const job of response.jobs_results) {
          const isUpwork =
            (job.link && job.link.includes("upwork.com")) ||
            (job.company_name && job.company_name.toLowerCase().includes("upwork"));

          if (!isUpwork) continue;

          let jobId = null;
          const urlSources = [job.link, job.apply_options?.[0]?.link, job.url];
          for (const source of urlSources) {
            if (source && source.includes("upwork.com")) {
              const match = source.match(/~([A-Za-z0-9_\-=]+)/);
              if (match) {
                jobId = match[1];
                break;
              }
            }
          }

          if (!jobId) continue;

          const desc = job.description || job.title || "";
          const spendMatch = desc.match(/(?:Client spent|Total spent)[:\s]*\$?(\d+[KMBkmb]?)/i);

          const jobObj: Job = {
            id: jobId,
            url: `https://www.upwork.com/jobs/~${jobId}`,
            title: (job.title || "Untitled").replace(/\s*[–\-]\s*Upwork\s*$/i, "").trim(),
            description: desc,
            skills: [],
            budget: { type: "fixed", amount: undefined },
            experienceLevel: null,
            duration: null,
            connectsRequired: null,
            proposalCount: null,
            interviewingCount: 0,
            hiresCount: 0,
            postedAt: new Date(),
            client: {
              name: job.company_name && job.company_name !== "Upwork" ? job.company_name : "Client",
              country: job.location || "Remote",
              rating: null,
              totalSpent: spendMatch ? parseInt(spendMatch[1]) : null,
              jobsPosted: null,
              totalHires: null,
              paymentVerified: null,
              lastActivityAt: null,
              openJobs: null
            },
            source: "google",
            score: null,
            fetchedAt: new Date(),
            platform: "Upwork",
            country: job.location || "Remote",
            clientName: "Client",
            isNew: true
          };

          results.push(jobObj);
        }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        console.warn(`[SerpApiGoogleJobsProvider] Failed: ${err.message}`);
      }
    }

    return results;
  }
}
