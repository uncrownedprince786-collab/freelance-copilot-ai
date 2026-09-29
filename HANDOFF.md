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
    tests       214 unit + 21 PGlite + 77 grounding + 9 ranking, all passing
    browser     375px, no horizontal overflow on feed or job detail
    build       OK

That was not true of the previous tip (`7b3755a`/`82d464f`), which did not
compile. `5f82a95` fixed it — see the commit message for the three defects.

## Where it stopped

All four phases are done and applied. brain.md §8 has the methodology, the
measured numbers behind every decision, and an explicit open-issues list.

    Phase 1  security, cost and the test gate          complete
    Phase 2  identity, duplicates, authenticity,
             freshness, lead scoring                   complete and applied
    Phase 3  Apify/Neon cost, source health, cron      complete except §19
    Phase 4  feed, job detail, About, Intelligence,
             assistant honesty                         complete

**Read brain.md "Open issues" before picking anything up.** Ten verified
items, none speculative. The first needs a human decision rather than code:
`market_facts` history before ~2026-09-23 is corrupt and unrecoverable, and
`/trading` still displays it.

## Database rollout — DONE (2026-09-30)

The migration and all three passes have been applied to the production Neon
database and verified. A snapshot of every table was taken first
(`scratch/snapshot/`, gitignored, not committed). Row counts before and after:
1,332 opportunities in, 1,332 out.

    prisma migrate deploy                 applied, additive only
    npm run backfill:identity -- --apply  1,332 rows
    npm run cluster:duplicates -- --apply 1,332 rows
    npm run assess -- --apply             1,332 rows

Each pass re-runs with **zero** writes, so all three are idempotent against
live data. brain.md §8 has the verified state table.

The branch is now consistent with the production schema, so `npm run sync`
and a deploy are no longer blocked by it.

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
- The repo owner authorised the 2026-09-30 production rollout above. That was
  a one-off; do not run further migrations against production without asking.
- Treat any Neon connection string as a secret. `.env*` is gitignored — keep it
  that way. The connection string currently in `.env` was pasted into a chat
  log and should be rotated in the Neon console.
- Commit small, reviewable increments.
