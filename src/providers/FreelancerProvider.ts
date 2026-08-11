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

      return rawJobs.map(raw => {
        const clientCountry = raw.country || raw.location || 'Remote';
        const clientName = raw.company && !/^freelancer client$/i.test(raw.company) ? raw.company : null;
        const detailSkills = Array.isArray(raw.skills) ? raw.skills : [];

        return {
          id: 'fl-' + (raw.url ? raw.url.split('/').pop()?.replace(/[^a-zA-Z0-9_-]/g, '') : Math.random().toString(36).substring(7)),
          url: raw.url,
          title: raw.title,
          description: raw.description || '',
          skills: detailSkills,
          budget: typeof raw.budget === 'object' && raw.budget
            ? {
                type: raw.budget.type === 'hourly' ? 'hourly' : 'fixed',
                amount: raw.budget.amount,
                min: raw.budget.min,
                max: raw.budget.max,
                currency: raw.budget.currency,
              }
            : { type: 'fixed', amount: undefined },
          experienceLevel: raw.experienceLevel || null,
          duration: raw.duration || null,
          connectsRequired: null,
          proposalCount: raw.proposalCount ?? null,
          interviewingCount: raw.interviewingCount ?? 0,
          hiresCount: raw.hiresCount ?? 0,
          postedAt: raw.postedAt ? new Date(raw.postedAt) : new Date(),
          client: {
            name: clientName,
            country: clientCountry,
            rating: raw.rating ?? null,
            totalSpent: raw.totalSpent ?? null,
            jobsPosted: raw.jobsPosted ?? null,
            totalHires: raw.totalHires ?? null,
            paymentVerified: raw.paymentVerified ?? null,
            lastActivityAt: raw.lastActivityAt ? new Date(raw.lastActivityAt) : null,
            openJobs: raw.openJobs ?? null,
          },
          source: 'freelancer',
          score: null,
          fetchedAt: new Date(),
          platform: 'Freelancer',
          country: clientCountry,
          clientName: clientName ?? undefined,
          isNew: true,
        };
      });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error('[FreelancerProvider] Error:', err.message);
      return [];
    }
  }
}
