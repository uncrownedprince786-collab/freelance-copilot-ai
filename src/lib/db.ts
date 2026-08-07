import { PrismaClient } from "@prisma/client";
import { createRequire } from "module";
import path from "path";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Use createRequire so the CJS native modules (better-sqlite3, adapter) load correctly
// in both tsx/ESM dev and production Next.js environments.
const require = createRequire(import.meta.url);

import { getStoragePath } from "./storage";

function createPrismaClient(): PrismaClient {
  const rawUrl = process.env.DATABASE_URL || "file:./prisma/dev.db";
  let dbPath = rawUrl.startsWith("file:")
    ? path.resolve(process.cwd(), rawUrl.slice(5))
    : path.resolve(process.cwd(), rawUrl);

  if (dbPath.includes(process.cwd())) {
    dbPath = getStoragePath("dev.db");
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({ adapter });
}

export const prisma = global.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

export default prisma;
