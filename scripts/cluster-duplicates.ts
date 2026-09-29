import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { runClusteringPass } from '../src/lib/qualityMaintenance';

/**
 * Report and optionally apply duplicate clustering.
 *
 * A reporter around `runClusteringPass`. The pass itself lives in
 * `src/lib/qualityMaintenance.ts` and is the same code the sync cron runs —
 * a second copy here would drift from it, which is the failure the identity
 * migration avoided by refusing to re-implement its rules in SQL.
 *
 * Non-destructive by construction: writes only the five clustering columns,
 * never deletes, hides or merges a row. Idempotent — a second consecutive
 * run writes nothing.
 *
 *   npm run cluster:duplicates            # report
 *   npm run cluster:duplicates -- --apply # write
 */
const APPLY = process.argv.includes('--apply');

async function main() {
  const t0 = Date.now();
  const result = await runClusteringPass({ apply: APPLY });

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} - ${result.rows} rows`);
  console.log(
    `clusters ${result.clusters.length} | clustered rows ${result.clusteredRows} | ` +
    `independent ${result.rows - result.clusteredRows} | rows needing a write ${result.pendingWrites}`,
  );

  for (const c of result.clusters) {
    console.log(`\n  ${c.clusterId} (${c.members.length} members) canonical=${c.canonicalId}`);
    console.log(`    reason: ${c.canonicalReason}`);
    for (const m of c.members) {
      console.log(`    ${m.status.padEnd(18)} ${m.confidence.toFixed(2)}  ${m.id}`);
      console.log(
        `      signals: ${m.signals.join(', ') || '-'}` +
        (m.warnings.length ? ' | warnings: ' + m.warnings.join(', ') : ''),
      );
    }
  }

  if (!APPLY) {
    console.log(`\nNothing written. Re-run with --apply to update ${result.pendingWrites} rows.`);
  } else {
    console.log(`\nDone. ${result.written} rows updated in ${Math.round((Date.now() - t0) / 1000)}s.`);
  }
  await prisma.$disconnect();
}

main().catch(async e => {
  console.error('[cluster-duplicates] failed:', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
