import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { PROVIDER_FOR_PLATFORM, sourceCostReport } from '../src/lib/sourceHealthStore';
import { isEligible, rankByYield } from '../src/lib/sourceHealth';

/**
 * Read-only source health and cost report.
 *
 * Answers the question the cron log cannot: not "how many records did this
 * source return" but "how many USEFUL LEADS, and at what cost". Counting
 * records makes the high-volume source look productive; counting useful
 * leads reverses the ranking.
 *
 *   npm run source:health
 */
async function main() {
  const report = await sourceCostReport(PROVIDER_FOR_PLATFORM);
  const now = new Date();

  if (report.length === 0) {
    console.log('No listings stored yet — nothing to report.');
    await prisma.$disconnect();
    return;
  }

  console.log('\nSOURCE YIELD (from the assessed listings)\n');
  console.log(
    '  source        rows   useful   %useful   avg score   duplicates   suspicious',
  );
  for (const r of report) {
    const pct = (r.yield.usefulRate * 100).toFixed(1) + '%';
    console.log(
      '  ' + r.yield.source.padEnd(12) +
      String(r.yield.rows).padStart(5) +
      String(r.yield.usefulLeads).padStart(9) +
      pct.padStart(10) +
      String(r.yield.averageLeadScore ?? '—').padStart(12) +
      String(r.yield.duplicates).padStart(13) +
      String(r.yield.suspicious).padStart(13),
    );
  }

  console.log('\nCOST (rolling, since telemetry began)\n');
  console.log('  source        runs   ok   records   billed   useful/100 rec   billed/useful lead');
  for (const r of report) {
    console.log(
      '  ' + r.yield.source.padEnd(12) +
      String(r.health.runs).padStart(5) +
      String(r.health.successes).padStart(5) +
      String(r.health.records).padStart(10) +
      String(r.health.billedUnits).padStart(9) +
      String(r.cost.usefulPer100Records ?? 'not observed').padStart(17) +
      String(r.cost.costPerUsefulLead ?? 'n/a (free)').padStart(21),
    );
  }

  console.log('\nHEALTH\n');
  for (const r of report) {
    const h = r.health;
    const eligible = isEligible(h, now) ? 'eligible now' : `backing off until ${h.nextEligibleAt}`;
    console.log(`  ${h.source}: ${h.state} — ${eligible}`);
    console.log(`    runs ${h.runs}, consecutive failures ${h.consecutiveFailures}`);
    console.log(`    last run ${h.lastRunAt ?? 'never'} · last success ${h.lastSuccessAt ?? 'never'}`);
    if (h.lastFailureReason) console.log(`    last failure: ${h.lastFailureReason} (${h.lastFailureAt})`);
    if (h.averageDurationMs != null) console.log(`    average fetch ${Math.round(h.averageDurationMs)}ms`);
  }

  const ranked = rankByYield(report.map(r => r.cost));
  const measured = ranked.filter(r => r.usefulPer100Records != null);
  console.log('\nWHERE EFFORT BELONGS\n');
  if (measured.length === 0) {
    console.log('  No source has enough observations yet to rank. Nothing to conclude.');
  } else {
    measured.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.source} — ${r.usefulPer100Records} useful leads per 100 records`);
    });
    const unmeasured = ranked.filter(r => r.usefulPer100Records == null);
    for (const r of unmeasured) {
      console.log(`  —  ${r.source}: no run telemetry recorded yet, so it is unranked, not ranked last`);
    }
  }
  console.log('');

  await prisma.$disconnect();
}

main().catch(async e => {
  console.error('[source-health] failed:', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
