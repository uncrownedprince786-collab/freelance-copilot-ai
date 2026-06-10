import { BaseCollector } from "./BaseCollector";
import { RawOpportunity } from "./types";

export class RemoteOkCollector extends BaseCollector {
  name = "RemoteOK";

  async fetch(): Promise<RawOpportunity[]> {
    console.log('Fetching RemoteOK opportunities...\n');
    
    try {
      const response = await fetch('https://remoteok.com/api', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!response.ok) {
        console.log('RemoteOK API returned', response.status);
        return [];
      }
      
      const data = await response.json();
      
      if (!Array.isArray(data)) return [];
      
      const jobs = data.slice(0, 30).map((job: any) => ({
        title: job.position || job.title || "Untitled",
        description: job.description || job.position || "",
        url: job.url || `https://remoteok.com/remote-jobs/${job.slug}`,
        platform: "Remote OK",
        budget: job.salary || "Negotiable",
        location: job.location || "Remote",
        postedDate: job.date ? new Date(job.date).toISOString() : new Date().toISOString(),
        company: job.company || "RemoteOK Client"
      }));
      
      console.log(`Found ${jobs.length} RemoteOK jobs`);
      return jobs;
      
    } catch (error: any) {
      console.warn('RemoteOK fetch failed:', error.message);
      return [];
    }
  }
}