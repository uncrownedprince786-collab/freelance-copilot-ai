import { prisma } from './db';
import {
  applyRun,
  costOf,
  parseHealth,
  SourceCost,
  SourceHealthRecord,
  SourceRunOutcome,
  SourceYield,
  sourceHealthKey,
} from './sourceHealth';

/**
 * Persistence for source health. The rules live in `sourceHealth.ts` and are
 * pure; this is the thin layer that reads and writes them.
 *
 * Stored in SystemKv rather than a new table. The pipeline already keeps
 * `provider:<name>` there, the records are one small JSON blob per source,
 * and nothing queries inside them — a table would cost a migration and a
 * join for no gain on a free-tier database.
 */

/** Record one source's run. Never throws: telemetry must not be able to
 *  break ingestion. */
export async function recordSourceRun(
  source: string,
  outcome: SourceRunOutcome,
): Promise<SourceHealthRecord | null> {
  const key = sourceHealthKey(source);
  try {
    const existing = await prisma.systemKv.findUnique({ where: { key } });
    const next = applyRun(parseHealth(source, existing?.value ?? null), outcome);
    const value = JSON.stringify(next);
    await prisma.systemKv.upsert({
      where: { key },
      create: { key, value, updatedAt: new Date() },
      update: { value, updatedAt: new Date() },
    });
    return next;
  } catch (err: unknown) {
    console.warn(
      '[sourceHealth] could not record run for',
      source,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function readSourceHealth(sources: string[]): Promise<SourceHealthRecord[]> {
  try {
    const keys = sources.map(sourceHealthKey);
    const rows = await prisma.systemKv.findMany({ where: { key: { in: keys } } });
    const byKey = new Map(rows.map(r => [r.key, r.value]));
    return sources.map(s => parseHealth(s, byKey.get(sourceHealthKey(s)) ?? null));
  } catch {
    return sources.map(s => parseHealth(s, null));
  }
}

/**
 * Yield per source, straight from the assessed listings.
 *
 * One grouped query, not a scan: the counts come back aggregated so a growing
 * table does not make the admin surface more expensive.
 *
 * `platform` is the stored spelling ("Upwork", "Freelancer"); it is lowercased
 * here so it lines up with the health record keys.
 */
export async function computeSourceYield(): Promise<SourceYield[]> {
  const rows = await prisma.$queryRaw<Array<{
    source: string;
    rows: bigint;
    useful: bigint;
    avg_score: number | null;
    duplicates: bigint;
    suspicious: bigint;
  }>>`
    SELECT lower("platform")                                              AS source,
           COUNT(*)                                                       AS rows,
           COUNT(*) FILTER (WHERE "leadBand" IN ('high','promising'))     AS useful,
           AVG("leadScore")                                               AS avg_score,
           COUNT(*) FILTER (WHERE "duplicateStatus" IN ('duplicate','possible_duplicate')) AS duplicates,
           COUNT(*) FILTER (WHERE "authenticityStatus" = 'suspicious')    AS suspicious
      FROM "opportunities"
     GROUP BY 1
  `;

  return rows.map(r => {
    const total = Number(r.rows);
    const useful = Number(r.useful);
    return {
      source: r.source,
      rows: total,
      usefulLeads: useful,
      usefulRate: total > 0 ? Number((useful / total).toFixed(4)) : 0,
      averageLeadScore: r.avg_score == null ? null : Number(Number(r.avg_score).toFixed(1)),
      duplicates: Number(r.duplicates),
      suspicious: Number(r.suspicious),
    };
  });
}

/**
 * Yield joined to cost telemetry.
 *
 * The health records are keyed by the PROVIDER name the pipeline uses
 * (`apify`, `freelancer`) while yield is keyed by the stored platform
 * (`upwork`, `freelancer`), so the caller supplies the mapping rather than
 * this module guessing at it.
 */
export async function sourceCostReport(
  providerForPlatform: Record<string, string>,
): Promise<Array<{ yield: SourceYield; health: SourceHealthRecord; cost: SourceCost }>> {
  const yields = await computeSourceYield();
  const providers = [...new Set(Object.values(providerForPlatform))];
  const health = await readSourceHealth(providers);
  const byProvider = new Map(health.map(h => [h.source, h]));

  return yields.map(y => {
    const provider = providerForPlatform[y.source] ?? y.source;
    const h = byProvider.get(provider) ?? parseHealth(provider, null);
    return { yield: y, health: h, cost: costOf(y, h) };
  });
}

/** The platform-to-provider mapping this pipeline uses. Upwork listings are
 *  fetched through the Apify actor; Freelancer through its own public API. */
export const PROVIDER_FOR_PLATFORM: Record<string, string> = {
  upwork: 'apify',
  freelancer: 'freelancer',
};
