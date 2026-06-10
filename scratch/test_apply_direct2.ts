// Inline Prisma client for verification script (no external import)
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/freelance_copilot?schema=public";
let prisma: PrismaClient;
if (process.env.NODE_ENV === "production") {
  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
} else {
  // Singleton for dev to avoid multiple pools on hot reload
  const globalWithPrisma = global as typeof globalThis & { prisma?: PrismaClient };
  if (!globalWithPrisma.prisma) {
    const pool = new pg.Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    globalWithPrisma.prisma = new PrismaClient({ adapter });
  }
  prisma = globalWithPrisma.prisma;
}

async function main() {
  // Find a visible opportunity (no tracking)
  const opp = await prisma.opportunity.findFirst({
    where: { tracking: { is: null } },
    select: { id: true, title: true }
  });
  if (!opp) {
    console.log("No visible opportunity found.");
    return;
  }
  console.log("Testing with Opportunity ID:", opp.id, "Title:", opp.title);

  // Mark as APPLIED using upsert on projectTracking
  const tracking = await prisma.projectTracking.upsert({
    where: { opportunityId: opp.id },
    create: { opportunityId: opp.id, status: "APPLIED" },
    update: { status: "APPLIED" }
  });
  console.log("Tracking upsert result:", tracking);

  // Define same visibility filter as getOpportunities (exclude APPLIED/SKIPPED)
  const visibleWhere = {
    NOT: {
      tracking: { status: { in: ["APPLIED", "SKIPPED"] } }
    }
  };

  const list = await prisma.opportunity.findMany({
    where: visibleWhere,
    select: { id: true }
  });
  const stillExists = list.some(item => item.id === opp.id);
  console.log("Opportunity still appears in feed after apply?", stillExists);
}

main().catch(e => {
  console.error("Error:", e);
  process.exit(1);
});
