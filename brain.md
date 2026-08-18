# Lead Hunter (Freelance Copilot AI) - Brain Document

## Project Overview
Lead Hunter is a production Next.js application that aggregates freelance job opportunities from Upwork and Freelancer, stores them in PostgreSQL / SQLite via Prisma, enriches them with real marketplace signals (competition, client spend, repeat-client activity, connects cost, proposal counts), and uses AI (Gemini 2.5 Flash / MultiAI) to generate per-job assessments, tailored proposals, and market intelligence.

## Tech Stack
- **Framework**: Next.js 16 (App Router, React 19)
- **Database**: Prisma Client (`postgresql` in production, `sqlite` dev adapter fallback)
- **UI & Styling**: Vanilla CSS design system tokens + custom UI components (`lucide-react`)
- **AI Engine**: `@google/generative-ai` (Gemini 2.5 Flash) with `MultiAI` fallback (OpenAI, Grok, DeepSeek, deterministic ground-truth fallback)
- **Data Providers**: Apify Upwork Scraper (`ApifyUpworkProvider`, multi-account failover with ordered pool + exhausted-account skip), Freelancer API (`FreelancerProvider`)

## Architecture & Data Flow

```
[ Providers (Apify Upwork / Freelancer API) ]
                   │
                   ▼
  ┌─────────────────────────────────┐
  │         Sync & Refresh          │
  │  - /api/sync (New Job Pipeline) │
  │  - /api/sync/refresh (Active)   │
  └────────────────┬────────────────┘
                   │
                   ▼
  ┌─────────────────────────────────┐
  │       Prisma DB Storage         │
  │ (Opportunity, MarketFact, etc.) │
  └────────────────┬────────────────┘
                   │
                   ▼
  ┌─────────────────────────────────┐
  │  Job Feed & Market Intelligence │
  │ (/api/jobs, /api/trends, Feed)  │
  └────────────────┬────────────────┘
                   │
    ┌──────────────┴──────────────┐
    ▼                             ▼
 [ UI Dashboard & Job Detail ]  [ Copilot Agent Panel ]
 (Per-job Assessment & Props)   (Natural Language Q&A)
```

### Key Data Pipeline Guarantees
1. **Sync & Refresh Separation**:
   - `JobPipeline`: Ingests new jobs, applies 7-day filter, hard spam/hires filters, score calculations, deduplication, and `MarketFact` aggregate recording.
   - `ActiveJobRefresher`: Bounded batch cursor refresh (`REFRESH_BATCH = 30`) that updates mutable competition signals (`proposalCount`, `interviewingCount`, `hiresCount`) on existing active jobs without creating duplicates or overwriting valid data with null.
2. **Proposal Count Accuracy**:
   - Upwork competition bands ("50+", "0 to 5", "5 to 10") are parsed accurately: `"50+"` normalizes to `50` (floor), preserving high-competition signals without coercing to `0`. `0` represents zero competition.
   - Saturation filter (`JobPipeline.applyHardFilters` Rule 4) now treats `proposalCount >= 50` as high/saturated competition and rejects it from new ingestion (previously `> 50` was unreachable because normalization already caps at 50).
   - Visibility: `ActiveJobRefresher` refresh runs are now recorded in `cronLog` (consumed by the `/cron-logs` page), so 15-minute competition-refresh ticks are observable instead of invisible.

3. **Platform Scope Separation**:
   - Supported platforms: `Upwork` (default) and `Freelancer`. No generic/unfiltered platform scopes. Switching platform clears all scope-dependent filters (Country, Connections, Budget).
4. **Per-Job AI Assessment & Proposal**:
   - `POST /api/analyze` evaluates the selected job's specific title, description, skills, budget, client signals, and competition. Cached per `opportunityId` in `SystemKv`.
