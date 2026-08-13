# Lead Hunter (Freelance Copilot AI) - Brain Document

## Project Overview
Lead Hunter is a production Next.js application that aggregates freelance job opportunities from Upwork and Freelancer, stores them in PostgreSQL / SQLite via Prisma, enriches them with real marketplace signals (competition, client spend, repeat-client activity, connects cost, proposal counts), and uses AI (Gemini 2.5 Flash / MultiAI) to generate per-job assessments, tailored proposals, and market intelligence.

## Tech Stack
- **Framework**: Next.js 16 (App Router, React 19)
- **Database**: Prisma Client (`postgresql` in production, `sqlite` dev adapter fallback)
- **UI & Styling**: Vanilla CSS design system tokens + custom UI components (`lucide-react`)
- **AI Engine**: `@google/generative-ai` (Gemini 2.5 Flash) with `MultiAI` fallback (OpenAI, Grok, DeepSeek, deterministic ground-truth fallback)
- **Data Providers**: Apify Upwork Scraper (`ApifyUpworkProvider`), Freelancer API (`FreelancerProvider`)

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
3. **Platform Scope Separation**:
   - Supported platforms: `Upwork` (default) and `Freelancer`. No generic/unfiltered platform scopes. Switching platform clears all scope-dependent filters (Country, Connections, Budget).
4. **Per-Job AI Assessment & Proposal**:
   - `POST /api/analyze` evaluates the selected job's specific title, description, skills, budget, client signals, and competition. Cached per `opportunityId` in `SystemKv`.
5. **Market Intelligence**:
   - Derived 100% from real database listings and `MarketFact` daily aggregates.

## Key Files & Directories
- `prisma/schema.prisma`: Data models (`Opportunity`, `Analysis`, `ProjectTracking`, `UserSession`, `CronLog`, `SystemKv`, `MarketFact`).
- `src/providers/`: Data ingestion pipeline (`JobPipeline.ts`, `ActiveJobRefresher.ts`, `ApifyUpworkProvider.ts`, `FreelancerProvider.ts`).
- `src/lib/jobFeed.ts`: Enriched job feed builder used by jobs API and AI Agent.
- `src/lib/marketIntelligence.ts` & `marketFacts.ts`: Real marketplace trends, distribution, and historical tracking.
- `src/services/ai/`: AI reasoning layer (`MultiAI.ts`, `gemini.ts`, `agentChat.ts`, `analyzer.ts`).
- `src/app/`: App Router pages (`page.tsx` Dashboard, `job/[id]/page.tsx` Job Detail, `trends/page.tsx` Market Trends, `cron-logs/page.tsx`).
- `src/app/api/`: REST endpoints (`jobs`, `sync`, `sync/refresh`, `sync/status`, `analyze`, `agent`, `trends`, `search`).

## Operational Commands
- **Type Check**: `npx tsc --noEmit`
- **Lint**: `npm run lint`
- **Build**: `npm run build`
- **Sync**: `npm run sync`

## Status & Audit Verification
- Audit complete: All 12 production audit areas verified.
- Code matches `brain.md`, GitHub `main`, and Vercel production deployment.
