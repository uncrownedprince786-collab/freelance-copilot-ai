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
    tests       159 unit + 21 PGlite + 77 grounding + 9 ranking, all passing
    build       OK

That was not true of the previous tip (`7b3755a`/`82d464f`), which did not
compile. `5f82a95` fixed it — see the commit message for the three defects.

## Where it stopped

**Phase 2 is complete in code and has never touched the database.** Built and
tested: the migration, job identity, identity-based ingestion, duplicate
clustering, the authenticity engine, freshness, lead scoring, and the
assessment pass that writes the quality columns. brain.md §8 has the
methodology and every measured number behind them.

It stopped at the point where the next step needs a decision rather than more
code: applying the migration to production. The standing constraints forbid
running migrations against production from this work, so that call is the
repo owner's.

Not started:

1. **UI (§23–29).** Nothing reads the new columns. The feed still sorts by
   `createdAt`; there is no separate Latest vs Recommended; the job detail
   page does not distinguish source fact from derived value; Trending is
   untouched.
2. **Cron wiring.** `cluster:duplicates` and `assess` are scripts, not
   scheduled passes.
3. **Phase 3** — Apify/Neon cost reduction, adaptive scheduling, source
   health. Note the measurement that motivates it: 781 of 1,332 live rows
   (59%) are already stale or expired.

## Before deploying — rollout order

The migration has not been applied to production, and the ingestion code on
this branch writes the columns it creates. **Running `npm run sync` or
deploying this branch before applying the migration will fail on every
write.**

    1. apply the migration              (prisma migrate deploy)
    2. npm run backfill:identity        -- read the dry-run report
    3. npm run backfill:identity -- --apply
    4. npm run cluster:duplicates       -- read it, then -- --apply
    5. npm run assess                   -- read it, then -- --apply
    6. deploy

Every script is dry by default, idempotent, and writes only where a value
actually changes. None of their write paths has ever been executed: production
does not have the columns, and there is no local Postgres server here to
rehearse against (Docker needs elevation; PGlite is not a server Prisma can
dial). The pure logic behind them is unit-tested, and their dry-run paths are
the same code that produced every number in brain.md — but read each report
before passing `--apply`.

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