5. **Proposal Grounding (P0 hotfix)**:
   - Every generated proposal is grounded in the CURRENT selected job only — title, description, and required skills. `src/lib/proposalGrounding.ts` is the single source of truth for extraction, validation, and the deterministic grounded generator (`generateGroundedProposal`).
   - Verification instructions are honored exactly: if a listing requires a proposal to open with a word (e.g. "Start your proposal with SMILE"), `extractVerificationWord` detects it and `ensureStartsWithWord` forces the surfaced proposal to begin with that literal word (all AI providers + the fallback). The job detail UI never prepends a greeting over it (`verificationWord` is returned by the API).
   - No candidate context is ever invented: the AI prompts forbid experience/projects/portfolio/tool/result/qualification claims (no profile exists), and `validateProposal` rejects claims, generic-template contamination, missing verification words, and foreign-topic leads (context leakage from another job).
   - `POST /api/analyze` validates before returning and regenerates once with corrective guidance if validation fails. Cached analyses (`SystemKv` / in-memory) are only reused when they pass the same validation AND match the current job's fingerprint (`jobFingerprint`) — stale or cross-job entries are treated as misses.
   - The legacy `gemini.ts` flow (`/opportunities/[id]` server action) funnels through the same shared generator + validation; its canned fallback template was replaced.
   - Client instructions are extracted as a structured set (`extractJobInstructions` in `proposalGrounding.ts`): required opening word, required ending word, keywords, applicant-directed questions, the stated experience bar, requested actions, and format/application instructions. A single sentence can yield several (e.g. "start with X and end it with Y"); negative language and non-applicant phrasing are ignored; multi-word endings like "THANK YOU" are enforced literally. The full description (up to 60k chars) is read so instructions at the end of a long posting are not truncated away. Every AI provider and the fallback generator receive these as prompt lines and the surfaced proposal is mechanically enforced via `ensureStartsWithWord` / `ensureEndsWithWord` / `ensureIncludesKeywords`; `validateProposal` rejects outputs that miss any of them. Verified by `scripts/test-instructions.ts` (77 checks, all green) plus `tsc --noEmit`, `eslint`, and a production build.
6. **Market Intelligence**:
   - Derived 100% from real database listings and `MarketFact` daily aggregates.
   - Trends (`/trends`, `/api/trends`) includes a 30-day window history, per-day average budget (USD), remote vs on-site share, and 5-series skill volume — all sourced from `market_facts` dimensions recorded per sync. The response is cached in `SystemKv` under a versioned `trends_cache` (`CACHE_VERSION = 2`); a version mismatch is treated as a miss so stale pre-Task-4 caches silently rebuild, and the trends page guards `(history.skillSeries?.length ?? 0) > 0` before rendering window data.

## Key Files & Directories
- `prisma/schema.prisma`: Data models (`Opportunity`, `Analysis`, `ProjectTracking`, `UserSession`, `CronLog`, `SystemKv`, `MarketFact`). Composite indexes: `[platform,score]`, `[platform,createdAt]`, `[applied,createdAt]`.
- `src/providers/`: Data ingestion pipeline (`JobPipeline.ts` — trimmed rawPayload, provider health tracking, Crawl4AI/SerpApi removed, `ActiveJobRefresher.ts`, `ApifyUpworkProvider.ts` — multi-account failover, `FreelancerProvider.ts`).
- `src/lib/jobFeed.ts`: Enriched job feed builder used by jobs API and AI Agent.
- `src/lib/marketIntelligence.ts` & `marketFacts.ts`: Real marketplace trends, distribution, and historical tracking.
- `src/services/ai/`: AI reasoning layer (`MultiAI.ts`, `gemini.ts`, `agentChat.ts`, `analyzer.ts`).
- `src/lib/proposalGrounding.ts`: Proposal grounding guards + shared deterministic `generateGroundedProposal` (verification words, claim/template/foreign-topic checks, job fingerprint).
- `src/app/`: App Router pages (`page.tsx` Dashboard, `job/[id]/page.tsx` Job Detail, `intelligence/page.tsx` Market Intelligence, `trading/page.tsx` Market Trends, `cron-logs/page.tsx`).
- `src/app/api/`: REST endpoints (`jobs` — server-side filtering, cursor pagination, lightweight select, `sync`, `sync/refresh`, `sync/status`, `analyze`, `agent`, `intelligence`, `trends`, `search`, `jobs/applied`, `jobs/view`).
- `src/components/SiteNav.tsx`: Shared navigation bar (Leads / Intelligence / AI Apply tabs + ThemeToggle).
- `src/components/ThemeToggle.tsx`: Icon-only (sun/moon) dark/light theme toggle with system-preference sync.
- `.github/workflows/cron-sync.yml`: Single 30-minute coordinator (consolidated from separate cron-sync + cron-refresh workflows).

