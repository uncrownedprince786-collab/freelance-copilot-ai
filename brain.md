# Lead Hunter (freelance-copilot-ai) — Brain

Single source of truth for architecture, data flow, and operational decisions.
Keep it current. Keep it short. Git history holds the changelog; this file holds
the **current** state and the **reasons**.

---

## 1. What this product is

A freelance **opportunity intelligence** system. It continuously discovers
freelance listings (Upwork via Apify, Freelancer via their public API) and
surfaces the ones most likely to become real sales leads.

It is **not** "a website of scraped Upwork jobs". The optimisation target is:

> fresh + authentic + unique + commercially useful opportunities per unit of
> infrastructure cost.

Explicitly **not** optimised for: job count, page count, scraper runs, AI calls,
or database rows.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, React 19) |
| DB | Neon Postgres (free tier) via Prisma 7 + `@prisma/adapter-pg` |
| Hosting | Vercel |
| Scheduler | GitHub Actions (`.github/workflows/cron-sync.yml`) — `vercel.json` crons is `[]` |
| Scraping | Apify actor `blackfalcondata/upwork-scraper` (pay-per-event, $5/mo free tier) |
| AI | Gemini / OpenAI / Groq / DeepSeek fallback chain |
| Styling | Inline style objects + `globals.css` dark-mode overrides (Tailwind is installed but **inert** — see 6.4) |

---

## 3. Architecture & data flow

```
Apify Upwork actor        Freelancer public API
        │                          │
        └──────────┬───────────────┘
                   ▼
         JobPipeline.execute()          ← new-job ingestion
         ActiveJobRefresher.refresh()   ← competition-signal refresh only
                   │
                   ▼
         Prisma / Neon Postgres
         (opportunities, market_facts, system_kv, cron_logs,
          user_sessions, analyses, project_tracking)
                   │
                   ▼
    /api/jobs   /api/trends   /api/intelligence   /api/agent   /api/analyze
                   │
                   ▼
    Dashboard (/)   Job detail (/job/[id])   Trends (/trading)
    Intelligence (/intelligence)   Agent panel (global)
```

### Entry points

| Endpoint | Trigger | Auth |
|---|---|---|
| `POST\|GET /api/sync` | GitHub Actions every 30 min | Bearer `CRON_SECRET` or admin cookie |
| `POST\|GET /api/sync/refresh` | same workflow, +5 min | same |
| `GET /api/sync/status` | dashboard on load | **none** |
| `GET /api/jobs` | dashboard, job detail | **none** |
| `GET /api/trends`, `/api/intelligence` | analytics pages | **none** |
| `POST /api/agent`, `/api/analyze` | agent panel, job detail | guest or admin cookie |
| `POST /api/sessions/track` | 90 s heartbeat from every open tab | **none** |

---

## 4. Current data model (as of the audit)

`prisma/schema.prisma`. Models: `Opportunity`, `Analysis`, `ProjectTracking`,
`UserSession`, `CronLog`, `SystemKv`, `MarketFact`.

**Identity today is a single column: `Opportunity.url @unique`.** There is no
`sourceJobId`, no `canonicalUrl`, no content hash, and no duplicate-cluster
field. See 6.1.

**There is no `postedAt` column.** The real source posting time lives only as a
key inside the `rawPayload` JSON *string*. `createdAt` is the first-seen /
retention anchor, not the posting time. See 6.2.

**There is no `prisma/migrations/` directory.** The schema is applied by a human
running `prisma db push` by hand. See 6.3.

### Retention (actual, not intended)

| Table | Pruning | Bounded? |
|---|---|---|
| `opportunities` | 7 days by `createdAt`, plus a 5 000-row safety cap → 4 500 | yes |
| `analyses`, `project_tracking` | cascade from `opportunities` | yes |
| `market_facts` | 45 days | yes (~10–24 k rows) |
| `user_sessions` | 48 **days** (`api/sync/route.ts:56`) — reads like an intended 48 **hours** | weakly |
| `cron_logs` | **none** | **no** |
| `system_kv` | only locks + `trends_cache`; `analysis:<uuid>` rows are never deleted | **no** |

Note: `jobFeed.ts:12-13` documents "40 days once applied", but both purge sites
delete on `createdAt` unconditionally, so **applied jobs are deleted at 7 days**.
The 40-day carve-out in `JobPipeline.purgeExpiredJobs` is dead code — the DB
`deleteMany` that runs after it wins.

---

## 5. Forensic audit — findings matrix

Audited 2026-09-29 at `dd5a0cf` (remote `main`). Four parallel read-only tracks:
data pipeline, frontend/UX, security, database/cost. Every finding below was
read out of the code; none are inferred from documentation.

**Measurement constraint:** there is no `.env` in this checkout and no database
access was available during the audit. Row-count and byte estimates are
parametric on the 5 000-row retention cap and are labelled as estimates. No
claim below depends on a live database — all are code-level facts.

