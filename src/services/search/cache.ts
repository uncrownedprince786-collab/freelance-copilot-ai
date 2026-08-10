import { prisma } from '../../lib/db';
import type { SearchResultJob } from './shape';

const CACHE_KEY = 'search_cache';
const TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ENTRIES = 30;

interface CacheEntry {
  ts: number;
  results: SearchResultJob[];
}

interface CacheDoc {
  entries: Record<string, CacheEntry>;
}

async function loadDoc(): Promise<CacheDoc> {
  try {
    const record = await prisma.systemKv.findUnique({ where: { key: CACHE_KEY } });
    if (!record) return { entries: {} };
    const parsed = JSON.parse(record.value) as CacheDoc;
    return { entries: parsed.entries ?? {} };
  } catch {
    return { entries: {} };
  }
}

async function saveDoc(doc: CacheDoc): Promise<void> {
  try {
    await prisma.systemKv.upsert({
      where: { key: CACHE_KEY },
      update: { value: JSON.stringify(doc) },
      create: { key: CACHE_KEY, value: JSON.stringify(doc) },
    });
  } catch {
    // Non-critical — a failed cache write just means a repeat search refetches.
  }
}

/** Return cached results for a normalized query, or null when expired/missing. */
export async function readSearchCache(normalized: string): Promise<SearchResultJob[] | null> {
  const doc = await loadDoc();
  const entry = doc.entries[normalized];
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) return null;
  return Array.isArray(entry.results) ? entry.results : null;
}

/** Store results for a normalized query (pruning stale/overflow entries). */
export async function writeSearchCache(normalized: string, results: SearchResultJob[]): Promise<void> {
  const doc = await loadDoc();
  const now = Date.now();
  // Drop stale entries, keep the freshest MAX_ENTRIES.
  const pruned = Object.fromEntries(
    Object.entries(doc.entries)
      .filter(([, entry]) => now - entry.ts <= TTL_MS)
      .sort((a, b) => b[1].ts - a[1].ts)
      .slice(0, MAX_ENTRIES - 1),
  );
  pruned[normalized] = { ts: now, results };
  await saveDoc({ entries: pruned });
}
