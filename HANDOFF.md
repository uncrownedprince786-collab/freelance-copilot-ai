# Handoff

## What this branch is

`audit/production-hardening` is a work-in-progress production audit. It is
**not merged, not deployed, and not applied to the database.** Do not merge it
to `main` — a push to `main` triggers a Vercel production deploy.

`brain.md` is the source of truth for architecture, findings and decisions.
This file only records where work stopped and what to do next.

## State

The branch tip is green and verified:

    typecheck   clean
    lint        0 errors, 7 pre-existing warnings
    tests       77 unit + 21 PGlite + 77 grounding + 9 ranking, all passing
    build       OK

That was not true of the previous tip (`7b3755a`/`82d464f`), which did not
compile. `5f82a95` fixed it — see the commit message for the three defects.

## Where it stopped

Phase 2 is partly done. Shipped: the migration, the identity layer
(`src/lib/identity.ts`), identity-based ingestion (`src/lib/ingestIdentity.ts`)
and the backfill script. See brain.md §8 "Phase 2 — what shipped so far" for
the methodology and the measured numbers.

Not started, in the order they should probably be taken:

1. **Duplicate clustering and canonical selection.** Columns exist
   (`duplicateClusterId`, `canonicalJobId`, `duplicateStatus`,
   `duplicateConfidence`, `canonicalReason`) and default to `unknown`. Nothing
   computes them. The three measured title-collision pairs in brain.md are the
   test cases to build against — one exact-content pair, one rewritten repost,
   one pair of genuinely distinct jobs.
2. **Authenticity engine.** `authenticityStatus` defaults to `uncertain` for
   every row and nothing changes it.
3. **Lead scoring.** `leadScore` is null everywhere, by design — an unscored
   row must not carry a fabricated default.
4. **Freshness states**, then the UI work (§24–29) and the chatbot (§30–31).

## Before deploying — rollout order

The migration has not been applied to production, and the ingestion code on
this branch writes the columns it creates. Deploying first would break ingest.

    1. apply the migration        (prisma migrate deploy)
    2. npm run backfill:identity  (dry by default — read the report)
    3. npm run backfill:identity -- --apply
    4. deploy

`scripts/backfill-identity.ts` has never actually been executed: production
does not have the columns yet, and there is no local Postgres server here to
rehearse against. Read its dry-run output before trusting it.

## Resuming

The repo is at `C:\Users\NEW TECH\Desktop\MyProject\freelance-copilot-ai`.

```
git checkout audit/production-hardening
npm run verify
```

`npm run verify` is the whole gate: typecheck, lint, every test suite, build.
It should pass at the tip. If it does not, fix that before anything else.

## Standing constraints

- Never push or merge to `main`. A push to `main` triggers a Vercel production
  deploy.
- Do not run database migrations against production from this work.
- Treat any Neon connection string as a secret. `.env*` is gitignored — keep it
  that way. The connection string currently in `.env` was pasted into a chat
  log and should be rotated in the Neon console.
- Commit small, reviewable increments.
