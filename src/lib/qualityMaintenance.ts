import { prisma } from './db';
import { assessListing, assessmentChanged } from './assess';
import { buildClusters, Cluster, DuplicateCandidate } from './duplicates';

/**
 * The two passes that keep the quality columns true after ingestion:
 * duplicate clustering, which needs a view of every row, and assessment
 * refresh, which is needed because freshness decays continuously.
 *
 * They live here rather than in the scripts so there is ONE implementation.
 * The scripts are reporters around these functions and the sync cron calls
 * the same code — a second copy in either place would drift, which is the
 * exact failure the migration avoided by refusing to re-implement identity
 * in SQL.
 *
 * Both are dry-run capable and both write only where a value actually
 * changes, so a pass over unchanged data costs one read and no writes.
 */

const WRITE_CONCURRENCY = 8;

async function writeAll<T>(items: T[], write: (item: T) => Promise<unknown>): Promise<number> {
  // Not a transaction: each update is independent and idempotent, and
  // batching them into one blew Prisma's 5s interactive-transaction timeout
  // against Neon's pooled endpoint. See scripts/_applyWrites.ts.
  let done = 0;
  for (let i = 0; i < items.length; i += WRITE_CONCURRENCY) {
    await Promise.all(items.slice(i, i + WRITE_CONCURRENCY).map(write));
    done += Math.min(WRITE_CONCURRENCY, items.length - i);
  }
  return done;
}

export interface ClusteringResult {
  rows: number;
  clusters: Cluster[];
  clusteredRows: number;
  pendingWrites: number;
  written: number;
}

export async function runClusteringPass(
  opts: { apply?: boolean } = {},
): Promise<ClusteringResult> {
  const rows = await prisma.opportunity.findMany({
    select: {
      id: true, platform: true, title: true, description: true, budget: true,
      clientName: true, sourceJobId: true, contentHash: true, postedAt: true,
      firstSeenAt: true, createdAt: true,
      duplicateClusterId: true, canonicalJobId: true, duplicateStatus: true,
      duplicateConfidence: true, canonicalReason: true,
    },
  });

  const candidates: DuplicateCandidate[] = rows.map(r => ({
    id: r.id,
    platform: r.platform,
    title: r.title,
    description: r.description,
    budget: r.budget,
    clientName: r.clientName,
    sourceJobId: r.sourceJobId,
    contentHash: r.contentHash,
    postedAt: r.postedAt,
    firstSeenAt: r.firstSeenAt ?? r.createdAt,
  }));

  const clusters = buildClusters(candidates);

  // Every row gets a target. A row in no cluster is `independent` — it was
  // evaluated and nothing matched, which is a different statement from the
  // `unknown` default meaning "never looked at".
  const targets = new Map<string, {
    duplicateClusterId: string | null;
    canonicalJobId: string | null;
    duplicateStatus: string;
    duplicateConfidence: number | null;
    canonicalReason: string | null;
  }>();
  for (const row of rows) {
    targets.set(row.id, {
      duplicateClusterId: null, canonicalJobId: null,
      duplicateStatus: 'independent', duplicateConfidence: null, canonicalReason: null,
    });
  }
  for (const cluster of clusters) {
    for (const member of cluster.members) {
      targets.set(member.id, {
        duplicateClusterId: cluster.clusterId,
        canonicalJobId: cluster.canonicalId,
        duplicateStatus: member.status,
        duplicateConfidence: member.confidence,
        canonicalReason: member.id === cluster.canonicalId ? cluster.canonicalReason : null,
      });
    }
  }

  const writes: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (const row of rows) {
    const t = targets.get(row.id)!;
    const changed =
      row.duplicateClusterId !== t.duplicateClusterId ||
      row.canonicalJobId !== t.canonicalJobId ||
      row.duplicateStatus !== t.duplicateStatus ||
      row.duplicateConfidence !== t.duplicateConfidence ||
      row.canonicalReason !== t.canonicalReason;
    if (changed) writes.push({ id: row.id, data: t as unknown as Record<string, unknown> });
  }

  const written = opts.apply
    ? await writeAll(writes, w => prisma.opportunity.update({ where: { id: w.id }, data: w.data }))
    : 0;

  return {
    rows: rows.length,
    clusters,
    clusteredRows: clusters.reduce((n, c) => n + c.members.length, 0),
    pendingWrites: writes.length,
    written,
  };
}

export interface AssessmentResult {
  scanned: number;
  pendingWrites: number;
  written: number;
  bands: Record<string, number>;
  statuses: Record<string, number>;
}

const PAGE = 500;