| Area | Current behaviour | Problem | Sev | Proposed fix |
|---|---|---|---|---|
| **Dependencies** | `next@16.3.0` | Two **unauthenticated RCE** advisories (GHSA-p293-qw3h-jr36 path traversal on Windows hosts; GHSA-2xp9-vwfh-vxw4 AVIF image optimisation). Affects `>=16.0.0 <16.3.3`. | **CRIT** | Upgrade to `16.3.7` (patch, non-breaking) |
| **Scraping** | 4 hardcoded queries, `sort: recency`, `maxResults` 8 (sync) / 12 (refresh) | Queries are fixed, not yield-driven. No adaptive scheduling (§16 of the brief). No per-source yield tracking, so "cost per useful lead" cannot be computed. | HIGH | Persist per-query yield; drive query selection and cadence from it |
| **Scraping** | `runQuery` has no `AbortSignal` | `run-sync-get-dataset-items` can hang; on Vercel that burns the function budget and holds the sync lock | HIGH | Add a timeout |
| **Apify cost** | Budget checked once per query, consumed once per **account retry** | With 3 tokens one query can consume 3 budget units after a single check → up to 3× overspend | HIGH | Check remaining before each attempt |
| **Apify cost** | `consumeApifyBudget` is read-modify-write on `SystemKv` | Not atomic; concurrent runs undercount | MED | Atomic increment (single SQL statement) |
| **Apify cost** | `getApifyBudgetRemaining` / `consumeApifyBudget` fail **open** | A KV error allows unbounded billed runs — the exact failure mode the budget exists to prevent | MED | Fail closed on read error; keep a hard per-run ceiling |
| **Cron** | Lock = `findUnique` then `upsert` (`api/sync/route.ts:28-48`) | **Not atomic.** Two concurrent invocations can both observe "no lock" and both proceed. Fails open on error too. | HIGH | Conditional insert / `UPDATE … WHERE` guard, or a Postgres advisory lock |
| **Cron** | `logCronRun` only on the success path | A throw produces no failure record; `/cron-logs` cannot show failures | MED | Log failures too |
| **Failure isolation** | Apify fetch is wrapped; **Freelancer fetch at `JobPipeline.ts:54` is not** | A Freelancer throw aborts the whole pipeline — no save, no market facts, no cron log | HIGH | Wrap per provider |
| **Ingestion** | `saveStore(finalCollection)` upserts **every row in the store**, sequentially, every sync | ~5 000 upserts per run, one round trip each, ~48 ticks/day. Nothing about an unchanged 6-day-old row needs rewriting. | **CRIT** | Upsert only new + genuinely changed rows; batch them |
| **Ingestion** | `loadExistingStore()` = `findMany` with no `select`, no `take` | Loads every column incl. `description` + `rawPayload` for the whole table each sync | **CRIT** | Select only the dedup/merge keys |
| **Ingestion** | `upsert({where:{url}, create:{id: job.id}})` | If the source id already exists under a **different** url, the create violates the PK. Caught and `console.error`'d → silent drop. | HIGH | Separate surrogate PK from source identity |
| **Dedup** | `url` + a naive `normUrlKey` that strips the **entire** query string | Level 1 (source+sourceJobId), Level 3 (content hash) and Level 4 (near-duplicate) are absent. Stripping all query params can merge genuinely distinct jobs; keeping `www.`/case variants splits identical ones. | **CRIT** | Full 4-level scheme + clustering (see 7) |
| **Dedup** | No cluster concept | Duplicates are silently not-inserted, so repost patterns, cross-posts and canonical selection are all invisible | **CRIT** | `duplicate_cluster_id` / `canonical_job_id` / status / confidence / reason |
| **Authenticity** | Does not exist | No authenticity status, no signals, no reason codes. A malformed scraper response becomes a polished job card. | **CRIT** | Deterministic signal engine + status model (see 7) |
| **Lead scoring** | `JobPipeline.calculateScore` — 8 additive rules, clamped 10–99 | (a) Includes `+15 / -10` for matching a **hardcoded personal tech stack** regex (`flutter\|react\|nextjs\|typescript\|nodejs\|full stack\|mobile\|python`) — that is a personal-fit filter, not lead quality. (b) Runs **only for brand-new jobs**; existing rows keep a stale score forever even as competition changes. (c) Output is a bare number; reasons are truncated to the first two. | **CRIT** | Explainable lead model, recomputed on read, with full reason codes |
| **Lead scoring** | `score ?? 70` in `api/jobs/route.ts:67,249` | A **missing** score renders as "Match 70%" in green, counts in the "Hot (70+)" stat, is badged "High Lead" and passes the "Recommended" filter. Fabricated value, indistinguishable from a real one. | **CRIT** | Never default; render "not scored" |
| **Freshness** | One 7-day window; `sort=date` orders by `createdAt` | No freshness states. Because `postedAt` is not a column, the "latest" feed is **insert order, not posting order**. | HIGH | `postedAt` column + freshness states + gradual decay |
| **Neon** | Dashboard downloads the **entire** table client-side in a `do…while` cursor loop (`page.tsx:433-445`), then filters/sorts/searches/facets in the browser | ~23 round trips and ~16 MB per dashboard load at the cap (estimate), re-paid on every platform switch. `/api/jobs` selects `description` **and** `rawPayload` for up to 501 rows. | **CRIT** | Push filter/sort/search/pagination to SQL; one 24-row page; drop the two blob columns from the list select |
| **Neon** | 90 s heartbeat → `/api/sessions/track` → read-modify-write of the whole `events` JSON blob | A write every 90 s **defeats Neon scale-to-zero** for as long as any tab is open. Est. ~115 MB/day/tab of I/O. This is the single largest compute-hour driver. | **CRIT** | Lengthen the interval, append instead of rewrite, or drop the blob |
| **Neon** | `syncSchedule.liveHourCounts()` selects `rawPayload` for every row in a 7-day window and `JSON.parse`s each to build a 24-bucket histogram | ~7.5 MB read to produce 24 integers (estimate) — and it runs on **every dashboard load** via the public, unauthenticated `/api/sync/status` | **CRIT** | `GROUP BY extract(hour from posted_at)` once `postedAt` exists |
| **Neon** | `/api/trends` calls `getRawJobs()` (500 full rows) **before** the cache-hit return, only to read `.length` | Every cache **hit** still costs a 500-row all-column read | HIGH | `count()`, or gate on the cache alone |
| **Neon** | `/api/intelligence` reads the same 500 rows **twice** per request and has no cache at all | Duplicated work on an unauthenticated route | HIGH | Read once; add a cache |
| **Neon** | `src/lib/jobsCache.ts` is **not a cache** — no memo, no `unstable_cache`, just a raw Prisma read | Six call sites treat it as cheap. Zero Next.js caching anywhere in the repo. | HIGH | Make it a real cache or rename it |
| **Neon** | `recordMarketFacts` issues one `upsert` per `(date,dimension,key)` | ~280 round trips per sync (estimate) | HIGH | Single `INSERT … ON CONFLICT DO UPDATE` |
| **Neon** | 7 `Opportunity` indexes | `[platform]` and `[viewed]` are redundant/unused (prefix-covered; `viewed` is never read); `MarketFact.[date]` is prefix-redundant with its unique. Missing: `[score,createdAt]`, `country`, `proposalCount`, `CronLog.timestamp`, `UserSession.lastSeen`/`startTime`, `MarketFact.[dimension,date]`. | HIGH | Rebalance |
| **Schema** | `budget` is a String holding JSON; `skills` is a comma-separated String | Budget cannot be sorted or filtered in SQL — `sort=budget` **silently returns `createdAt` order** (`api/jobs/route.ts:134`). Skill filtering is `ILIKE '%java%'`, which matches `javascript`. Both unindexable. | HIGH | Numeric budget columns; `String[]` + GIN for skills |
| **Migrations** | No `prisma/migrations/`, no migrate script; `prisma.config.ts` points at a directory that does not exist | No history, no rollback, no drift detection. `db push` is silently destructive. Deploys ship code that can outrun the schema — and the defensive `try/catch`-and-degrade blocks then turn that into **silently wrong analytics** rather than a visible error. | **CRIT** | Baseline + `migrate deploy` in the pipeline |
| **Security** | `POST /api/sessions/track` — unauthenticated, `body` is **cast** not validated, entire attacker object spread into the stored array, no byte cap, caller picks its own `role` | ~2 GB per `guestId` (500 events × ~4 MB), unlimited `guestId`s. Cheapest attack in the codebase — no credential needed. Forged `role:"admin"` also poisons the admin dashboard. | **CRIT** | Require auth, bind `guestId` to the signed cookie claim, zod + byte caps |
| **Security** | `POST /api/auth/guest` is unauthenticated and unthrottled; it mints the credential `/api/analyze` and `/api/agent` require. The `guestId` claim is never read by any route. | Combined with the next row: a free, keyless, general-purpose LLM proxy on the owner's keys. Est. **$130–$5 200/day** depending on which provider answers. | **CRIT** | Throttle durably; bind per-guest quotas |
| **Security** | `/api/analyze` builds its prompt from `title`/`description` **in the request body**, not from the DB; 60 000 chars, ×2 attempts, ×up to 4 providers | ~128 k input tokens per button press, arbitrary attacker-chosen text | **CRIT** | Accept `opportunityId`; read the text from the DB |
| **Security** | Scraped job text is interpolated into a prompt block headed *"comply with EVERY one, exactly as written; never skip"* (`MultiAI.ts:221-224`, `gemini.ts:111-112`) | A malicious **listing** becomes a privileged instruction channel: system-prompt exfiltration, forced score inflation, arbitrary text placed into a proposal the user then sends to a real client. No delimiting, no escaping. | **CRIT** | Treat scraped text as data: fence it, and state that text inside the fence is never an instruction |
| **Security** | Request-body `workingJobs`/`resultSets` are interpolated into the **agent system prompt** (`agent/route.ts:467`); `sanitizeJob` only slices, never strips newlines | ~6.5 KB of attacker-controlled system-prompt text per request. `looksLikeInjection` is applied only to the user's own message, never to job data. Also `.replace('{{JOBS}}', …)` expands `$&`/`` $` `` patterns from scraped titles. | HIGH | Strip newlines, fence the block, use a function replacement |
| **Security** | All four rate limiters are process-local `Map`s keyed on left-most `x-forwarded-for` | Per-lambda, reset on cold start, multiplied by concurrency, and the key is client-controlled. Effectively absent. Entries are never evicted → unbounded map growth. | HIGH | Durable counter — the `SystemKv` pattern in `apifyBudget.ts` already proves it works here |
| **Security** | `CRON_SECRET` is **both** the session-cookie HMAC key and the Bearer token sent to `/api/sync` every 30 min from GitHub Actions | Any disclosure of the Bearer value (Actions log, proxy, APM, runner compromise) lets an attacker mint `{"role":"admin"}` cookies. Rotating it breaks the cron. | HIGH | Separate `SESSION_SIGNING_SECRET` |
| **Security** | `GEMINI_API_KEY` in a URL query string (`api/trends/route.ts:142`) | Query strings are recorded by CDN/function logs and proxies. Every other Gemini call in the repo correctly uses a header. | HIGH | `x-goog-api-key` header |
| **Security** | `APIFY_TOKEN` in a URL query string (`ApifyUpworkProvider.ts:305`) | Same exposure; blast radius is scraping quota | MED | `Authorization: Bearer` |
| **Security** | Login limiter keyed on the **raw** `x-forwarded-for`; no lockout; `ADMIN_USERNAME` defaults to `admin`; password compared with `!==` | Rotating the header per request gives effectively unthrottled online password guessing | HIGH | Durable limiter + constant-time compare |
| **Security** | `/api/sync` and `/api/sync/refresh` expose **GET** and accept `?force=true` | `SameSite=Lax` sends cookies on cross-site top-level GET. An admin clicking a link drains the day's Apify budget and triggers the retention `deleteMany`. | MED | Drop GET, or require Bearer on GET |
| **Security** | `window.open(job.url, …)` with no scheme validation (`job/[id]/page.tsx:263`) | `window.open` is imperative, so React's URL sanitisation does not apply. A stored `javascript:` URL executes in the opener's origin. `UpworkCollector` only requires the href to contain `upwork.com`. | MED | Validate `http:`/`https:` at write time and before opening |
| **Security** | No output-token cap on any `MultiAI` provider, nor on the agent's Gemini path; no timeout on the agent's Gemini call — and Gemini is **first** in the chain | Unbounded spend; a hung first provider blocks the turn | MED | Cap and time-limit every call |
| **Frontend** | `/api/jobs` converts **every** server failure into `200 {jobs:[]}`; the dashboard's catch block sets no error state | A database outage renders the full-page *"Setting Up Your Job Feed — Sync in progress"* screen. The user is told a sync is running when the DB is down. Then a 60 s poll retries the whole full-table download forever, from every open tab. | **CRIT** | Distinguish error from empty; surface it; back off |
| **Frontend** | `lastSyncedAt` is fetched and never rendered (`page.tsx:273,488` are its only references) | The dashboard never shows data freshness. A stale feed looks identical to a fresh one. Per-card `timeAgo` is posting time, not collection time. | HIGH | Show last-checked honestly |
| **Frontend** | `repeatClient` is hardcoded `false` in `/api/jobs:80,271` | Six UI features are permanently dead, including copy that asserts *"this client has N other open listings right now"*. The real computation exists in `jobFeed.ts` but `/api/jobs` never imports it. | HIGH | Compute it, or remove the UI |
| **Frontend** | "More from this Client" filters the **50 highest-scoring rows in the DB** | Silently misses almost every real sibling | HIGH | A `?clientKey=` query |
| **Frontend** | `AgentPanel` builds an `AbortController` and never passes `controller.signal` | Both `abort()` calls are no-ops; a 90 s request outlives the panel | HIGH | Pass the signal |
| **Frontend** | `/opportunities/[id]` is unreachable and styled **entirely** in Tailwind | Tailwind emits nothing (no `@import "tailwindcss"` in `globals.css`), so the route would render as unstyled HTML. `src/components/ui/*` and `charts.tsx` (365 lines) exist only to serve it. | HIGH | Delete the route and its dead components |
| **Frontend** | `globals.css` — 164 `html[data-theme='dark']` blocks, 160 `!important`, 100 `[style*="…"]` attribute-substring selectors (14 duplicated in `rgb()` form) | Substring matching **already produces wrong colours**: `[style*="background: #fff"]` is a substring of `#fff7ed`/`#fffbeb`/`#fff8f0`, and the generic rule comes last, so the intended tints never apply. Six selectors are duplicated with contradictory declarations. | HIGH | Replace inline colours with CSS variables |
| **Frontend** | Job Type "All" pill shows `facets.opportunity.all` | Wrong user-facing count — it shrinks when a job-type filter is active | MED | Use the job-type facet |
| **Frontend** | "Recommended" means `score>=70` as a filter pill and `compareOpportunities` as a sort option; the same route is labelled "Market Trends", "Market Trending" and "AI Apply" | Three names for one page, two meanings for one word | MED | Settle the vocabulary |
| **Frontend** | No focus styles anywhere except `.lh-theme-toggle`; `#94a3b8`/`#9ca3af` on white ≈ 2.4–2.5:1 (AA needs 4.5:1), used pervasively; `/cron-logs` and `/admin/sessions` have no `h1`; admin expander is a `div` with `onClick` | Keyboard and low-vision users are locked out of large parts of the UI | HIGH | Focus ring, contrast pass, semantics |
| **Chatbot** | Intent classification and filtering are **fully deterministic**; job **descriptions are never sent** to the chat LLM | Correct by design — do not change | — | — |
| **Chatbot** | `fallbackReply()` is a complete, honest, signal-citing deterministic answerer — reached **only when every provider fails** | Every search/refine/compare/trends turn pays a model call to re-word an answer the system can already produce. This is the §30 requirement violation. | HIGH | Answer deterministically first; use the LLM for the residue |
| **Chatbot** | `agentChat.ts:53` truncates the synthesised user message to 2 000 chars | The message is `extraNote + userText(≤2000) + task(~494)`, so for a long question the **task instruction is silently cut off entirely** | HIGH | Keep the task outside the slice |
| **Chatbot** | `GROK_API_KEY` is used for **two different vendors** — `api.groq.com` in `agentChat.ts` and `api.x.ai` in `MultiAI.ts` | Whichever key is set, the other call site always 401s. One fallback tier is permanently dead. | HIGH | Split into `GROQ_API_KEY` / `XAI_API_KEY` |
| **Chatbot** | `MultiAI.fallbackAnalysis` asserts things it cannot know — *"The client is operating in a scalable, high-ROI vertical"* (triggered by a keyword regex), a `$2000-$5000` bid range from `score>=80`, and `score: 50` / `bidAmount: '$100-200'` as silent defaults for partial JSON | Fabricated intelligence presented as analysis — the §55 violation | HIGH | Label heuristics, or remove them |
| **Testing** | **No test runner, no config, no `*.test.ts`, no `npm test`, no test CI** | `scripts/test-instructions.ts` is a genuine ~60-check suite that exits non-zero — and is wired to nothing. `scripts/test-ranking.ts` imports `./src/lib/…` from inside `scripts/`, so it **cannot run at all**. | **CRIT** | Add a runner; fix the broken import; wire both to CI |

