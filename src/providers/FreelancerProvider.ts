import { JobProvider } from "./JobProvider";
import { Job } from "../types/job";
import { FreelancerCollector } from "../collectors/FreelancerCollector";

export class FreelancerProvider implements JobProvider {
  name = "Freelancer";
  private collector = new FreelancerCollector();

  async fetchJobs(): Promise<Job[]> {
    try {
      console.log('[FreelancerProvider] Fetching Freelancer opportunities...');
      const rawJobs = await this.collector.fetch();
      
      return rawJobs.map(raw => ({
        id: 'fl-' + (raw.url ? raw.url.split('/').pop()?.replace(/[^a-zA-Z0-9_-]/g, '') : Math.random().toString(36).substring(7)),
        url: raw.url,
        title: raw.title,
        description: raw.description,
        skills: [],
        budget: {
          type: "fixed",
          amount: undefined
        },
        experienceLevel: null,
        duration: null,
        connectsRequired: null,
        proposalCount: null,
        interviewingCount: 0,
        hiresCount: 0,
        postedAt: raw.postedDate ? new Date(raw.postedDate) : new Date(),
        client: {
          name: raw.company || "Client",
          country: raw.country || raw.location || "Remote",
          rating: null,
          totalSpent: null,
          jobsPosted: null,
          totalHires: null,
          paymentVerified: null,
          lastActivityAt: null,
          openJobs: null
        },
        source: "freelancer",
        score: null,
        fetchedAt: new Date(),
        platform: "Freelancer",
        country: raw.country || raw.location || "Remote",
        clientName: raw.company || "Client",
        isNew: true
      }));
    } catch (err: any) {
      console.error('[FreelancerProvider] Error:', err.message);
      return [];
    }
  }
}
