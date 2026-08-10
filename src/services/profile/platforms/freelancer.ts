import type { PlatformAdapter } from './types';
import {
  makeProfileBase,
  findPersonJsonLd,
  extractTitle,
  metaContent,
  stripHtml,
  toNumber,
  arrayFromLd,
  htmlDecode,
} from './base';
import type { ProfileData } from '../types';

/** Derive a username from a Freelancer profile URL. */
export function freelancerHandleFromUrl(profileUrl: string): string {
  const m = profileUrl.match(/\/u\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : '';
}

export const freelancerAdapter: PlatformAdapter = {
  platform: 'freelancer',
  label: 'Freelancer',

  analysisHints: [
    'Freelancer.com profiles are often found by client search, so the title and skill tags should use the exact terms clients search for.',
    'Recommend a concise overview that leads with services offered and the client outcome, mirroring how Freelancer.com displays profile summaries.',
    'Freelancer.com clients compare hourly rates and portfolio breadth; advise specific, competitive positioning.',
    'Highlight badges, certifications, and completed project counts because Freelancer.com surfaces them on search results.',
    'Encourage a clear call-to-action and niche positioning so the profile stands out among many generalists.',
  ],

  hintUrlFor(profileUrl: string): string {
    return profileUrl;
  },

  extract(html: string, profileUrl: string): ProfileData {
    const profile = makeProfileBase('freelancer', profileUrl);
    const person = findPersonJsonLd(html);

    const personName = typeof person?.['name'] === 'string' ? person.name : undefined;
    const jobTitle = typeof person?.['jobTitle'] === 'string' ? person.jobTitle : undefined;
    const description = typeof person?.['description'] === 'string' ? person.description : undefined;
    const aggregateRating = person?.['aggregateRating'] as Record<string, unknown> | undefined;
    const skills = arrayFromLd(person?.['skills']);
    const address = person?.['address'] as Record<string, unknown> | undefined;

    const pageTitle = extractTitle(html);
    const handle = freelancerHandleFromUrl(profileUrl);

    // Freelancer titles look like "username | Freelancer" or "Username - Title | Freelancer".
    let parsedName = personName;
    let parsedTitle = jobTitle;
    if (!parsedName || !parsedTitle) {
      const withoutPlatform = pageTitle.replace(/\s*\|\s*Freelancer\s*$/i, '').trim();
      const dashIndex = withoutPlatform.indexOf(' - ');
      if (dashIndex !== -1) {
        if (!parsedName) parsedName = withoutPlatform.slice(0, dashIndex).trim();
        if (!parsedTitle) parsedTitle = withoutPlatform.slice(dashIndex + 3).trim();
      } else if (!parsedName && withoutPlatform) {
        parsedName = withoutPlatform;
      }
    }

    profile.name = parsedName?.trim() || handle || undefined;
    profile.title = parsedTitle?.trim() || undefined;
    profile.overview = (description || metaContent(html, 'description') || undefined)?.trim() || undefined;
    profile.skills = skills.length > 0 ? skills : metaContent(html, 'keywords').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30);

    if (aggregateRating) {
      const rating = toNumber(aggregateRating['ratingValue']);
      const count = toNumber(aggregateRating['reviewCount']);
      if (rating !== undefined) profile.rating = Math.min(5, Math.max(0, rating));
      if (count !== undefined) profile.reviewsCount = count;
    }

    const addressLocality = typeof address?.['addressLocality'] === 'string' ? address.addressLocality : undefined;
    const addressCountry = typeof address?.['addressCountry'] === 'string' ? address.addressCountry : undefined;
    if (addressLocality) profile.location = addressCountry && addressCountry !== addressLocality ? `${addressLocality}, ${addressCountry}` : addressLocality;
    else if (addressCountry) profile.location = addressCountry;

    profile.education = arrayFromLd(person?.['alumniOf'], 10);
    profile.certifications = arrayFromLd(person?.['hasCredential'], 10);
    profile.portfolioItems = arrayFromLd(person?.['subjectOf'] || person?.['workExample'], 20);

    profile.rawText = stripHtml(html);

    if (!profile.hourlyRate) {
      const rateMatch = html.match(/\$\s?(\d+(?:\.\d+)?)\s*\/\s*hr/i);
      if (rateMatch) profile.hourlyRate = `$${rateMatch[1]}/hr`;
    }
    if (!profile.experience) {
      const expMatch = html.match(/(\d+)\s*\+?\s*years? of experience/i);
      if (expMatch) profile.experience = `${expMatch[1]}+ years`;
    }

    profile.name = typeof profile.name === 'string' ? htmlDecode(profile.name).trim() : profile.name;
    profile.title = typeof profile.title === 'string' ? htmlDecode(profile.title).trim() : profile.title;

    return profile;
  },
};