### What is genuinely well built — do not rewrite

1. **Deterministic agent dispatch.** `classifyIntent` + `parseSmartSearch` +
   `applySmartFilters`. No LLM in the filtering path, and the model has **no
   tool surface**, so prompt injection cannot reach the database. Keep this.
2. **Descriptions excluded from the chat prompt** (`serializeJobsForLLM`).
3. **The durable Apify budget** (`apifyBudget.ts`) — `SystemKv`-backed, daily,
   env-overridable. This is the right pattern; the LLM path should copy it.
4. **Two-tier analyze cache with fingerprint revalidation** — L1 in-process +
   L2 `SystemKv`, and a cached entry is re-checked against the current job.
5. **Mechanical instruction enforcement** in `proposalGrounding.ts`
   (`ensureStartsWithWord` etc.) — enforcing beats prompting.
6. **Missing data treated as missing**, with the reasoning documented:
   `compValue → +Infinity`, `timeAgo → 'Time unknown'`, `postedAt` clamped to
   now, budget buckets derived from real quantiles with no empty buckets.
7. **The job detail page's "Key Signals — Why This Ranking"** — says "Not
   provided" and "the platform did not expose a proposal count" instead of
   guessing. This is the model the dashboard should copy.
8. **Provider failover** in `agentChat.ts` (double try/catch) and `MultiAI`.
9. **No raw SQL, no operator injection, no XSS** — all scraped content renders
   through escaped JSX; the single `dangerouslySetInnerHTML` is a static
   literal; `AgentPanel`'s markdown renderer builds React elements, not HTML.
