import { PrismaClient } from "@prisma/client";

import { resolveTestPrismaDatabaseUrl } from "./safe-test-database-url.js";

function isTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.argv.some((arg) => arg === "--test" || arg.includes("--test"))
  );
}

function prismaDatasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL?.trim();
  if (!isTestRuntime()) return raw || undefined;

  // Fail closed: test Prisma clients never accept an unsafe/general DATABASE_URL.
  const safe = resolveTestPrismaDatabaseUrl(raw);
  if (!safe) return undefined;
  if (/connection_limit=/i.test(safe)) return safe;
  const sep = safe.includes("?") ? "&" : "?";
  // One slot per test worker — parallel test files each spawn a process; avoid exhausting Postgres.
  const limit = process.env.SA360_TEST_PRISMA_CONNECTION_LIMIT?.trim() || "1";
  return `${safe}${sep}connection_limit=${limit}&pool_timeout=20`;
}

const globalForPrisma = globalThis as unknown as { __sa360Prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const url = prismaDatasourceUrl();
  return new PrismaClient(
    url
      ? {
          datasources: { db: { url } },
        }
      : undefined
  );
}

export const prisma = globalForPrisma.__sa360Prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__sa360Prisma = prisma;
}

if (isTestRuntime()) {
  process.once("beforeExit", () => {
    void prisma.$disconnect();
  });
}
