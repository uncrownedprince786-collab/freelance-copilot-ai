import { ROLE_TAXONOMY } from './taxonomy';
import { normalizeQuery } from './normalize';

export interface Suggestion {
  label: string;
  source: 'profile' | 'taxonomy' | 'jobs';
}

export interface SuggestResponse {
  expertise: Suggestion[];
  roles: Suggestion[];
  related: Suggestion[];
}

export interface SuggestInput {
  /** Current search-bar text (may be empty). */
  input: string;
  /** Skills/roles the user actually has (from their analyzed profile). */
  expertise: string[];
  /** Real job titles from the feed. */
  jobTitles: string[];
  /** Real job skills from the feed. */
  jobSkills: string[];
  /** Real job text (title + description). */
  jobTexts: string[];
}

/**
 * Build autocomplete suggestions entirely from local/static/user/job data.
 * Never triggers a provider fetch and never invents skills the user lacks.
 */
export function buildSuggestions(data: SuggestInput): SuggestResponse {
  const q = data.input.trim().toLowerCase();
  const expertiseList = data.expertise
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length <= 40)
    .slice(0, 15);

  const expertise: Suggestion[] = [];
  const roles: Suggestion[] = [];
  const related: Suggestion[] = [];
  const seenRoles = new Set<string>();

  // 1. Expertise — only from the user's own profile skills.
  if (q) {
    for (const skill of expertiseList) {
      if (skill.toLowerCase().startsWith(q)) {
        expertise.push({ label: skill, source: 'profile' });
      }
    }
    for (const skill of expertiseList) {
      const derived = normalizeQuery(`${skill} developer`);
      if (derived && derived.toLowerCase().includes(q)) {
        const label = `${skill} Developer`;
        if (!seenRoles.has(label)) {
          expertise.push({ label, source: 'profile' });
          seenRoles.add(label);
        }
      }
    }
  } else {
    // Empty input → surface the user's own expertise as quick picks.
    for (const skill of expertiseList.slice(0, 5)) {
      expertise.push({ label: skill, source: 'profile' });
    }
  }

  // 2. Taxonomy roles that match the query.
  for (const entry of ROLE_TAXONOMY) {
    const label = entry.role.toLowerCase();
    const matches =
      !q ||
      label.startsWith(q) ||
      label.includes(q) ||
      entry.keywords.some((k) => k.startsWith(q) || k.includes(q));
    if (matches && !seenRoles.has(entry.role)) {
      roles.push({ label: entry.role, source: 'taxonomy' });
      seenRoles.add(entry.role);
    }
  }

  // 3. Related roles — variations of the matched query from the taxonomy.
  if (q) {
    for (const entry of ROLE_TAXONOMY) {
      if (entry.keywords.some((k) => k.includes(q) || q.includes(k)) && !seenRoles.has(entry.role)) {
        related.push({ label: entry.role, source: 'taxonomy' });
        seenRoles.add(entry.role);
      }
    }
  }

  // 4. Ground suggestions in live job data: rank taxonomy roles by how many
  //    real jobs mention them, so the most in-demand roles float to the top.
  const jobText = data.jobTexts.join(' ').toLowerCase();
  const demandScore = (keywords: string[]): number => {
    if (!jobText) return 0;
    return keywords.reduce((sum, kw) => (jobText.includes(kw.toLowerCase()) ? sum + 1 : sum), 0);
  };

  // Keep the taxonomy order for clear matches, but append job-grounded roles
  // that were not otherwise shown.
  const jobGrounded = ROLE_TAXONOMY
    .map((entry) => ({ entry, demand: demandScore(entry.keywords) }))
    .filter(({ entry, demand }) => demand > 0 && !seenRoles.has(entry.role))
    .sort((a, b) => b.demand - a.demand)
    .slice(0, 5);

  for (const { entry } of jobGrounded) {
    if (seenRoles.has(entry.role)) continue;
    roles.push({ label: entry.role, source: 'jobs' });
    seenRoles.add(entry.role);
  }

  return {
    expertise: expertise.slice(0, 6),
    roles: roles.slice(0, 8),
    related: related.slice(0, 5),
  };
}