10. **No `.env` in git history** (all commits + 3 stashes checked); no
    hardcoded keys; zero `NEXT_PUBLIC_`; zero `process.env` in client
    components; Apify token redacted to last 4 in logs.
11. **No `err.message` or stack trace returned to any client**; login is
    enumeration-safe.
12. **`repeat(auto-fit, minmax(min(Npx,100%),1fr))`** used consistently — the
    reason a breakpoint-free app does not overflow.

### The one-line summary of the audit

The **infrastructure discipline is real** (durable Apify budget, locks,
cooldowns, honest missing-data handling, no injection, no leaked secrets). The
**product layer the brief is about does not exist yet**: there is no authenticity
model, no duplicate clustering, no explainable lead score, and no freshness
model — and the cost profile is dominated by three fixable patterns (full-table
download per page view, per-row upsert of the whole store per sync, and a 90 s
write that prevents the database from ever idling).

---

## 6. Known structural limitations (current, not yet fixed)

1. **Identity is url-only.** No source job id, canonical url, content hash, or
   cluster. Any tracking-parameter change re-inserts the entire feed as new
   rows, which would trip the 5 000-row cap and mass-purge real data.
2. **`postedAt` is not a column.** Freshness, "latest", and the adaptive
   scheduler all reconstruct it from a JSON string. This single omission causes
   the three most expensive queries in the system.
3. **No migrations.** Schema is applied by hand with `db push`.
4. **Tailwind is installed and inert.** `postcss.config.mjs` registers the
   plugin but `globals.css` has no `@import "tailwindcss"`, so every Tailwind
   class in the repo produces no CSS.
5. **No automated tests, no test CI.**
6. **`vercel.json` crons is `[]`** — GitHub Actions is the only scheduler. If
   the repo is ever archived or Actions minutes run out, ingestion stops
   silently.

---

## 7. Design decisions for the rebuild (agreed direction)

These are the target designs. Status is tracked in section 8.

### 7.1 Duplicate detection — four levels, deterministic

| Level | Key | Meaning |
|---|---|---|
| 1 | `(source, sourceJobId)` | Same source record. Strongest signal. |
| 2 | `canonicalUrl` | Same listing via a different URL form. Strip **known** tracking params only (`utm_*`, `ref`, `gclid`, …) — never strip params that identify the job. |
| 3 | `contentHash` = SHA-256 of normalised `(title, description)` | Byte-identical content. |
| 4 | Similarity signals | Title similarity, description similarity, shared rare phrases, shared skills, same budget, same client, same posting window, same source. |

Levels 1–3 are exact and safe to merge. Level 4 produces a **confidence**, and
low confidence must **link, not merge** — the UI never silently hides a
listing because of an uncertain duplicate decision.

### 7.2 Clustering and canonical selection

Every cluster carries `duplicateClusterId`, `canonicalJobId`,
`duplicateStatus` (`canonical` | `duplicate` | `possible_duplicate` |
`independent` | `unknown`), `duplicateConfidence`, `canonicalReason`.

Canonical selection ranks by: earliest **trustworthy** `postedAt` → presence of
a native source job id → source reliability → data completeness → earliest
`firstSeenAt`. `firstSeenAt` is the **weakest** signal and is never described as
"the original job" — different sources discover the same listing at different
times. `canonicalReason` records which rule decided.

### 7.3 Authenticity — transparent, deterministic first

Status: `verified` | `supported` | `uncertain` | `suspicious` | `stale` |
`rejected`. Never "100% authentic" without evidence. Each record keeps
`signals[]` and `warnings[]` as reason codes, so the UI can always answer *why*.
An LLM is never the arbiter of authenticity.

### 7.4 Lead scoring — explainable, recomputed on read

Dimensions: client quality, opportunity quality, competition, commercial
potential, freshness. Every score ships with the reasons that produced it and
the risks that reduced it. **Personal tech-stack matching is removed from lead
scoring** — it is a fit filter, not a measure of lead value, and belongs in user
preferences if it belongs anywhere.

### 7.5 Freshness — states with gradual decay

`just_posted` | `fresh` | `active` | `aging` | `stale` | `expired`, computed
from a real `postedAt`. Decay is continuous, not a cliff. Stale jobs move to an
archive rather than being deleted.

### 7.6 Source-of-truth labelling

Every surfaced field is tagged **source fact** / **derived** / **heuristic** /
**prediction**, in the code and in the UI. An inferred value is never presented
as source-provided. (Two current violations to fix: fabricated `connects` when
the source omits it, and `client.jobsPosted` populated from
`item.clientReviewCount`, which is a review count, not a job count.)

---

## 8. Status

| Phase | State |
|---|---|
| Forensic audit (§3) | **complete** — section 5 |
| brain.md rewritten as source of truth (§2) | **complete** |
| Baseline verification | typecheck ✅ · lint ✅ · tests ✅ · build ✅ at `cdfbb54` |
| Phase 1 — critical security + cost + test gate | **complete** — `27eb93a` |
| Phase 2 — schema, dedup, authenticity, lead scoring, freshness | **complete in code, unapplied** — every engine built and tested; nothing has touched the database and no UI reads it |
| Phase 3 — Neon/Apify cost reduction | **substantially complete** — write amplification, scheduler query, budget allocation, source health, yield-based scheduling, ops surface and post-sync maintenance all landed; retention archiving (§19) still open |
| Phase 4 — UX revamp, chatbot deterministic-first | **complete** — feed, job detail, About and Intelligence all read the quality layer (`d8488a2`); assistant honesty fixed (`e21ec7e`) |

**Working branch:** `audit/production-hardening` off `dd5a0cf`. Pushed. Not
deployed, not merged. `main` is untouched — a push to `main` triggers a Vercel
production deploy.

### Rollout — DONE (2026-09-30), verified

The migration and all three passes have been applied to the production Neon
database. A full snapshot of every table was taken first (`scratch/snapshot/`,
gitignored) and row counts were checked before and after: **1,332
opportunities in, 1,332 out**, nothing lost.

    prisma migrate deploy                 applied, additive only
    npm run backfill:identity -- --apply  1,332 rows, 50s
    npm run cluster:duplicates -- --apply 1,332 rows, 51s
    npm run assess -- --apply             1,332 rows, 55s

