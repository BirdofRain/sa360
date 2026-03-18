import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;
  return ["true", "1", "yes", "y", "on"].includes(value.trim().toLowerCase());
}

async function main() {
  const clientAccountId = requiredEnv("CLIENT_ACCOUNT_ID");
  const clientName = process.env.CLIENT_NAME?.trim() || "Test Client";
  const metaDatasetId = requiredEnv("META_DATASET_ID");
  const metaAccessToken = requiredEnv("META_ACCESS_TOKEN");
  const metaSyncEnabled = parseBoolean(process.env.META_SYNC_ENABLED, false);
  const defaultCurrency = process.env.DEFAULT_CURRENCY?.trim() || "USD";

  await prisma.clientConfig.upsert({
    where: { clientAccountId },
    update: {
      clientName,
      metaDatasetId,
      metaAccessToken,
      metaSyncEnabled,
      defaultCurrency,
    },
    create: {
      clientAccountId,
      clientName,
      metaDatasetId,
      metaAccessToken,
      metaSyncEnabled,
      defaultCurrency,
    },
  });

  console.log(
    `Seed complete for ${clientAccountId} (metaSyncEnabled=${metaSyncEnabled})`
  );
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });