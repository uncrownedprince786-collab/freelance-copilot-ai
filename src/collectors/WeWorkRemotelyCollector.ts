import { BaseCollector } from "./BaseCollector";
import { RawOpportunity } from "./types";

export class WeWorkRemotelyCollector extends BaseCollector {
  name = "WeWorkRemotely";

  async fetch(): Promise<RawOpportunity[]> {
    console.log('Fetching WeWorkRemotely opportunities...\n');
    
    try {
      const response = await fetch('https://weworkremotely.com/remote-jobs.rss', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!response.ok) {
        console.log('WeWorkRemotely returned', response.status);
        return [];
      }
      
      const text = await response.text();
      const jobs = this.parseRSS(text);
      
      console.log(`Found ${jobs.length} WeWorkRemotely jobs`);
      return jobs;
      
    } catch (error: any) {
      console.warn('WeWorkRemotely fetch failed:', error.message);
      return [];
    }
  }

  private parseRSS(xmlText: string): RawOpportunity[] {
    const jobs: RawOpportunity[] = [];
    
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    const titleRegex = /<title>([\s\S]*?)<\/title>/i;
    const linkRegex = /<link>([\s\S]*?)<\/link>/i;
    const descriptionRegex = /<description>([\s\S]*?)<\/description>/i;
    const encodedRegex = /<content:encoded>([\s\S]*?)<\/content:encoded>/i;
    const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/i;
    
    let match;
    while ((match = itemRegex.exec(xmlText)) !== null) {
      const item = match[1];
      
      const titleMatch = item.match(titleRegex);
      const linkMatch = item.match(linkRegex);
      const descMatch = item.match(descriptionRegex) || item.match(encodedRegex);
      const dateMatch = item.match(pubDateRegex);
      
      if (titleMatch && linkMatch) {
        jobs.push({
          title: this.cleanTitle(titleMatch[1]),
          description: this.cleanDescription(descMatch ? descMatch[1] : ""),
          url: linkMatch[1],
          platform: "WeWorkRemotely",
          budget: "Negotiable",
          location: "Remote",
          postedDate: dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString(),
          company: "Remote Company"
        });
      }
    }
    
    return jobs;
  }

  private cleanTitle(text: string): string {
    return text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private cleanDescription(text: string): string {
    return text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&#x27;/gi, "'")
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li>/gi, '• ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[\t\r\f\v]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .trim();
  }
}