Verified state in production:

| Check | Result |
|---|---|
| rows | 1,332 (unchanged) |
| canonicalUrl / contentHash / postedAt null | 0 / 0 / 0 |
| sourceJobId present | 347 (198 Upwork, 149 Freelancer) |
| `(platform, sourceJobId)` uniqueness violations | 0 |
| postedAt in the future | 0 |
| duplicate status | independent 1,284 · duplicate 22 · canonical 20 · possible 6 |
| authenticity | uncertain 953 · supported 333 · suspicious 46 |
| lead bands | high 49 (75-95) · promising 197 (60-74) · moderate 584 (40-59) · low 499 (11-39) · insufficient 3 |

**All three passes are idempotent against the live data** — re-running each
immediately afterwards wrote 0 rows. For `assess` that also confirms the
write-suppression threshold works: freshness had decayed between the two runs
and no row moved far enough to be worth a write.

Steps 4 and 5 still need to run on a schedule, because freshness decays and
new rows arrive. They are not wired into the cron yet.

### Phase 1 — what shipped (`27eb93a`)

Verified: `tsc --noEmit` ✅ · `eslint` ✅ (7 pre-existing warnings, 0 errors) ·
**121 tests** ✅ (35 new unit + 77 grounding + 9 ranking) · production build ✅.

- **next 16.3.0 → 16.3.7** — closes two unauthenticated RCE advisories.
- **`/api/sessions/track`** — now authenticated; identity from signed cookie
  claims; every stored field explicitly picked, clamped and byte-capped.
- **`/api/analyze`** — requires `opportunityId` and reads the prompt text from
  the database instead of the request body. No longer an open LLM proxy.
- **Prompt injection** — scraped text fenced and demoted to data in `MultiAI`,
  `gemini` and the agent route; fence markers and newlines stripped.
- **`SESSION_SIGNING_SECRET`** split from `CRON_SECRET` (falls back for
  compatibility). Constant-time login. Logout clears the guest cookie.
- **Durable quotas** in `SystemKv` (atomic, fail-closed) for login, guest-cookie
  minting, `/api/analyze`, `/api/agent`.
- **Atomic run locks** (`lib/runLock.ts`), fail-closed.
- **Apify** — token in an `Authorization` header, 90 s deadline, budget
  re-checked before every account retry.
- **Failure isolation** — Freelancer errors no longer abort the pipeline; a
  failed source logs `WARNING` instead of `SUCCESS`.
- **Write amplification** — the pipeline persists only new and changed rows,
  not the entire store, on every sync.
- **Scale-to-zero** — heartbeat 90 s → 5 min and paused when the tab is hidden;
  empty-feed retry now backs off.
- **Error honesty** — `/api/jobs` fails with a status; the dashboard
  distinguishes "feed unavailable" from "no jobs yet".
- **Source-of-truth** — `connects` is no longer invented from the budget;
  `jobsPosted` no longer reads from the review count.
- **Testing** — Node's built-in runner via `tsx` (no new dependency),
  `npm test` / `test:all` / `verify`, and a CI workflow. `test-ranking.ts` was
  previously unrunnable (bad import) and is fixed.

### Phase 2 — what shipped so far (`5f82a95`, `00ac705`, `cdfbb54`)

**Baseline first.** The branch tip did not compile: the deterministic-first
agent refactor called a `reasonFreeForm` that was never written, and left a
`reasonOverTrends` with no caller (`trends` is an always-deterministic shape).
The migration rehearsal also asserted on timestamps read back as JS `Date`s —
`timestamp without time zone` holding UTC wall-clock, materialised by the
driver in the runner's local zone, so the suite passed only on a UTC machine.
Assertions now compare `to_char` text or run inside the database. And no npm
script globbed `*.pgtest.ts`, so 21 tests — including the lock and quota tests
that gate login — never ran. `test:pg` now runs them, inside `test:all`.

**Measured data quality** (read-only probes over the 1,332 live rows, not
estimates):

| Fact | Value |
|---|---|
| Rows | 1,332 — Freelancer 1,134, Upwork 198 |
| Freelancer rows with a project id in the URL | 149 (13%) |
| Upwork rows with the source ciphertext in the URL | 198 (100%) |
| Stored URLs carrying a query string or fragment | 0 |
| Exact-duplicate clusters (identical platform+title+description) | 1 |
| Title collisions | 3 — and they are three *different* cases |

The three title collisions are the whole product question in miniature:

- **CEO Interview Presentation Creation** — byte-identical 836-char
  descriptions, two URLs (slug, and slug+id), two budgets, a day apart. One
  project, or a repost of it.
- **Convert PDF Forms to Excel** — same title, same budget, rewritten
  description. Probably a repost.
- **Lead-Generating Social Media Campaign** — same title, two distinct project
  ids, different budgets and descriptions. Two genuinely different jobs.

Title similarity alone would merge all three. That is why nothing merges on
similarity, and why the content hash is evidence rather than an instruction.

**Root cause of the duplicates.** `FreelancerCollector` builds the URL as
`/projects/${seo_url || project.id}`, and `seo_url` sometimes ends with the
project id and sometimes does not. Both write paths upserted on
`where: { url }`, so one project under two addresses became two rows.

**Identity (`src/lib/identity.ts`)** — three deterministic keys, pure
functions, no clock/DB/network/model:

| Key | Rule | Null when |
|---|---|---|
| `sourceJobId` | Upwork: ciphertext from `/jobs/~0…` (bare and slug forms). Freelancer: trailing 6+ digit project id. | the source gave none — never a guess |
| `canonicalUrl` | folds scheme, `www`, trailing slash, param order, path case (known platforms only); drops fragments and a listed set of tracking params. **Unrecognised params are kept** — one may be the only thing separating two jobs. | the URL is not a safe absolute http(s) URL |
| `contentHash` | sha256 over platform + normalised title + description | under 24 chars of content, so malformed rows do not all hash alike |

`canonicalUrl` is a comparison key, never a link. The UI keeps opening the
original `url` (§27).

**Ingestion (`src/lib/ingestIdentity.ts`)** now resolves identity before
writing — source id, then exact URL, then canonical URL — in **one** query, and
carries the source's own id through from the collector (`project.id` was
already in hand and was being dropped). `contentHash` is stored but is *not* a
match key: the measured identical-content pair has two different budgets, so it
may be a real second opportunity, and merging it at ingest would destroy it.
`postedAt`, `firstSeenAt` and `lastSeenAt` are now written at ingest — the
migration only backfilled existing rows, so every new row would have had them
NULL.

**Dry run over all 1,332 production rows** (read-only): `sourceJobId`
Freelancer 13% / Upwork 100%, `canonicalUrl` 100%, `contentHash` 100%,
**0** groups that would violate the unique `(platform, sourceJobId)` index, 0
canonical-URL collisions, 1 content-hash cluster.

**Honest scale of the win.** One exact duplicate in 1,332 rows is a small
finding, and it is reported as one. The value is preventive: the slug-vs-id
split will keep producing duplicates for as long as the URL is the only
identity, and Freelancer source-id coverage goes from 13% to effectively
complete for new rows.

### Phase 2 — duplicate clustering (`1f84165`)

Nothing is deleted, hidden or merged. Clustering assigns a cluster, a
canonical member, a confidence and the reason codes behind the verdict.

