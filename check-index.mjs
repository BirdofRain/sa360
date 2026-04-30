import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function safeJson(value) {
  return JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
}

async function main() {
  const rows = await prisma.inboundContactIndex.findMany({
    orderBy: { updatedAt: "desc" },
    take: 10
  });

  console.log(safeJson(rows));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
