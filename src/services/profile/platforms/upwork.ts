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

/** Derive a human-friendly handle from an Upwork freelancer URL. */
export function upworkHandleFromUrl(profileUrl: string): string {
  const m = profileUrl.match(/\/freelancers\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).replace(/^~/, '') : '';
}

export const upworkAdapter: PlatformAdapter = {
  platform: 'upwork',
  label: 'Upwork',

  analysisHints: [
    'Upwork titles are limited to 70 characters and are heavily weighted in search ranking; lead with the primary skill plus a specialty differentiator.',
    'Only the first ~2 lines of the Upwork overview appear in search results, so open with a client-focused outcome rather than biography.',
    'Upwork rewards specific skill tags and measurable outcomes; recommend keyword placement without keyword stuffing.',
    'Encourage proof (portfolio items, certifications, completed jobs) because Upwork clients filter heavily on them.',
    'Advise on response-rate and proposal-quality signals since the Upwork algorithm favors strong client response.',
  ],

  hintUrlFor(profileUrl: string): string {
    return profileUrl;
  },

  extract(html: string, profileUrl: string): ProfileData {
    const profile = makeProfileBase('upwork', profileUrl);
    const person = findPersonJsonLd(html);

    const personName = typeof person?.['name'] === 'string' ? person.name : undefined;
    const jobTitle = typeof person?.['jobTitle'] === 'string' ? person.jobTitle : undefined;
    const description = typeof person?.['description'] === 'string' ? person.description : undefined;
    const aggregateRating = person?.['aggregateRating'] as Record<string, unknown> | undefined;
    const skills = arrayFromLd(person?.['skills']);
    const address = person?.['address'] as Record<string, unknown> | undefined;

    const pageTitle = extractTitle(html);

    // Upwork titles are typically: "Name - Job Title | Upwork"
    let parsedName = personName;
    let parsedTitle = jobTitle;
    if (!parsedTitle || !parsedName) {
      const withoutPlatform = pageTitle.replace(/\s*\|\s*Upwork\s*$/i, '').trim();
      const dashIndex = withoutPlatform.indexOf(' - ');
      if (dashIndex !== -1) {
        if (!parsedName) parsedName = withoutPlatform.slice(0, dashIndex).trim();
        if (!parsedTitle) parsedTitle = withoutPlatform.slice(dashIndex + 3).trim();
      } else if (!parsedName && withoutPlatform) {
        parsedName = withoutPlatform;
      }
    }

    profile.name = parsedName?.trim() || upworkHandleFromUrl(profileUrl) || undefined;
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

    // Best-effort hourly rate / experience when explicitly present in the raw text.
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