**The finding.** Across 661,914 same-platform pairs: 39 share an exactly
normalised title, 5 more are 0.80–0.99 similar, 47 are 0.60–0.79 — but only
**1** matches on `contentHash`. The gap is Freelancer's own repost
convention, which changes the TITLE and leaves the description
byte-identical:

    "Independent B2B Sales Representative — U.S. Market"
    "Independent B2B Sales Representative — U.S. Market -- 2"
    "Edit Engaging Promotional Video - 29/09/2026 01:13 EDT"
    "Edit Engaging Promotional Video - 28/09/2026 14:13 EDT"

Folding the marker into `contentHash` would be wrong: a repost is a real
second posting, sometimes at a different budget, and Level 3 must keep
meaning "byte-identical". The marker is stripped for BLOCKING and scored as a
signal instead.

Scoring is additive with a reason code per contribution. Only an exact
content match reaches 1.0. **Title evidence alone can never reach the
duplicate threshold** — "Digital Marketing Project" and "Digital marketing"
score 0.67 on title and 0.00 on description and are two different jobs. An
exact title plus one independent agreement is reported as `possible_duplicate`
at capped confidence: a lead to check, not a finding.

Canonical selection tries rules in order and names the one that decided.
Earliest-*seen* is deliberately not first — different sources discover the
same posting at different times, so first-seen order is this database's
history, not the job's. No reason string may claim to know the original job;
a test enforces it.

Dry run, all 1,332 rows, 22ms: **20 clusters, 48 rows clustered** (22
duplicate, 6 possible, 20 canonical), 1,284 independent. Largest cluster is 5
postings of one Android game project. 3.6% of inventory, invisible to a
URL-keyed pipeline.

### Phase 2 — authenticity (`ad904fb`)

Deterministic, no model. Three measurements shaped it:

- **`paymentVerified` is false on all 1,332 rows.** It is mapped from
  `item.clientPaymentVerified`, and nothing stored has it true. Whether the
  actor omits it or every client really is unverified cannot be determined,
  because `rawPayload` keeps six curated keys and discards the source
  payload. Recorded as "the source did not publish it", never as "unverified".
- **Freelancer publishes no client signal at all** (0/1,134 for spend,
  rating, jobs-posted, country, skills, experience). Client evidence
  strengthens a verdict; its absence is a warning, never a penalty.
- **Nothing is ever returned as `verified`.** That status means the source
  URL was re-fetched and confirmed. This system does not do that, so claiming
  it would be a lie. A test asserts `verified` is unreachable.

The threshold needed a second pass: counting all signals rated 96.5% of the
table `supported`, because every well-formed row has a usable URL, a coherent
time, a substantive description and a stated budget. Those four are baseline
coherence. `supported` now needs two *corroborating* signals.

A speculative rule was removed rather than shipped — "thin text + no budget =
spam" could only fire on a shape nobody has observed, since zero live rows
have an unstated budget.

Dry run: **uncertain 953** (all Freelancer, no source id, no client data),
**supported 333**, **suspicious 46** (all offsite contact requests),
rejected 0, stale 0. Those 953 are the measurable payoff of the collector
fix — one corroborating signal today, two after the next scrape.

### Phase 2 — freshness and lead scoring (`fbe87c8`)

**Measured:** capture lag is 1.0h (Upwork) / 2.3h (Freelancer). Upwork
proposal counts roughly DOUBLE between the first hour and the first six. So
decay is steep early: half-life 48h with a 0.05 floor, giving 0.71 at one day
and 0.35 at three, which keeps the older half of the feed rankable rather than
flattened. States: just_posted / fresh / active / aging / stale / expired,
plus `unknown` — and `freshnessFactor` returns null rather than inventing an
age it does not have.

**The honesty bug.** Proposal counts do not grow with a row's age — flat at
18/21/25/19/22/22/22/21 across the 1h→5d+ buckets. With a 1–2h capture lag
that can only mean the count is captured shortly after posting and **never
refreshed**. A five-day-old listing still shows its two-hour figure. The
assistant currently says "only 3 proposals so far", which reads as live and
is not. `competitionObservation` returns the count with the age of the
observation and an `outdated` flag; tests assert "so far" is never produced
and that an absent count never renders as zero.

**Lead scoring**, two rules from the data:

- *Only evaluable dimensions count.* A fixed-weight model would dock 85% of
  inventory for a gap in the source's reporting. Each dimension scores only
  when its inputs exist, the total normalises over what ran, and `coverage`
  reports how much. Missing data is a risk, never a subtraction.
- *Budgets are not comparable as raw numbers.* 437 rows in ₹ (avg min
  ₹39,037), 334 in $ (avg min $795), 51 €, 24 £, and **all 198 Upwork rows
  carry no currency at all**. Raw ranking puts a ₹39,000 job ~49× above a
  $795 one. Budgets are banded in approximate USD with coarse dated rates,
  each band spanning 4–5×, so FX drift cannot reband a job. A missing
  currency is assumed USD only on Upwork, and that assumption is surfaced as
  a risk.

Below 40% coverage the score is null and the band is `insufficient_data`.

Dry run: **high 49, promising 198, moderate 584, low 498, insufficient 3**;
average coverage 0.76. Freshness: fresh 39, active 128, aging 384, stale 759,
expired 22. The worst-scoring listings are the `-- 3` / `-- 6` repost chains.

> Against the product's promise of fresh leads: **781 of 1,332 rows (59%) are
> stale or expired** by these thresholds. That is a scheduling and retention
> question, not a scoring one — see Phase 3.

### Phase 2 — assessment wiring (`6f49d77`)

`assessListing` is one function producing every quality column, called by
both ingestion paths so they cannot drift. Assessment happens at ingest so
the feed can rank in SQL rather than in memory; at ingest
`competitionObservedAt` is now, the one moment the proposal count is current.

`scripts/assess-listings.ts` recomputes stored rows as freshness decays, and
there passes `firstSeenAt` as the observation time — passing `now` would
claim a five-day-old figure is current.

The cost is the write, not the arithmetic. `assessmentChanged` suppresses
writes where only the score drifted a point or two, which every row does
every hour. `leadScoredAt` is excluded from the comparison: it changes every
run by definition, so counting it would mark every row dirty and defeat the
check.

### Phase 3 — cost and cron (`05701b3`, `c2be9df`)

**Cron audit, from 800 recorded runs over 53 days.** One correction to a
first reading: 480 of 800 runs added zero new jobs, but that is not waste —
479 of them are *refresher* runs, which add no new jobs by design. Separated:

| Run kind | Runs | Records fetched | New jobs |
|---|---|---|---|
| sync | 321 | 54,127 | 9,826 |
| refresher | 479 | 5,210 | 0 (by design) |

**The source split**, measurable only now that the quality columns are
populated — and this is the whole Phase 3 argument:

| Source | Rows | Useful leads (high+promising) | % useful | Avg lead score | Duplicates |
|---|---|---|---|---|---|
| Upwork | 198 | **131** | **66.2%** | 64.1 | 0 |
| Freelancer | 1,134 | 115 | 10.1% | 42.8 | 28 |

Upwork produces **more** useful leads than Freelancer from one sixth of the
volume. Upwork is also the only source that costs Apify budget — and the one
being starved. 211 of 800 runs reported `Apify (0)`, and the stored budget
state reads *"daily Apify query budget exhausted (skipped 4 query(s))"*.

The arithmetic: discovery issues 4 queries per run, the cap is 16 billed runs
a day, so the budget covers four sync runs — but the cron fires ~10 times a
day and the refresher draws from the same pool in between. Whoever asked
first won.

**Fixed so far:**

- *Discovery reserve* (`APIFY_DISCOVERY_RESERVE`, default 8 of 16). Refresh
  may only spend what is above the floor, so it degrades to zero before
  discovery loses a query. Set to 0 to restore the old shared pool.