## Operational Commands
- **Type Check**: `npx tsc --noEmit`
- **Lint**: `npm run lint`
- **Build**: `npm run build`
- **Sync**: `npm run sync`

## Status & Audit Verification
- Audit complete: All 12 production audit areas verified.
- Final one-pass production completion executed (`13f3b68` → `a8ce776`, deployed to Vercel production on `main`):
  - Task 5 — simple keyword search on the dashboard (`src/app/page.tsx`): whitespace-token AND matching over title/description/skills/category/client/country, wired into `passes()` gated on `except !== 'search'`, persisted in the filters snapshot, with a deduplicated search box + Clear in filters Row 0 and search-aware empty/Showing lines. `changePlatform` deliberately does NOT reset the search term. Verified in production: "api" on Upwork = 64 (matches the `/api/jobs` ground truth exactly), "python" = 24.
  - Task 6 — agent production hardening (`src/app/api/agent/route.ts`): a "which is the best job?"-style request with an empty working set now runs a real search and returns structured job cards the UI renders (`jobs: cards`, tool `compare`, ranked via `reasonOverJobs` / `fallbackReply`), never a sentence-only reply. Browser-verified for best/no-context, best-with-skill, normal search, and malformed-input cases — all return real cards with zero console/page/request errors.
  - Security audit: no committed secrets (`.env` gitignored; only the empty `.env.example` template is tracked; docker-compose `PASSWORD: postgres` is the local-dev default; scratch sqlite `DATABASE_URL` points to a temp dir). Added HSTS-complementing headers via `next.config.js` for all routes: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geolocation/payment/usb denied). A strict CSP is intentionally omitted because the UI relies on inline style attributes. Verified live on `/`, `/api/jobs`, `/api/trends`, `/api/agent`, `/api/sync/status`.
  - UI/responsive/theme audit: 24/24 combos pass (4 pages × 3 viewports × 2 themes) with zero console/page/failed requests; fixed a 10px mobile overflow caused by the one-line pagination bar (`flexWrap: 'wrap'` on `.pagination`).
  - Critical-flow audit: dashboard render, real job-detail load (id resolved from `/api/jobs`), guest-session `/api/analyze` proposal generation (200, 1060-char grounded draft), platform/scope switch, search clear, sort, pagination, filter pills, agent panel send, and 30-day trends render — all pass with no errors.
  - Data consistency: a real sync ran at `2026-08-14T15:41:24Z` on HEAD `a8ce776` (GitHub Actions cron-sync run `31815720708`, success), so `market_facts` now records the Task-4 remote/budget-usd dimensions; `/api/trends` serves `cached: false` with 30-day history, `skillSeries`×5 and `remoteShare.remotePct: 58`.
- P0 hotfix deployed: AI proposals grounded in the current job only (`eaaa3b8`, pushed to GitHub `main`, deployed to Vercel production).
- Proposal sync fix (`0040318`, pushed to GitHub `main`, deployed to Vercel production): `ActiveJobRefresher` now logs each run to `cronLog` (visible in `/cron-logs`), and `JobPipeline` Rule 4 rejects saturated `>= 50` proposal counts from new ingestion.
- Job feed ranking (`0f1a9db`, pushed to GitHub `main`, deployed to Vercel production): `compareOpportunities` (`src/lib/opportunityRanking.ts`) now ranks by a freshness-weighted combined score (`freshness + proposalCount + assessment score`) instead of hard freshness tiers, so a 1–5 minute age gap affects order while a 2-hour gap always dominates proposal/score. Recomputed on every read from current DB fields (tests in `scripts/test-ranking.ts`).
- Dark Mode text visibility fix (`c2fd131`): Added 5 `html[data-theme='dark']` CSS rules in `src/app/globals.css` using existing `lh-*` color palette (`#c7d0dc`, `#f1f5f9`, `#8b99ad`) to override inline text colors (`#111827`, `#374151`) that were invisible on dark background `#0b1220`. Targets `.lh-page`, headings `h1-h4`, `.lh-body`, `.lh-muted`, `.lh-h` with `!important` to override inline styles.
- Market Trending page (`f3c3281`): Repurposed `/trading` as Market Trending page with real API data from `/api/trends`. Removed old `/trends` page (only one Market Trending route). Navigation updated: Dashboard → Market Trending → `/trading`. Clean card-based UI with Market Overview, Platform Mix, Remote Share, Active Skills, Fast Growing Skills, Competition Insights, Budget Trend, 7d/30d sparklines.
- Production hardening pass (`553342f`): Server-side `/api/jobs` rewrite (WHERE/ORDER BY/cursor pagination/lightweight select), scoring fix (unreachable `proposalCount > 20` → 4-tier), composite DB indexes (`[platform,score]`, `[platform,createdAt]`, `[applied,createdAt]`), default sort changed to score-first, opportunity reason snippets, trimmed rawPayload, scheduler consolidation (single 30-min cron), provider health tracking to SystemKv, shared SiteNav component, dark mode CSS extensions (~100+ lines), Crawl4AI + SerpApi fully removed (providers, compose files, packages).
- Market Intelligence fixes:
  - §14 — "Insufficient data" labels → "Too early to tell" (intelligence + trading pages + API strings)
  - §16 — Rounding fixes: `fmt()` and `avg()` in intelligence/trading pages now use `Math.round()` for jobs/day and proposals instead of 1-decimal rounding
  - §9 — Comprehensive dark mode CSS overrides: 100+ new attribute-selector rules covering all hardcoded inline `color`, `background`, and `border` patterns in intelligence/trading pages
  - §10 — ThemeToggle changed to icon-only transparent control (no border, no background, `.lh-theme-toggle` class with subtle hover + focus-visible)