export async function runAssessmentPass(
  opts: { apply?: boolean; now?: Date } = {},
): Promise<AssessmentResult> {
  const now = opts.now ?? new Date();

  // Cluster sizes in one grouped query, so authenticity can see repeated
  // reposting without a per-row lookup. Only clustered rows appear; anything
  // absent stands alone.
  const clusterSizes = new Map<string, number>();
  try {
    const rows = await prisma.opportunity.groupBy({
      by: ['duplicateClusterId'],
      where: { duplicateClusterId: { not: null } },
      _count: { _all: true },
    });
    for (const r of rows) {
      if (r.duplicateClusterId) clusterSizes.set(r.duplicateClusterId, r._count._all);
    }
  } catch {
    // Clustering has not run yet, or the query failed. Assessment proceeds
    // without the repost signal rather than failing outright.
  }

  const writes: Array<{ id: string; data: Record<string, unknown> }> = [];
  const bands: Record<string, number> = {};
  const statuses: Record<string, number> = {};
  let scanned = 0;
  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.opportunity.findMany({
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true, platform: true, title: true, description: true, url: true, budget: true,
        skills: true, experienceLevel: true, proposalCount: true, clientSpend: true,
        clientRating: true, jobsPosted: true, paymentVerified: true, sourceJobId: true,
        postedAt: true, firstSeenAt: true, createdAt: true,
        duplicateClusterId: true,
        authenticityStatus: true, authenticitySignals: true, authenticityWarnings: true,
        leadScore: true, leadBand: true, leadReasons: true, leadRisks: true,
      },
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;

    for (const row of page) {
      scanned++;
      const next = assessListing({
        platform: row.platform,
        title: row.title,
        description: row.description,
        url: row.url,
        budget: row.budget,
        sourceJobId: row.sourceJobId,
        skills: row.skills,
        experienceLevel: row.experienceLevel,
        proposalCount: row.proposalCount,
        // The count was captured when the row was first stored and is never
        // refreshed. Passing `now` would claim a days-old figure is current.
        competitionObservedAt: row.firstSeenAt ?? row.createdAt,
        clientSpend: row.clientSpend,
        clientRating: row.clientRating,
        jobsPosted: row.jobsPosted,
        paymentVerified: row.paymentVerified,
        postedAt: row.postedAt,
        clusterSize: row.duplicateClusterId
          ? (clusterSizes.get(row.duplicateClusterId) ?? 1)
          : 1,
      }, now);

      bands[next.leadBand] = (bands[next.leadBand] ?? 0) + 1;
      statuses[next.authenticityStatus] = (statuses[next.authenticityStatus] ?? 0) + 1;
      if (assessmentChanged(row, next)) {
        writes.push({ id: row.id, data: next as unknown as Record<string, unknown> });
      }
    }
  }

  const written = opts.apply
    ? await writeAll(writes, w => prisma.opportunity.update({ where: { id: w.id }, data: w.data }))
    : 0;

  return { scanned, pendingWrites: writes.length, written, bands, statuses };
}

// ── Cadence ────────────────────────────────────────────────────────────

const MAINTENANCE_KEY = 'quality:lastMaintenance';

/** How often the post-sync maintenance is allowed to run. */
export function getMaintenanceIntervalMs(): number {
  const n = Number(process.env.QUALITY_MAINTENANCE_INTERVAL_MIN);
  const minutes = Number.isFinite(n) && n > 0 ? n : 180;
  return minutes * 60_000;
}

/**
 * Run clustering and re-assessment after a sync, at most once per interval.
 *
 * Rate-limited rather than run every sync because clustering needs to read
 * every row: with ~10 syncs a day that would be ten full-table reads on a
 * free-tier database to find, typically, nothing new. The writes themselves
 * are already suppressed when nothing changed, so the read is the cost worth
 * bounding.
 *
 * Never throws. Maintenance failing must not fail the sync that just
 * succeeded in bringing in new jobs.
 */
export async function runPostSyncMaintenance(
  opts: { force?: boolean; now?: Date } = {},
): Promise<{ ran: boolean; reason: string; clustering?: ClusteringResult; assessment?: AssessmentResult }> {
  const now = opts.now ?? new Date();
  try {
    if (!opts.force) {
      const rec = await prisma.systemKv.findUnique({ where: { key: MAINTENANCE_KEY } });
      const last = rec?.value ? (JSON.parse(rec.value).at ?? 0) : 0;
      const wait = getMaintenanceIntervalMs();
      if (last && now.getTime() - last < wait) {
        const mins = Math.ceil((wait - (now.getTime() - last)) / 60_000);
        return { ran: false, reason: `next quality maintenance in ~${mins} min` };
      }
    }

    const clustering = await runClusteringPass({ apply: true });
    const assessment = await runAssessmentPass({ apply: true, now });

    await prisma.systemKv.upsert({
      where: { key: MAINTENANCE_KEY },
      create: { key: MAINTENANCE_KEY, value: JSON.stringify({ at: now.getTime() }), updatedAt: now },
      update: { value: JSON.stringify({ at: now.getTime() }), updatedAt: now },
    }).catch(() => {});

    return { ran: true, reason: 'ok', clustering, assessment };
  } catch (err: unknown) {
    console.warn(
      '[qualityMaintenance] skipped:',
      err instanceof Error ? err.message : err,
    );
    return { ran: false, reason: 'maintenance failed; sync unaffected' };
  }
}