- *Yield-ranked hours* (`bestDiscoveryHours`). Recorded yield runs from 3.4
  new jobs per run at 03:00 UTC to 20.8 at 06:00 — a factor of six at the
  same price. Pure and tested against the measured distribution; **not yet
  wired into the sync route.**
- *Write amplification.* A sync fetches ~150 Freelancer records and ~19% are
  new; the other ~130 were rewritten in full every run — about 1,300 row
  updates a day for no visible change. `contentHash` now makes the
  comparison exact, and unchanged listings get one batched `lastSeenAt`
  touch instead. A value the source STOPPED publishing does not count as a
  change, so an intermittent field cannot trigger a rewrite and then blank
  out good data.
- *Scheduler query.* `liveHourCounts` pulled every row in a 7-day window
  with its `rawPayload` blob and JSON-parsed each one, on every sync tick.
  Now a SQL GROUP BY over the indexed `postedAt`. Measured against
  production: **1,295 rows → 24, 267 KB → 448 B, 1,110ms → 232ms**, identical
  distribution. A PGlite test pins the UTC semantics.

**Then completed** (`4d88dad`, `76c4ce4`, `2c5010a`, `d4ae046`, `8049746`):

- *Source health and cost telemetry* (§21, §51). Rolling per-source records
  in SystemKv beside the existing `provider:<name>` entries, with
  exponential capped backoff. Yield comes from ONE grouped query so the
  admin surface does not get more expensive as the table grows. Billed Apify
  runs are counted at the call site, because every query attempt is billed
  including a failover retry on another account.
- *Yield-based discovery scheduling* (§16). `shouldRunApifyDiscovery` funds
  the top-yield hours first and releases surplus so the allowance is still
  fully spent. Fails OPEN — a telemetry problem must never stop ingestion —
  and a deliberate schedule skip is not recorded as a source failure, which
  would otherwise grow the backoff streak and retire a healthy source.
- *Operations surface* at `/admin/health` (§35). Source yield, health and
  backoff, Apify budget and reserve, data health, cron health.
- *Post-sync maintenance* (§42). Clustering and assessment refresh now run
  after a sync from `lib/qualityMaintenance.ts`, and the two scripts became
  thin reporters around the same functions, so there is one implementation
  of each pass. Rate-limited to once per `QUALITY_MAINTENANCE_INTERVAL_MIN`
  (default 180) because clustering reads every row; the writes are already
  suppressed, so the READ is the cost worth bounding.
- *`npm run sync` was broken.* `src/lib/db.ts` imports `server-only`, which
  throws outside the react-server condition, so the manual CLI sync failed
  at module load. The deployed path was never affected. Fixed.

**Distinctions the telemetry is careful about**, each one a way to lie with a
number: "never observed" is not "observed to be zero" (an unmeasured source
is UNRANKED, not ranked last); a free source reports `n/a (free)` for cost
per lead rather than `0`, which would read as infinitely efficient; a run
that did not time itself is not folded into the duration mean as a zero; and
a corrupt `nextEligibleAt` fails open so bad telemetry cannot retire a
working source.

**Still open in Phase 3:** hot/warm/cold retention separation (§19) — the
current policy hard-deletes at 7 days rather than archiving. Also unresolved:
the sync cadence (~10 runs/day) is four times what the Apify budget can
serve, so most runs are Freelancer-only. Yield-based scheduling now makes
that waste harmless rather than random, but the cadence itself is still
worth a decision.

### Phase 4 — UI (`d8488a2`)

Built on three parallel tracks over disjoint files, then verified here
rather than accepted on report.

- **Dashboard + jobs API.** Latest and Recommended are separate orders,
  sorted in SQL, with no blended third option and no client-side re-sorting.
  `limit=999999` is rejected with 400, not clamped — silently returning 100
  misreports what was returned. Every score carries a "Why? (n)" disclosure
  with reasons, risks and translated authenticity codes. Filters offer only
  what the data supports: `paymentVerified` and `clientName` appear nowhere,
  and `verified` is never offered because no row can reach it.
- **Job detail.** "Published by {platform}" against "Lead Hunter's
  assessment", so an inferred value is never shown as a source fact. Absent
  values read "Not published by this source". The imperative `window.open`
  sink was replaced with a validated anchor. The legacy `score` is demoted to
  a footnote — it has no recorded reasoning, so showing it as a verdict was
  the bug.
- **About + Intelligence.** Every About figure traces to this file. A trend
  now requires a named metric, both period bounds, a threshold, per-period n
  and a significance test (72h vs previous 72h, with a 3h capture-lag guard).
  Its most valuable output is a refusal: useful-lead rate moved 13.2% → 24.9%
  at p<0.001 and is deliberately NOT reported as a trend, because freshness
  is a lead-score input and the current period is by construction 72h
  younger. It renders as "measured, not attributable".

**Verified in a browser at 375px:** no horizontal overflow on the feed or
the detail page, zero overflowing elements, and the rendered text contains
no "so far" phrasing anywhere — competition reads "4 proposals when this
listing was checked 16 hours ago — not a current figure" with a snapshot
flag.

### Bugs found during integration, all verified against production

| Bug | Evidence | State |
|---|---|---|
| `market_facts` destroys its own history | 09-23..09-29 match live rows exactly; 09-22 reads 37, 09-21 reads **1**, 09-20 reads 15, against real intake of ~190/day | Writer fixed (a day closes at 6 days, inside retention). **Existing corrupt rows are unrecoverable** — the source rows are deleted |
| `budgetType` empty on every row | 1,332 empty while the budget JSON had the type on all of them (435 hourly / 897 fixed) | Both write paths fixed + data-only migration; 1,332 → 0 empty |
| `/opportunities/[id]` unreachable for every row | `IdSchema = z.string().uuid()` vs source-derived keys like `fl-…-40740654` | Fixed |
| "Hired so far" | `hiresCount` is also captured once and never refreshed — same bug, different field | Fixed |

### What is NOT done, and what is NOT verified

**Not built:** the UI does not read any of the Phase 2 columns. The feed still
sorts by `createdAt`, there is no separate Latest vs Recommended (§23), the
job detail page does not distinguish source fact from derived value (§26,
§56), Trending is untouched (§28), and the clustering pass is not wired into
the sync cron.

**Applied and verified** — see "Rollout" above. Every number in this section
was first produced by a read-only dry run and then reproduced exactly by the
live pass.

One real defect surfaced only against the live database: batching 50 updates
into a `$transaction` exceeded Prisma's 5-second interactive-transaction
timeout on Neon's pooled endpoint and rolled the batch back. The writes are
independent and idempotent, so the transaction bought no correctness;
`scripts/_applyWrites.ts` now applies them with bounded concurrency instead.
The failed attempt rolled back cleanly and wrote nothing — confirmed by
re-running the dry report before retrying.

Also fixed: the three scripts needed `--conditions=react-server`, because
`src/lib/db.ts` imports `server-only`. Note that `npm run sync` still lacks
the flag and will throw the same error — untested here because running it
would spend Apify quota.

### Apify — rebuilt around the actor's own cost controls

**Pricing, verified on the actor page rather than assumed:**
blackfalcondata/upwork-scraper is pay-per-event at **$0.001 per run start +
$0.001 per emitted result**, against $5/month of free credit. The figure
previously written in a code comment turned out to be correct.

**What was wrong was how the budget was spent.** Two actor features were
unused:

