import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { assessListing, assessmentChanged } from '../src/lib/assess';
import { applyWrites } from './_applyWrites';

/**
 * Recompute authenticity and lead score for stored listings.
 *
 * Ingestion assesses each listing as it arrives, but the freshness term
 * decays continuously, so a row scored three days ago is scored on a
 * freshness it no longer has. This pass brings the stored values back in
 * line.
 *
 * It is cheap on purpose. Assessment is pure CPU — the whole table scores in
 * milliseconds — and the cost that matters is the WRITE. `assessmentChanged`
 * suppresses writes for rows whose score merely drifted a point or two, so a
 * run that changes nothing meaningful writes nothing at all. That is what
 * makes it safe to schedule alongside the sync cron on Neon Free.
 *
 * Usage:
 *   npm run assess                # report what would change
 *   npm run assess -- --apply     # write it
 */

const APPLY = process.argv.includes('--apply');
const PAGE = 500;

async function main() {
  const t0 = Date.now();
  const now = new Date();
  const total = await prisma.opportunity.count();
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${total} rows`);

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
        // The proposal count was captured when this row was first stored and
        // is never refreshed, so first-seen IS the observation time. Passing
        // `now` here would claim the figure is current.
        competitionObservedAt: row.firstSeenAt ?? row.createdAt,
        clientSpend: row.clientSpend,
        clientRating: row.clientRating,
        jobsPosted: row.jobsPosted,
        paymentVerified: row.paymentVerified,
        postedAt: row.postedAt,
      }, now);

      bands[next.leadBand] = (bands[next.leadBand] ?? 0) + 1;
      statuses[next.authenticityStatus] = (statuses[next.authenticityStatus] ?? 0) + 1;

      if (assessmentChanged(row, next)) {
        writes.push({ id: row.id, data: next as unknown as Record<string, unknown> });
      }
    }
  }

  console.log(`scanned ${scanned} | rows needing a write ${writes.length}`);
  console.log('authenticity:', JSON.stringify(statuses));
  console.log('lead bands  :', JSON.stringify(bands));

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
  console.error('[assess-listings] failed:', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
