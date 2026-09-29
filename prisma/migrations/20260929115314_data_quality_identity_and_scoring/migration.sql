-- DropIndex
DROP INDEX "market_facts_date_idx";

-- DropIndex
DROP INDEX "opportunities_platform_idx";

-- DropIndex
DROP INDEX "opportunities_viewed_idx";

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "authenticitySignals" TEXT,
ADD COLUMN     "authenticityStatus" TEXT NOT NULL DEFAULT 'uncertain',
ADD COLUMN     "authenticityWarnings" TEXT,
ADD COLUMN     "canonicalJobId" TEXT,
ADD COLUMN     "canonicalReason" TEXT,
ADD COLUMN     "canonicalUrl" TEXT,
ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "duplicateClusterId" TEXT,
ADD COLUMN     "duplicateConfidence" DOUBLE PRECISION,
ADD COLUMN     "duplicateStatus" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "firstSeenAt" TIMESTAMP(3),
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "leadBand" TEXT,
ADD COLUMN     "leadReasons" TEXT,
ADD COLUMN     "leadRisks" TEXT,
ADD COLUMN     "leadScore" INTEGER,
ADD COLUMN     "leadScoredAt" TIMESTAMP(3),
ADD COLUMN     "postedAt" TIMESTAMP(3),
ADD COLUMN     "reviewCount" INTEGER,
ADD COLUMN     "sourceJobId" TEXT;

-- CreateIndex
CREATE INDEX "cron_logs_timestamp_idx" ON "cron_logs"("timestamp");

-- CreateIndex
CREATE INDEX "market_facts_dimension_date_idx" ON "market_facts"("dimension", "date");

-- CreateIndex
CREATE INDEX "opportunities_postedAt_idx" ON "opportunities"("postedAt");

-- CreateIndex
CREATE INDEX "opportunities_platform_postedAt_idx" ON "opportunities"("platform", "postedAt");

-- CreateIndex
CREATE INDEX "opportunities_contentHash_idx" ON "opportunities"("contentHash");

-- CreateIndex
CREATE INDEX "opportunities_canonicalUrl_idx" ON "opportunities"("canonicalUrl");

-- CreateIndex
CREATE INDEX "opportunities_duplicateClusterId_idx" ON "opportunities"("duplicateClusterId");

-- CreateIndex
CREATE INDEX "opportunities_leadScore_idx" ON "opportunities"("leadScore");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_platform_sourceJobId_key" ON "opportunities"("platform", "sourceJobId");

-- CreateIndex
CREATE INDEX "user_sessions_lastSeen_idx" ON "user_sessions"("lastSeen");

-- CreateIndex
CREATE INDEX "user_sessions_startTime_idx" ON "user_sessions"("startTime");

-- ---------------------------------------------------------------------------
-- Backfill: time fields
-- ---------------------------------------------------------------------------
-- Every existing row carries the real source posting time inside the
-- rawPayload JSON string (verified: 1402/1402 rows contain a postedAt key).
-- Lift it into the new queryable column so "latest" means posting order
-- instead of insert order, and so the scheduler can GROUP BY posting hour
-- instead of reading and JSON-parsing every rawPayload blob.
--
-- Guarded so a malformed payload cannot abort the migration:
--   - only rows whose rawPayload actually parses as JSON
--   - only values that parse as a timestamp
--   - never a future timestamp (a future postedAt would pin a row to the top
--     of the feed and exempt it from age-based purging)
--
-- The timezone handling here is explicit on purpose. `'...Z'::timestamp`
-- silently DISCARDS the offset, and `NOW()::timestamp` resolves using the
-- session's TimeZone setting -- so on a server whose session is not UTC the
-- naive-but-UTC convention Prisma uses for these columns would be shifted by
-- the offset for every row. Parse as timestamptz, then pin to UTC.
UPDATE "opportunities"
SET "postedAt" = LEAST(
      ((("rawPayload"::jsonb ->> 'postedAt')::timestamptz) AT TIME ZONE 'UTC')::timestamp(3),
      (NOW() AT TIME ZONE 'UTC')::timestamp(3)
    )
WHERE "postedAt" IS NULL
  AND "rawPayload" IS NOT NULL
  AND "rawPayload" ~ '^\s*\{'
  AND ("rawPayload"::jsonb ->> 'postedAt') IS NOT NULL
  AND ("rawPayload"::jsonb ->> 'postedAt') ~ '^\d{4}-\d{2}-\d{2}';

-- Rows we could not resolve fall back to createdAt, which is when this
-- database first saw them. That is an honest lower bound, not a source fact.
UPDATE "opportunities" SET "postedAt" = "createdAt" WHERE "postedAt" IS NULL;

-- createdAt has always been the first-seen retention anchor; firstSeenAt makes
-- that explicit rather than implied. lastSeenAt starts equal and is advanced by
-- each sync that still returns the listing.
UPDATE "opportunities" SET "firstSeenAt" = "createdAt" WHERE "firstSeenAt" IS NULL;
UPDATE "opportunities" SET "lastSeenAt"  = "createdAt" WHERE "lastSeenAt"  IS NULL;

-- ---------------------------------------------------------------------------
-- Backfill: identity
-- ---------------------------------------------------------------------------
-- sourceJobId, canonicalUrl and contentHash are deliberately NOT backfilled
-- here. Their authoritative implementation is src/lib/identity.ts, and having
-- a second copy of that logic in SQL would guarantee the two drift apart.
-- Run `npm run backfill:identity` once after this migration; it is idempotent
-- and only writes rows where the value is still NULL.
