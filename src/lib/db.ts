import { PrismaClient } from "@prisma/client";
import { createRequire } from "module";
import path from "path";

declare global {
   
  var __prisma: PrismaClient | undefined;
}

// Use createRequire so the CJS native modules (better-sqlite3, adapter) load correctly
// in both tsx/ESM dev and production Next.js environments.
const require = createRequire(import.meta.url);

import { getStoragePath } from "./storage";

function getDatabaseUrl(): string | null {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ].filter((value): value is string => Boolean(value && value.trim()));

  if (candidates.length > 0) {
    return candidates[0].trim();
  }

  return null;
}

function createPrismaClient(): PrismaClient {
  const connectionUrl = getDatabaseUrl();

  if (!connectionUrl) {
    console.warn(
      "[db] No DATABASE_URL/POSTGRES_URL is configured yet. Prisma is initialized in deferred mode for build compatibility; database calls will fail until the env is set.",
    );
    const { PrismaPg } = require("@prisma/adapter-pg");
    const adapter = new PrismaPg({
      connectionString: "postgresql://user:password@127.0.0.1:5432/freelance-copilot-ai",
    });
    return new PrismaClient({ adapter });
  }

  if (/^postgres(?:ql)?:\/\//i.test(connectionUrl)) {
     
    const { PrismaPg } = require("@prisma/adapter-pg");
    const adapter = new PrismaPg({ connectionString: connectionUrl });
    return new PrismaClient({ adapter });
  }

  let dbPath = connectionUrl.startsWith("file:")
    ? path.resolve(/* turbopackIgnore: true */ process.cwd(), connectionUrl.slice(5))
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), connectionUrl);

  if (dbPath.includes(process.cwd())) {
    dbPath = getStoragePath("dev.db");
  }

   
  const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({ adapter });
}

export const prisma = global.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

export default prisma;