- Production hotfix (`aeb28ec`, `f4e4503`):
  - **ROOT CAUSE**: `/api/jobs` returns `{jobs, nextCursor, hasMore}` but `page.tsx` and `job/[id]/page.tsx` expected a flat `Job[]` array. `data.map()` threw TypeError silently caught → `setJobs` never called → empty dashboard.
  - Fixed `page.tsx`, `job/[id]/page.tsx` (2 fetch paths) to destructure `{jobs}` from API response
  - ThemeToggle: removed `lh-field` class + bordered box, replaced with transparent `.lh-theme-toggle` (no border, no bg, icon-only, subtle hover, focus-visible outline)
  - Removed unused `ThemeToggle`/`Logo` imports from intelligence, trading, cron-logs, admin/sessions pages
- Code matches `brain.md`, GitHub `main`, and Vercel production deployment.

## Recent Changes (August 2026)
- **7-day retention + safety cap** (`5118487`): All jobs (applied + non-applied) deleted after 7 days. Safety cap at 5,000 jobs — if exceeded after 7-day cleanup, oldest rows deleted first until under 4,500. Runs in both JobPipeline (every sync) and /api/sync (cron path). Always removes oldest, never fresh.
- **Job detail dark mode fix** (`897c1be`): React renders `#111827` as `rgb(17, 24, 39)` in the DOM, so existing attribute selectors didn't match. Added 6 CSS override rules targeting the rgb() format for all common text colors used in the job detail stylesheet. All headings, labels, values, and body text now display correctly in dark mode.
- **Intelligence "Too early" message** (`897c1be`): Changed reason text from "Not enough older data to compare — the listing window is only a few days old." to "Collecting data — direction will appear once we have a few more days of history."
- **Clickable stat cards** (`9ef1c66`): Dashboard stat cards (Listings/New/Hot/Applied) are now clickable filters. Click to filter, click again to deselect. Active card gets blue border highlight. Uses `quickFilter` state applied in `filteredJobs` computation.
- **About page duplicate logo removed** (`9ef1c66`): Removed body `<Logo size={64} />` from about page hero section (header logo preserved).
- **Dark mode footer + about agent section** (`0b4fe30`): Added comprehensive rgb() format CSS overrides for `.lh-page` covering all pages. Targets 8 common text colors that React renders as rgb() instead of hex. Fixes dashboard footer (Abdul Raheem name + copyright) and about page agent section (bubble text + body text) not visible in dark mode.
- **Agent job links + compare cards + default light mode** (`9d6c400`):
  - Job detail page now fetches by ID (`?id=xxx`) instead of paginated all-jobs, so agent card clicks always resolve (no more "Job not found").
  - Agent compare intent now returns clickable job cards (was text-only before).
  - Default theme changed to light mode (was following OS dark preference).
  - Agent system prompt rewritten: conversational ChatGPT-like tone, can answer freelance-related questions using platform data, compare responses are decisive with signal-based reasoning.
