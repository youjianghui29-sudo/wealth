import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  sqlitePragmas?: Promise<unknown>;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export function ensureSqlitePragmas() {
  if (!globalForPrisma.sqlitePragmas) {
    globalForPrisma.sqlitePragmas = Promise.all([
      prisma.$queryRawUnsafe("PRAGMA busy_timeout = 60000"),
      prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL"),
      prisma.$queryRawUnsafe("PRAGMA synchronous = NORMAL")
    ]).catch(() => null);
  }

  return globalForPrisma.sqlitePragmas;
}
