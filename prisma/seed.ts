import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.clientConfig.upsert({
    where: { clientAccountId: "lal_client_0142" },
    update: {},
    create: {
      clientAccountId: "lal_client_0142",
      clientName: "Test Client",
      metaDatasetId: "test_dataset",
      metaAccessToken: "test_token",
      metaSyncEnabled: false,
      defaultCurrency: "USD",
    },
  });

  console.log("Seed complete");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });