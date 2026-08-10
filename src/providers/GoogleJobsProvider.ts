import type { Job } from "../types/job";
import { SerpApiListingsProvider, cleanText } from "./SerpApiListingsBase";
import { parseSerpDate } from "./SerpApiListingsBase";

export class GoogleJobsProvider extends SerpApiListingsProvider {
  name = "GoogleJobs";
  platform = "Google Jobs";
  readonly source = "google" as const;
  protected engine = "google_jobs";

  protected mapRaw(item: Record<string, unknown>): Job | null {
    const idRaw = cleanText(item.job_id ?? item.job_key ?? item.id);
    const title = cleanText(item.title);
    if (!title) return null;

    const company = cleanText(item.company_name ?? item.company ?? "Company") || "Company";
    const location = cleanText(item.location ?? "Remote");
    const description = cleanText(item.description ?? item.snippet ?? "");

    let url = cleanText(item.job_link ?? item.link ?? item.url);
    if (idRaw && !url) {
      url = `https://www.google.com/search?ibp=htl%3Bjobs&q=${encodeURIComponent(String(idRaw))}`;
    }
    if (!url) return null;

    const postedAt = parseSerpDate(item.date);
    if (!postedAt) return null;

    return {
      id: `google-${idRaw || url}`,
      url,
      title,
      description,
      skills: [],
      budget: { type: "fixed", amount: undefined },
      experienceLevel: null,
      duration: null,
      connectsRequired: null,
      proposalCount: null,
      interviewingCount: 0,
      hiresCount: 0,
      postedAt,
      client: {
        name: company || null,
        country: location || "Remote",
        rating: null,
        totalSpent: null,
        jobsPosted: null,
        totalHires: null,
        paymentVerified: null,
        lastActivityAt: null,
        openJobs: null,
      },
      source: "google",
      score: null,
      fetchedAt: new Date(),
      platform: "Google Jobs",
      country: location || "Remote",
      clientName: company || undefined,
      isNew: true,
    };
  }
}
