import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

let prisma: PrismaClient;

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/freelance_copilot?schema=public";

if (process.env.NODE_ENV === "production") {
  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
} else {
  // Ensure the database client is a singleton in development to prevent hot reloading from creating new connection pools.
  const globalWithPrisma = global as typeof globalThis & {
    prisma?: PrismaClient;
  };

  if (!globalWithPrisma.prisma) {
    const pool = new pg.Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    globalWithPrisma.prisma = new PrismaClient({ adapter });
  }
  prisma = globalWithPrisma.prisma;
}

export { prisma };
export default prisma;
