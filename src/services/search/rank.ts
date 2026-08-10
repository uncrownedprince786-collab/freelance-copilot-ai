import type { SearchResultJob } from './shape';

/**
 * Deterministic relevance score (0..100) for a job against a query.
 * Combines the job's existing pipeline score with query-token matches.
 */
export function scoreJobForQuery(job: SearchResultJob, tokens: string[]): number {
  const haystack = [
    job.title || '',
    job.description || '',
    Array.isArray(job.skills) ? job.skills.join(' ') : '',
  ].join(' ').toLowerCase();

  if (!haystack) return (job.score ?? 50);

  let relevance = 0;
  const title = (job.title || '').toLowerCase();
  const skillsText = (Array.isArray(job.skills) ? job.skills.join(' ') : '').toLowerCase();

  const effectiveTokens = tokens.map((t) => t.toLowerCase()).filter(Boolean).slice(0, 6);
  for (const token of effectiveTokens) {
    if (title.includes(token)) relevance += 14;
    else if (skillsText.includes(token)) relevance += 11;
    else if (haystack.includes(token)) relevance += 6;
  }

  // Exact-ish phrase match in the title is a strong signal.
  const phrase = effectiveTokens.join(' ');
  if (phrase.length >= 3 && title.includes(phrase)) relevance += 16;

  // Platform mention.
  if (tokens.some((t) => t === 'freelancer') && (job.platform || '').toLowerCase() === 'freelancer') relevance += 8;
  if (tokens.some((t) => t === 'upwork') && (job.platform || '').toLowerCase() === 'upwork') relevance += 8;

  relevance = Math.min(100, relevance);
  const base = job.score ?? 50;
  return Math.min(99, Math.max(0, Math.round(base * 0.4 + relevance * 0.6)));
}

export function dedupeByUrl<T extends { id?: string; url?: string }>(jobs: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const job of jobs) {
    const key = job.url || job.id || '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(job);
  }
  return out;
}

/** Rank jobs by relevance for the query, updating each job's score. */
export function rankJobs(jobs: SearchResultJob[], tokens: string[]): SearchResultJob[] {
  return dedupeByUrl(jobs)
    .map((job) => ({ ...job, score: scoreJobForQuery(job, tokens) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
