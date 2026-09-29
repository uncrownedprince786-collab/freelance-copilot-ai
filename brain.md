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
| Baseline verification | typecheck ✅ · lint ✅ · build ✅ at `dd5a0cf` |
| Phase 1 — critical security + cost + test gate | **complete** — `27eb93a` |
| Phase 2 — schema, dedup, authenticity, lead scoring, freshness | **blocked**: needs a migration decision (section 6.3) and a database to verify against |
| Phase 3 — Neon/Apify cost reduction (remainder) | not started |
| Phase 4 — UX revamp, chatbot deterministic-first | not started |

**Working branch:** `audit/production-hardening` off `dd5a0cf`. Not pushed, not
deployed.

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
npm run build         # prisma generate && next build
npm run sync          # manual ingestion run (needs .env)
npm run check-quota   # Apify quota probe
```

**Required env** (see `.env.example`): `DATABASE_URL`, `CRON_SECRET`,
`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `APIFY_TOKEN[2,3]`, and at least one of
`GEMINI_API_KEY` / `OPENAI_API_KEY` / `GROK_API_KEY` / `DEEPSEEK_API_KEY`.
