import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { buildClusters, DuplicateCandidate } from '../src/lib/duplicates';
import { applyWrites } from './_applyWrites';

/**
 * Apply duplicate clustering to the stored listings.
 *
 * Non-destructive by construction: this writes only the five clustering
 * columns and never deletes, hides or merges a row. Every member of a cluster
 * stays queryable, keeps its own URL, and carries the signals behind its
 * status so the UI can explain the verdict instead of asserting it.
 *
 * Idempotent: the clustering itself is a pure function of the rows, and this
 * script writes only where a value actually changes. Running it twice in a row
 * performs zero writes the second time.
 *
 * Usage:
 *   npm run cluster:duplicates            # report what would change
 *   npm run cluster:duplicates -- --apply # write it
 */

const APPLY = process.argv.includes('--apply');

interface Current {
  id: string;
  duplicateClusterId: string | null;
  canonicalJobId: string | null;
  duplicateStatus: string;
  duplicateConfidence: number | null;
  canonicalReason: string | null;
}

type Target = {
  duplicateClusterId: string | null;
  canonicalJobId: string | null;
  duplicateStatus: string;
  duplicateConfidence: number | null;
  canonicalReason: string | null;
};

function changed(a: Current, b: Target): boolean {
  return (
    a.duplicateClusterId !== b.duplicateClusterId ||
    a.canonicalJobId !== b.canonicalJobId ||
    a.duplicateStatus !== b.duplicateStatus ||
    a.duplicateConfidence !== b.duplicateConfidence ||
    a.canonicalReason !== b.canonicalReason
  );
}

async function main() {
  const t0 = Date.now();

  const rows = await prisma.opportunity.findMany({
    select: {
      id: true, platform: true, title: true, description: true, budget: true,
      clientName: true, sourceJobId: true, contentHash: true, postedAt: true,
      firstSeenAt: true, createdAt: true,
      duplicateClusterId: true, canonicalJobId: true, duplicateStatus: true,
      duplicateConfidence: true, canonicalReason: true,
    },
  });
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${rows.length} rows`);

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
    // createdAt has always been the first-seen anchor; firstSeenAt is the
    // explicit column and may still be null on rows the backfill has not
    // reached.
    firstSeenAt: r.firstSeenAt ?? r.createdAt,
  }));

  const clusters = buildClusters(candidates);

  // Every row gets a target. Rows in no cluster are `independent` — they were
  // evaluated and nothing matched, which is a different statement from the
  // `unknown` default meaning "never looked at".
  const targets = new Map<string, Target>();
  for (const row of rows) {
    targets.set(row.id, {
      duplicateClusterId: null,
      canonicalJobId: null,
      duplicateStatus: 'independent',
      duplicateConfidence: null,
      canonicalReason: null,
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

  const writes: Array<{ id: string; data: Target }> = [];
  for (const row of rows) {
    const target = targets.get(row.id)!;
    if (changed(row, target)) writes.push({ id: row.id, data: target });
  }

  const clustered = clusters.reduce((n, c) => n + c.members.length, 0);
  const counts: Record<string, number> = {};
  for (const t of targets.values()) counts[t.duplicateStatus] = (counts[t.duplicateStatus] ?? 0) + 1;

  console.log(
    `clusters ${clusters.length} | clustered rows ${clustered} | ` +
    `independent ${rows.length - clustered} | rows needing a write ${writes.length}`,
  );
  console.log('resulting status counts:', JSON.stringify(counts));

  for (const c of clusters) {
    console.log(`\n  ${c.clusterId} (${c.members.length} members) canonical=${c.canonicalId}`);
    console.log(`    reason: ${c.canonicalReason}`);
    for (const m of c.members) {
      console.log(`    ${m.status.padEnd(18)} ${m.confidence.toFixed(2)}  ${m.id}`);
      console.log(`      signals: ${m.signals.join(', ') || '-'}${m.warnings.length ? ' | warnings: ' + m.warnings.join(', ') : ''}`);
    }
  }

  if (!APPLY) {
    console.log(`\nNothing written. Re-run with --apply to update ${writes.length} rows.`);
    await prisma.$disconnect();
    return;
  }

  // Not a transaction — see scripts/_applyWrites.ts. Each write is
  // independent and idempotent, so a partial run is safe to re-run, and
  // batching 50 of them into one transaction blew Prisma's 5s timeout
  // against Neon's pooled endpoint.
  const written = await applyWrites(
    writes,
    w => prisma.opportunity.update({ where: { id: w.id }, data: w.data }),
  );
  console.log(`\nDone. ${written} rows updated in ${Math.round((Date.now() - t0) / 1000)}s.`);
  await prisma.$disconnect();
}

main().catch(async e => {
  console.error('[cluster-duplicates] failed:', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
