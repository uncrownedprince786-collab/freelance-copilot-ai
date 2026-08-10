import { ALIASES, ROLE_MARKERS, VAGUE_TERMS, ROLE_TAXONOMY, titleCase } from './taxonomy';

/** Split raw input into lowercase tokens. */
export function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
}

/**
 * Expand shorthand to canonical tokens, e.g. "pm" → ["project", "manager"].
 */
function expandAliases(tokens: string[]): string[] {
  const out: string[] = [];
  for (const token of tokens) {
    const alias = ALIASES[token];
    if (alias) out.push(...alias.split(' '));
    else out.push(token);
  }
  return out;
}

/**
 * Turn free-form user input into a clean, canonical query.
 *
 * Examples:
 *   "react dev"   → "React Developer"
 *   "pm saas"     → "SaaS Project Manager"
 *   "full stack"  → "Full Stack"
 */
export function normalizeQuery(input: string): string {
  const raw = input.trim();
  if (!raw) return '';

  const tokens = expandAliases(tokenize(raw));
  if (tokens.length === 0) return '';

  const joined = tokens.join(' ');

  // "project manager" is a two-token role phrase.
  let role = '';
  let remaining: string[] = tokens;
  if (joined.includes('project manager')) {
    role = 'project manager';
    remaining = tokens.filter((t) => t !== 'project' && t !== 'manager');
  } else {
    const markerIndex = remaining.findIndex((t) => ROLE_MARKERS.includes(t));
    if (markerIndex >= 0) {
      role = remaining[markerIndex];
      remaining = remaining.filter((_, i) => i !== markerIndex);
    }
  }

  const prefixWords = new Set(['senior', 'junior', 'lead', 'mid', 'expert', 'freelance']);
  const prefixes = remaining.filter((t) => prefixWords.has(t));
  const qualifiers = remaining.filter((t) => !prefixWords.has(t));

  if (role) {
    return titleCase([...prefixes, ...qualifiers, role].filter(Boolean).join(' '));
  }

  if (qualifiers.length === 0) return titleCase(prefixes.join(' '));
  return titleCase([...prefixes, ...qualifiers].filter(Boolean).join(' '));
}

/**
 * True when the query is too generic to search directly, e.g. just "developer".
 */
export function isVagueQuery(input: string): boolean {
  const normalized = normalizeQuery(input);
  if (!normalized) return true;
  return VAGUE_TERMS.includes(normalized.toLowerCase());
}

/**
 * Suggest better, specific alternatives when the query is too vague.
 */
export function buildAlternatives(input: string): string[] {
  const token = input.trim().toLowerCase();
  if (!token) return [];
  const matches: string[] = [];
  for (const entry of ROLE_TAXONOMY) {
    const roleLower = entry.role.toLowerCase();
    const catLower = entry.category.toLowerCase();
    if (roleLower.includes(token) || catLower.includes(token)) {
      matches.push(entry.role);
    }
  }
  return [...new Set(matches)].slice(0, 8);
}

/**
 * Produce the canonical query plus related role variants (used for search and
 * for the "related" suggestion group). Never invents skills.
 */
export function expandQuery(input: string): string[] {
  const normalized = normalizeQuery(input);
  if (!normalized) return [];
  const lower = normalized.toLowerCase();
  const variants = new Set<string>([normalized]);
  for (const entry of ROLE_TAXONOMY) {
    if (entry.keywords.some((k) => lower.includes(k) || k.includes(lower))) {
      variants.add(entry.role);
    }
  }
  return [...variants].slice(0, 10);
}
