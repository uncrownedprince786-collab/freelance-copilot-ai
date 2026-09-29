import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { deriveIdentity } from '../src/lib/identity';

/**
 * Backfill sourceJobId, canonicalUrl and contentHash on rows that predate the
 * identity columns.
 *
 * The migration deliberately does NOT do this in SQL. The rules live in
 * `src/lib/identity.ts`, and a second copy of them written in SQL would drift
 * from the first the moment either changed. This script is that one
 * implementation, applied to old rows.
 *
 * Properties this script must have, and does:
 *   - Idempotent. It only writes a column that is still NULL, so running it
 *     twice changes nothing the second time and a half-finished run can
 *     simply be re-run.
 *   - Non-destructive. It never overwrites a value that already exists and
 *     never touches any other column.
 *   - Safe against the unique (platform, sourceJobId) index. Before writing an
 *     id it checks that no other row already claims it, and reports the
 *     collision instead of failing the run.
 *   - Dry by default. Nothing is written without --apply.
 *
 * Usage:
 *   npm run backfill:identity            # report what would change
 *   npm run backfill:identity -- --apply # write it
 */

const APPLY = process.argv.includes('--apply');
const PAGE = 500;
const WRITE_CHUNK = 50;

interface Row {
  id: string;
  platform: string;
  url: string;
  title: string;
  description: string;
  sourceJobId: string | null;
  canonicalUrl: string | null;
  contentHash: string | null;
}

async function main() {
  const t0 = Date.now();
  const total = await prisma.opportunity.count();
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${total} rows in opportunities`);

  // Claimed ids, so the script can detect a collision without a query per row.
  const claimed = new Set<string>();
  for (const r of await prisma.opportunity.findMany({
    where: { sourceJobId: { not: null } },
    select: { platform: true, sourceJobId: true },
  })) {
    claimed.add(`${r.platform}|${r.sourceJobId}`);
  }

  const updates: Array<{ id: string; data: Record<string, string> }> = [];
  const stat = { scanned: 0, sourceJobId: 0, canonicalUrl: 0, contentHash: 0, collisions: 0, unchanged: 0 };
  const collisions: string[] = [];

  let cursor: string | undefined;
  for (;;) {
    const page: Row[] = await prisma.opportunity.findMany({
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true, platform: true, url: true, title: true, description: true,
        sourceJobId: true, canonicalUrl: true, contentHash: true,
      },
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;

    for (const row of page) {
      stat.scanned++;
      const ident = deriveIdentity({
        platform: row.platform, url: row.url, title: row.title, description: row.description,
      });
      const data: Record<string, string> = {};

      if (row.sourceJobId == null && ident.sourceJobId) {
        const key = `${row.platform}|${ident.sourceJobId}`;
        if (claimed.has(key)) {
          // Two existing rows resolve to the same source id: they are the same
          // listing stored twice. Writing the id on both would violate the
          // unique index, so leave this one alone and report it — merging
          // rows is the clustering layer's decision, not a backfill's.
          stat.collisions++;
          if (collisions.length < 20) collisions.push(`${row.id} -> ${key}`);
        } else {
          claimed.add(key);
          data.sourceJobId = ident.sourceJobId;
          stat.sourceJobId++;
        }
      }
      if (row.canonicalUrl == null && ident.canonicalUrl) {
        data.canonicalUrl = ident.canonicalUrl;
        stat.canonicalUrl++;
      }
      if (row.contentHash == null && ident.contentHash) {
        data.contentHash = ident.contentHash;
        stat.contentHash++;
      }

      if (Object.keys(data).length > 0) updates.push({ id: row.id, data });
      else stat.unchanged++;
    }
  }

  console.log(
    `scanned ${stat.scanned} | would set sourceJobId ${stat.sourceJobId}, ` +
    `canonicalUrl ${stat.canonicalUrl}, contentHash ${stat.contentHash} | ` +
    `already complete ${stat.unchanged} | id collisions ${stat.collisions}`,
  );
  for (const c of collisions) console.log('  collision:', c);

  if (!APPLY) {
    console.log(`\nNothing written. Re-run with --apply to write ${updates.length} rows.`);
    await prisma.$disconnect();
    return;
  }

  // Chunked so one failure cannot roll back the whole backfill and so a
  // Neon Free instance is not asked to hold a 1,300-statement transaction.
  let written = 0;
  for (let i = 0; i < updates.length; i += WRITE_CHUNK) {
    const chunk = updates.slice(i, i + WRITE_CHUNK);
    await prisma.$transaction(
      chunk.map(u => prisma.opportunity.update({ where: { id: u.id }, data: u.data })),
    );
    written += chunk.length;
    console.log(`  written ${written}/${updates.length}`);
  }
  console.log(`\nDone. ${written} rows updated in ${Math.round((Date.now() - t0) / 1000)}s.`);
  await prisma.$disconnect();
}

main().catch(async e => {
  console.error('[backfill-identity] failed:', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
