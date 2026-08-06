# Freelance Copilot AI - Brain Document

## Project Overview
Freelance Copilot AI is a Next.js application that aggregates freelance job opportunities from multiple platforms (Upwork, Freelancer, WeWorkRemotely, etc.), stores them in a local SQLite/PostgreSQL database via Prisma, and uses Google Gemini AI to analyze jobs and generate tailored proposals.

## Tech Stack
- **Framework**: Next.js (App Router)
- **Database**: Prisma (currently set up for PostgreSQL in `schema.prisma`)
- **UI**: Tailwind CSS, lucide-react icons, shadcn/ui components (like Button, Card, Badge)
- **AI**: `@google/generative-ai` (Gemini 2.5 Flash)

## Key Directories & Files
- `prisma/schema.prisma`: Defines the data models (`Opportunity`, `Analysis`, `ProjectTracking`).
- `src/collectors/`: Scripts that scrape/fetch jobs from various platforms (`UpworkCollector.ts`, `FreelancerCollector.ts`, etc.).
- `src/services/ai/gemini.ts`: Handles the prompt and integration with Gemini AI.
- `src/app/`: Next.js frontend pages and components (`Dashboard.tsx`, `page.tsx`, `job/[id]/page.tsx` or `opportunities/[id]/page.tsx`).
- `src/app/actions/opportunity-actions.ts`: Server actions for fetching data, triggering syncs, and running AI analysis.
- `scripts/`: Cron and background scripts (`sync.ts`, `check-quota.ts`).

## Features to Implement
1. **Country & Connections Data**: Add `country` and `connections` fields to `Opportunity`. Fetch these dynamically from platforms.
2. **AI Proposal Enhancement**: Generate one single, highly professional, humanized template without buzzwords. Include the client's name if possible. Remove options to regenerate short/standard/detailed proposals.
3. **Enhanced Job Details**: Show all details (reviews, client spend, country, connections) on the job detail page and dashboard.
4. **Authenticity & Status Filtering**: Only show open/winnable jobs. Close jobs immediately if they are in interview or closed state.
5. **Time Filter**: Do not show jobs older than 7 days.
6. **Deduplication**: Enhance duplicate detection so only the original job is fetched.
7. **Cron Optimization**: Ensure the hourly cron works correctly for Upwork and Freelancer without exhausting API quotas or getting stuck in loops.

## Development Notes
- Upwork Collector uses SerpApi (`google_jobs` engine) and public Upwork search as a fallback. Token limits apply.
- Freelancer Collector uses the public active projects API.
- Re-run `npx prisma db push` or `npx prisma migrate dev` after schema changes.
