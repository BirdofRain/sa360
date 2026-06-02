import { PrismaClient } from "@prisma/client";

function isTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.argv.some((arg) => arg === "--test" || arg.includes("--test"))
  );
}

function prismaDatasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw || !isTestRuntime()) return raw;
  if (/connection_limit=/i.test(raw)) return raw;
  const sep = raw.includes("?") ? "&" : "?";
  return `${raw}${sep}connection_limit=5&pool_timeout=20`;
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
