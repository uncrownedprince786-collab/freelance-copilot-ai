/**
 * Apply many independent row updates against Neon, with bounded concurrency.
 *
 * Deliberately NOT wrapped in a transaction. These passes write one
 * independent, idempotent value per row — the identity backfill only fills
 * columns that are still NULL, and the clustering and assessment passes write
 * a value derived purely from the row. A partial run leaves the table
 * consistent and re-running finishes the job, so a transaction would buy no
 * correctness.
 *
 * It would cost plenty, though. Fifty updates in one transaction over Neon's
 * pooled endpoint exceeded Prisma's 5-second interactive-transaction timeout
 * and rolled the batch back, which is how this helper came to exist. Small
 * concurrent batches finish well inside any limit and keep a free-tier
 * instance from being asked to hold a long write lock.
 */
export async function applyWrites<T>(
  items: T[],
  write: (item: T) => Promise<unknown>,
  opts: { concurrency?: number; label?: string } = {},
): Promise<number> {
  const concurrency = opts.concurrency ?? 8;
  const label = opts.label ?? 'written';
  let done = 0;
  let nextReport = 0;

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    await Promise.all(batch.map(write));
    done += batch.length;
    if (done >= nextReport || done === items.length) {
      console.log(`  ${label} ${done}/${items.length}`);
      nextReport = done + Math.max(50, Math.ceil(items.length / 10));
    }
  }
  return done;
}
