import type { ProfileData } from './types';
import type { ProfilePlatform } from '../../lib/profile/url';

export const MAX_MANUAL_PROFILE_CHARS = 20_000;

/**
 * Best-effort platform detection from pasted profile text.
 * Returns null when there is no clear signal.
 */
export function detectPlatformFromText(text: string): ProfilePlatform | null {
  const lower = text.toLowerCase();
  const upworkHits = (lower.match(/upwork/g) || []).length;
  const freelancerHits = (lower.match(/freelancer\.com|freelancer\b/g) || []).length;
  if (upworkHits > 0 && upworkHits >= freelancerHits) return 'upwork';
  if (freelancerHits > 0) return 'freelancer';
  return null;
}

interface LabeledField {
  name: 'name' | 'title' | 'overview' | 'hourlyRate' | 'location' | 'experience';
  label: RegExp;
}

const LABELED_FIELDS: LabeledField[] = [
  { name: 'name', label: /^name\s*:\s*/i },
  { name: 'title', label: /^(?:profile\s+)?title\s*:\s*/i },
  { name: 'overview', label: /^(?:overview|summary|about)\s*:\s*/i },
  { name: 'hourlyRate', label: /^(?:hourly\s+rate|rate)\s*:\s*/i },
  { name: 'location', label: /^location\s*:\s*/i },
  { name: 'experience', label: /^(?:experience|years)\s*:\s*/i },
];

function findLabeledValue(text: string, field: LabeledField): string | undefined {
  const re = new RegExp(`(?:^|\\n)${field.label.source}(.+)(?:\\n|$)`, 'i');
  const m = text.match(re);
  if (!m) return undefined;
  const value = m[1].trim();
  return value.length > 0 ? value.slice(0, 500) : undefined;
}

/**
 * Normalize manually pasted profile content into ProfileData.
 * Only populates fields that are clearly labeled in the text; everything
 * else is left to the AI analysis. Never invents missing information.
 */
export function normalizeManualProfile(rawText: string, platform?: ProfilePlatform | null): ProfileData {
  const text = rawText.trim().slice(0, MAX_MANUAL_PROFILE_CHARS);
  const detectedPlatform = platform ?? detectPlatformFromText(text) ?? 'unknown';

  const profile: ProfileData = {
    platform: detectedPlatform,
    profileUrl: '',
    skills: [],
    rawText: text,
  };

  for (const field of LABELED_FIELDS) {
    const value = findLabeledValue(text, field);
    if (value) profile[field.name] = value;
  }

  // Skills section: "Skills: a, b, c" (only when explicitly labeled).
  const skillsMatch = text.match(/(?:^|\n)(?:skills|skills? list|tech stack)\s*:\s*(.+)(?:\n|$)/i);
  if (skillsMatch) {
    const skills = skillsMatch[1]
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1)
      .slice(0, 30);
    profile.skills = skills;
  }

  // Portfolio section: "Portfolio: item1 | item2" (only when explicitly labeled).
  const portfolioMatch = text.match(/(?:^|\n)portfolio\s*:\s*(.+)(?:\n|$)/i);
  if (portfolioMatch) {
    const items = portfolioMatch[1]
      .split(/[|\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1)
      .slice(0, 20);
    if (items.length) profile.portfolioItems = items;
  }

  // If no labeled overview was found, the whole pasted content is the overview.
  if (!profile.overview) {
    profile.overview = text.length > 1000 ? text.slice(0, 1000) : text;
  }

  return profile;
}
