-- Data-only migration. No schema change.
--
-- `budgetType` was empty on all 1,332 stored rows while the `budget` JSON
-- blob carried the type on every one of them (435 hourly + 897 fixed =
-- 1,332). Ingestion only ever wrote the type into the blob, never into the
-- column, so the dashboard's job-type filter matched nothing and silently
-- returned an empty feed.
--
-- The write paths are fixed (JobPipeline and collectors/run.ts now derive it),
-- and this backfills the rows that predate that fix.
--
-- Guarded so a malformed budget cannot abort the migration: only rows whose
-- budget parses as a JSON object, and only the two values the pipeline
-- actually produces. Anything else is left empty rather than guessed at.
UPDATE "opportunities"
SET "budgetType" = CASE
      WHEN "budget"::jsonb ->> 'type' = 'hourly' THEN 'hourly'
      WHEN "budget"::jsonb ->> 'type' = 'fixed'  THEN 'fixed'
      ELSE "budgetType"
    END
WHERE ("budgetType" IS NULL OR "budgetType" = '')
  AND "budget" ~ '^\s*\{'
  AND ("budget"::jsonb ->> 'type') IN ('hourly', 'fixed');