- *Batch searches.* Passing an ARRAY of queries runs them together for ONE
  Actor-Start instead of N. The integration issued its four search terms as
  four separate billed runs.
- *Incremental mode.* With a stable `stateKey` the actor emits only listings
  that are new or whose tracked content changed. Without it we bought the
  same listings on every pass.

**Measured waste:** ~50 records returned per day against ~28 genuinely new
Upwork rows — roughly 44% of result spend bought listings already stored.
And because four billed runs per pass exhausted a 16/day cap, only **2
discovery passes a day actually ran**, so Upwork data could be twelve hours
stale.

**After:** one batched, incremental run per pass.

| | Before | After |
|---|---|---|
| Billed runs per pass | 4 | **1** |
| Results billed per pass | 32 | only new/changed (~3) |
| Cost per pass | ~$0.036 | ~$0.004 |
| Discovery passes affordable | 2/day | every sync (~10/day) |
| Monthly cost | ~$4.30 (86% of $5) | **~$1.30 (26%)** |

So the data gets roughly **5× fresher while costing about 70% less** — not a
trade-off, because the old spend was mostly buying duplicates.

A side effect worth verifying once it has run: incremental mode emits
records whose tracked content *changed*, so a listing whose proposal count
moves should now come back on its own. If that holds it partly repairs the
never-refreshed competition figure. It is **not yet confirmed** — the actor
does not document precisely which fields it tracks — so nothing in the UI
claims it.

Caveats recorded in the code: incremental state is held per Apify account,
so the token order prefers the primary and fails over only on error (a
switch costs one re-baseline, never a missed listing); and an empty pass is
now the *normal* outcome, so it must never be treated as a source failure —
there is a test for that.

### Neon — rebuilt around scale-to-zero

**Limits, read off Neon's plans page rather than assumed:** Free gives
**100 CU-hours per project per month**, 0.5 GB storage, 5 GB egress, and
scales the compute to zero after **5 minutes of inactivity — which cannot be
disabled**.

Storage is not the constraint: the database is **20 MB of 512 MB** (4%), and
7-day retention bounds it. Compute is the whole game, and because every wake
holds the compute for at least the 5-minute suspend timeout, the cost driver
is **how often something touches the database**, not how much work it does.

Three things were waking it needlessly:

| Cause | Before | After |
|---|---|---|
| Presence heartbeat | every **5 min** — exactly the suspend timeout, so one open tab kept the database awake indefinitely | 20 min, and skipped entirely unless the person actually interacted since the last beat |
| Cron triggers | `*/30` = 48/day against a route whose own cooldown is 45 min / 4 h, so most wakes only read the cooldown and skipped | hourly 05–19 UTC, four-hourly overnight = **18/day**, aligned so nearly every trigger does real work |
| Refresh after sync | `sleep 300` — precisely the suspend timeout, so refresh paid a second cold start every cycle (measured: 5.5 min after sync on average) | `sleep 20`, inside the warm window, reusing the compute the sync already paid for |
| Admin sessions page | polled every 30 s, pinning the database awake for as long as the tab was open | 2 min, and paused while hidden |

Roughly **96 wakes a day down to ~18**. At the 5-minute minimum that is about
8 hours a day of forced runtime reduced to about 1.5 — the difference between
comfortably inside 100 CU-hours and far outside it, depending on the
project's compute size.

The heartbeat was the worst of them and the least obvious: the interval had
been *deliberately* set to 5 minutes with a comment acknowledging it "controls
how often an open tab wakes the scale-to-zero database" — which is exactly the
value that guarantees it never sleeps.

Also already landed earlier in Phase 3 and contributing here: write
suppression for unchanged listings (~1,300 pointless row updates a day), the
scheduler histogram moved into SQL (1,295 rows → 24, 267 KB → 448 B per
tick), and the `market_facts` replace-upsert churn.

**Not measurable from SQL:** actual CU-hours consumed, and the project's
compute size. Both are visible only in the Neon console, and the compute size
matters — the same wake pattern costs 4× more at 1 CU than at 0.25 CU. Worth
checking there after a few days.

### Open issues — none of these are fixed

Carried out of the Phase 4 integration. Each was verified, none is
speculative.

1. **`market_facts` history before ~2026-09-23 is wrong and cannot be
   recovered** — the listings it was derived from are deleted. The writer no
   longer corrupts new days, but `/trading` still reads the old rows and
   will show badly undercounted daily volumes. Deleting those rows would be
   more honest than displaying them; that is a call for the repo owner, not
   something to do unasked.
2. **`usdBudgetMidpoint` and `parseBudget` disagree on a missing currency.**
   `marketIntelligence.ts` assumes USD on any platform; `leadScore.ts`
   assumes it only on Upwork, which is the rule that avoids the 49× rupee
   error. So `/trading` budget charts dollar-denominate currency-less
   Freelancer rows.
3. **`/trading` still presents LLM-written market commentary as analysis**
   (`marketSummary`, `aiInsights`, `recommendedSkillsToLearn`) — the same
   class of problem removed from `/intelligence`.
4. **`/opportunities/[id]` duplicates `/job/[id]`.** Nothing links to it.
   Both were brought to the same vocabulary rather than allowed to diverge
   further, but one should go.
5. **`/api/intelligence` is now dead code** — `/intelligence` was its only
   consumer.
6. **`/about` has no nav entry point.**
7. **The budget formatter exists in three places** and the status vocabulary
   in two. Worth one shared module.
8. **`interviewingCount` / `hiresCount` default to 0**, so a published zero
   and an unpublished field are indistinguishable. The UI says "Not
   published" for 0, which is a guess in the other direction; the real fix
   is a nullable column.
9. **Retention archiving (§19) is not built** — the policy still hard-deletes
   at 7 days instead of moving rows to an archive.
10. **The sync cadence is ~4× what the Apify budget can serve.** Yield-based
    scheduling makes the surplus harmless rather than random, but the cadence
    itself still deserves a decision.

### Known-accepted dependency advisories

5 `high` advisories remain, all inside the **Prisma CLI's own** chain
(`@prisma/config` → `deepmerge-ts`, and `mysql2`, which this project never
loads because it uses Postgres). npm's only remedy is downgrading
`prisma` 7 → 6, a worse trade. The CI audit gate is therefore set at
`critical` (which would have caught the Next.js RCE) with a non-blocking
full report. Revisit when Prisma ships a patched CLI.

---

## 9. Operational commands

```bash
npx tsc --noEmit      # typecheck
npm run lint          # eslint
npm test              # unit tests (src/**/*.test.ts)
npm run test:pg       # PGlite suites: raw SQL lock/quota, migration rehearsal
npm run test:all      # unit + pg + grounding + ranking
npm run verify        # typecheck + lint + test:all + build
npm run build         # prisma generate && next build
npm run sync          # manual ingestion run (needs .env)
npm run check-quota   # Apify quota probe

npm run backfill:identity            # dry run: report what would change
npm run backfill:identity -- --apply # write it (idempotent, NULL-only)
npm run cluster:duplicates           # dry run: duplicate clusters
npm run cluster:duplicates -- --apply
npm run assess                       # dry run: authenticity + lead scores
npm run assess -- --apply
npm run source:health                # source yield, cost and backoff report
```

All three write scripts are dry by default and print a full report before
they would change anything.

**Required env** (see `.env.example`): `DATABASE_URL`, `CRON_SECRET`,
`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `APIFY_TOKEN[2,3]`, and at least one of
`GEMINI_API_KEY` / `OPENAI_API_KEY` / `GROK_API_KEY` / `DEEPSEEK_API_KEY`.
