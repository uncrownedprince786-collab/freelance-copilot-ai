import type { Job } from "../types/job";
import { SerpApiListingsProvider, cleanText } from "./SerpApiListingsBase";
import { parseSerpDate } from "./SerpApiListingsBase";

export class LinkedInProvider extends SerpApiListingsProvider {
  name = "LinkedIn";
  platform = "LinkedIn";
  readonly source = "linkedin" as const;
  protected engine = "linkedin_jobs";

  protected mapRaw(item: Record<string, unknown>): Job | null {
    const idRaw = cleanText(item.job_id ?? item.linkedin_job_id ?? item.id);
    const title = cleanText(item.title ?? item.job_title);
    if (!title) return null;

    const companyObj = item.company;
    const company = cleanText(
      typeof companyObj === "object" && companyObj !== null
        ? (companyObj as { name?: unknown }).name ?? companyObj ?? item.company_name
        : companyObj ?? item.company_name,
    ) || "Company";
    const location = cleanText(item.location ?? "Remote");
    const description = cleanText(item.description ?? item.snippet ?? "");
    const applyUrl = cleanText(item.apply_link ?? item.linkedin_jobs_url ?? item.url);

    let url = applyUrl;
    if (idRaw && !url) {
      url = `https://www.linkedin.com/jobs/view/${encodeURIComponent(String(idRaw))}`;
    }
    if (!url) return null;

    const postedAt = parseSerpDate(item.date_posted ?? item.date ?? item.postedOn);
    if (!postedAt) return null;

    return {
      id: `linkedin-${idRaw || url}`,
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
      source: "linkedin",
      score: null,
      fetchedAt: new Date(),
      platform: "LinkedIn",
      country: location || "Remote",
      clientName: company || undefined,
      isNew: true,
    };
  }
}
