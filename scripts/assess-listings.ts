import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { runAssessmentPass } from '../src/lib/qualityMaintenance';

/**
 * Recompute authenticity and lead score for stored listings.
 *
 * A reporter around `runAssessmentPass`, which is the same code the sync
 * cron runs. Ingestion assesses each listing as it arrives, but the
 * freshness term decays continuously, so a row scored three days ago is
 * scored on a freshness it no longer has.
 *
 * Cheap on purpose: assessment is pure CPU and the cost that matters is the
 * WRITE, which is suppressed for rows whose score merely drifted a point or
 * two. A run that changes nothing meaningful writes nothing at all.
 *
 *   npm run assess            # report
 *   npm run assess -- --apply # write
 */
const APPLY = process.argv.includes('--apply');

async function main() {
  const t0 = Date.now();
  const result = await runAssessmentPass({ apply: APPLY });

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} - ${result.scanned} rows`);
  console.log(`scanned ${result.scanned} | rows needing a write ${result.pendingWrites}`);
  console.log('authenticity:', JSON.stringify(result.statuses));
  console.log('lead bands  :', JSON.stringify(result.bands));

  if (!APPLY) {
    console.log(`\nNothing written. Re-run with --apply to update ${result.pendingWrites} rows.`);
  } else {
    console.log(`\nDone. ${result.written} rows updated in ${Math.round((Date.now() - t0) / 1000)}s.`);
  }
  await prisma.$disconnect();
}

main().catch(async e => {
  console.error('[assess-listings] failed:', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
