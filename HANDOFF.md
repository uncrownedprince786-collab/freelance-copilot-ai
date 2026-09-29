# Handoff

## What this branch is

`audit/production-hardening` is a work-in-progress production audit. It is **not
merged, not reviewed, and not verified.** Do not merge it to `main`.

The previous session stopped mid-work when the session hit a usage limit. Nothing
was reverted or rewritten at that point — the tree was left exactly as it stood.

## Provenance

The work in `7b3755a` was recovered from a local working tree that had never been
committed, then committed and pushed. Commits `27eb93a` and `de4b1fc` were also
local-only until this branch was first pushed. All three are now on the remote.

Nothing in this branch's history was produced by a completed, passing review. The
final commit is explicitly marked WIP.

## Where it stopped

Mid-refactor, partway through. `7b3755a` is a snapshot of an in-flight editing
session, not a finished increment. Treat the branch tip as a starting position to
continue from, not a deliverable.

## Resuming

The repo is at `C:\Users\NEW TECH\Desktop\MyProject\freelance-copilot-ai`.

```
git checkout audit/production-hardening
```

Establish your own baseline before changing anything: typecheck, lint, and run the
tests. The branch was never verified in its current state, so do not assume the tip
is green. Work out for yourself what is and isn't finished, then continue the audit
from there.

## Standing constraints

- Never push or merge to `main`. A push to `main` triggers a Vercel production deploy.
- Do not run database migrations against production from this work.
- Treat any Neon connection string as a secret. `.env*` is gitignored — keep it that way.
