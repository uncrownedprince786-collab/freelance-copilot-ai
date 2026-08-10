import type { Job } from "../types/job";
import { SerpApiListingsProvider, cleanText, toNumberSafe } from "./SerpApiListingsBase";
import { parseSerpDate } from "./SerpApiListingsBase";
import { URL } from "url";

export class IndeedProvider extends SerpApiListingsProvider {
  name = "Indeed";
  platform = "Indeed";
  readonly source = "indeed" as const;
  protected engine = "indeed";

  protected mapRaw(item: Record<string, unknown>): Job | null {
    const idRaw = (item.jobkey ?? item.job_key ?? item.job_id ?? item.id) as string | undefined;
    const title = cleanText(item.jobtitle ?? item.title);
    if (!title) return null;

    const company = cleanText(item.company ?? item.company_name ?? "Company");
    const location = cleanText(item.location ?? item.location ?? "Remote");
    const description = cleanText(item.snippet ?? item.description ?? "");
    const salary = item.salary ? cleanText(item.salary) : "";

    let url = cleanText(item.link ?? item.job_link ?? item.url);
    if (idRaw && !url) {
      url = `https://www.indeed.com/viewjob?jk=${encodeURIComponent(String(idRaw))}`;
    } else if (url && !/^https?:\/\//i.test(url)) {
      url = `https://www.indeed.com${url.startsWith("/") ? "" : "/"}${url}`;
    } else if (url) {
      try {
        new URL(url);
      } catch {
        url = `https://www.indeed.com/viewjob?jk=${encodeURIComponent(String(idRaw || ""))}`;
      }
    }
    if (!url) return null;

    const postedAt = parseSerpDate(item.date ?? item.posted_date);
    if (!postedAt) return null;

    return {
      id: `indeed-${idRaw ?? url}`,
      url,
      title,
      description,
      skills: [],
      budget: salary ? { type: salary.toLowerCase().includes("hour") ? "hourly" : "fixed", amount: toNumberSafe(salary) ?? undefined } : { type: "fixed", amount: undefined },
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
      source: "indeed",
      score: null,
      fetchedAt: new Date(),
      platform: "Indeed",
      country: location || "Remote",
      clientName: company || undefined,
      isNew: true,
    };
  }
}
