// Test script: runs full collector + DB write pipeline
// npx tsx scripts/test-collectors.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);

function makePrisma() {
  const rawUrl = process.env.DATABASE_URL || "file:./prisma/dev.db";
  const dbPath = rawUrl.startsWith("file:")
    ? path.resolve(process.cwd(), rawUrl.slice(5))
    : path.resolve(process.cwd(), rawUrl);

  const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({ adapter });
}

// ── API Tests ──────────────────────────────────────────────────────────────

async function testFreelancer() {
  console.log("\n=== FREELANCER API ===");
  const url =
    "https://www.freelancer.com/api/projects/0.1/projects/active/?query=react+developer&limit=3&compact=true";
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  const projects = data?.result?.projects || [];
  console.log(`  Jobs: ${projects.length}`);
  if (projects[0]) console.log(`  Sample: "${projects[0].title}" $${projects[0].budget?.minimum}`);
}

async function testRemotive() {
  console.log("\n=== REMOTIVE API ===");
  const res = await fetch("https://remotive.com/api/remote-jobs?category=software-dev&limit=5", { signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  console.log(`  Jobs: ${data?.jobs?.length ?? 0}`);
  if (data?.jobs?.[0]) console.log(`  Sample: "${data.jobs[0].title}" at ${data.jobs[0].company_name}`);
}

async function testRemoteOK() {
  console.log("\n=== REMOTEOK API ===");
  const res = await fetch("https://remoteok.com/api?tag=dev", { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  const jobs = Array.isArray(data) ? data.filter((j: any) => j.position) : [];
  console.log(`  Jobs: ${jobs.length}`);
  if (jobs[0]) console.log(`  Sample: "${jobs[0].position}" at ${jobs[0].company}`);
}

async function testArbeitNow() {
  console.log("\n=== ARBEITNOW API ===");
  const res = await fetch("https://www.arbeitnow.com/api/job-board-api", { signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  console.log(`  Jobs: ${data?.data?.length ?? 0}`);
  if (data?.data?.[0]) console.log(`  Sample: "${data.data[0].title}"`);
}

// ── DB Write Test ──────────────────────────────────────────────────────────

async function testDatabaseWrite() {
  console.log("\n=== DATABASE WRITE TEST ===");
  const prisma = makePrisma();
  try {
    // Count existing
    const before = await prisma.opportunity.count();
    console.log(`  Existing records: ${before}`);

    // Upsert a dummy record
    const testUrl = `https://test-job-${Date.now()}.example.com`;
    await prisma.opportunity.upsert({
      where: { url: testUrl },
      update: {},
      create: {
        title: "Test Job (delete me)",
        description: "Automated test record",
        budget: "$100",
        platform: "TestPlatform",
        url: testUrl,
        score: 50,
        risk: "Low",
        status: "OPEN",
      },
    });

    const after = await prisma.opportunity.count();
    console.log(`  Records after insert: ${after}`);

    // Clean up
    await prisma.opportunity.delete({ where: { url: testUrl } });
    console.log(`  ✅ DB write + delete works correctly`);
  } catch (e: any) {
    console.error(`  ❌ DB FAILED: ${e.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

// ── Full Sync Simulation ───────────────────────────────────────────────────

async function testFullSync() {
  console.log("\n=== FULL SYNC SIMULATION ===");
  const prisma = makePrisma();
  try {
    // Grab real Remotive jobs
    const res = await fetch("https://remotive.com/api/remote-jobs?category=software-dev&limit=10", { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    const jobs = data?.jobs || [];
    console.log(`  Fetched ${jobs.length} jobs from Remotive`);

    let saved = 0;
    for (const job of jobs) {
      if (!job.url) continue;
      await prisma.opportunity.upsert({
        where: { url: job.url },
        update: {},
        create: {
          title: job.title?.trim() || "Untitled",
          description: (job.description || "").replace(/<[^>]+>/g, " ").substring(0, 2000),
          budget: job.salary || "Undetermined",
          platform: "Remotive",
          url: job.url,
          score: 55,
          risk: "Medium",
          status: "OPEN",
          clientName: job.company_name || undefined,
          country: job.candidate_required_location || undefined,
        },
      });
      saved++;
    }

    const total = await prisma.opportunity.count({ where: { status: "OPEN" } });
    console.log(`  ✅ Saved ${saved} new jobs. Total OPEN in DB: ${total}`);
  } catch (e: any) {
    console.error(`  ❌ Sync FAILED: ${e.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function testUpwork() {
  console.log("\n=== UPWORK COLLECTOR ===");
  const { UpworkCollector } = await import("../src/collectors/UpworkCollector");
  const collector = new UpworkCollector();
  try {
    const jobs = await collector.fetch();
    console.log(`  Upwork Collector fetched: ${jobs.length} jobs`);
    if (jobs[0]) {
      console.log(`  Sample: "${jobs[0].title}"`);
      console.log(`    Budget: ${jobs[0].budget}`);
      console.log(`    Country: ${jobs[0].country}`);
      console.log(`    Client Name: ${jobs[0].clientName}`);
      console.log(`    Connections: ${jobs[0].connections}`);
    }
  } catch (e: any) {
    console.error(`  Upwork FAILED: ${e.message}`);
  }
}

async function main() {
  console.log("=== FREELANCE COPILOT — FULL PIPELINE TEST ===");
  await testUpwork();
  await testFreelancer();
  await testRemotive();
  await testRemoteOK();
  await testArbeitNow();
  await testDatabaseWrite();
  await testFullSync();
  console.log("\n=== ALL TESTS DONE ===");
}

main().catch(console.error);
