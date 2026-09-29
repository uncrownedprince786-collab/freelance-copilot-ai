-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "budget" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER NOT NULL DEFAULT 0,
    "risk" TEXT NOT NULL DEFAULT 'Medium',
    "viewed" BOOLEAN NOT NULL DEFAULT false,
    "viewedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "country" TEXT,
    "clientName" TEXT,
    "clientSpend" TEXT,
    "clientReviews" TEXT,
    "connections" INTEGER,
    "budgetType" TEXT,
    "experienceLevel" TEXT,
    "duration" TEXT,
    "skills" TEXT,
    "proposalCount" INTEGER,
    "interviewingCount" INTEGER DEFAULT 0,
    "hiresCount" INTEGER DEFAULT 0,
    "paymentVerified" BOOLEAN NOT NULL DEFAULT false,
    "clientRating" TEXT,
    "jobsPosted" INTEGER,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" TIMESTAMP(3),
    "rawPayload" TEXT,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analyses" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "riskAnalysis" JSONB NOT NULL,
    "bidRecommendation" JSONB NOT NULL,
    "questions" JSONB NOT NULL,
    "proposal" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_tracking" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "durationMs" INTEGER,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "events" TEXT NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_logs" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "jobsFetched" INTEGER NOT NULL,
    "newJobsAdded" INTEGER NOT NULL,
    "sourceSummary" TEXT NOT NULL,

    CONSTRAINT "cron_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_kv" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_kv_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "market_facts" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_url_key" ON "opportunities"("url");

-- CreateIndex
CREATE INDEX "opportunities_platform_idx" ON "opportunities"("platform");

-- CreateIndex
CREATE INDEX "opportunities_score_idx" ON "opportunities"("score");

-- CreateIndex
CREATE INDEX "opportunities_createdAt_idx" ON "opportunities"("createdAt");

-- CreateIndex
CREATE INDEX "opportunities_viewed_idx" ON "opportunities"("viewed");

-- CreateIndex
CREATE INDEX "opportunities_platform_score_idx" ON "opportunities"("platform", "score");

-- CreateIndex
CREATE INDEX "opportunities_platform_createdAt_idx" ON "opportunities"("platform", "createdAt");

-- CreateIndex
CREATE INDEX "opportunities_applied_createdAt_idx" ON "opportunities"("applied", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "analyses_opportunityId_key" ON "analyses"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "project_tracking_opportunityId_key" ON "project_tracking"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_guestId_key" ON "user_sessions"("guestId");

-- CreateIndex
CREATE INDEX "market_facts_dimension_key_idx" ON "market_facts"("dimension", "key");

-- CreateIndex
CREATE INDEX "market_facts_date_idx" ON "market_facts"("date");

-- CreateIndex
CREATE UNIQUE INDEX "market_facts_date_dimension_key_key" ON "market_facts"("date", "dimension", "key");

-- AddForeignKey
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tracking" ADD CONSTRAINT "project_tracking_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
