import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.clientConfig.upsert({
    where: { clientAccountId: "lal_client_0142" },
    update: {},
    create: {
      clientAccountId: "lal_client_0142",
      clientName: "Test Client",
      metaDatasetId: "943556280266263",
      metaAccessToken: "EAAmNZB2bKZCdsBQZBIMXJvHs7UnBMTBtW4liA9TUv5zNpCnmo5bNOZBloARO5msSwPepDYT3NYWsP8FAZCUs5NrJ7C9gewBmb3NbhK2OvbUz7X2q19rgUUTVoHuZAJU2PukZB7zErUnokCV5FMZBPDVWVTuBIsRabMfakVBM2dAAEF1oOYPZC0k8esHjg42oJQmd2rgZDZD",
      metaSyncEnabled: true,
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