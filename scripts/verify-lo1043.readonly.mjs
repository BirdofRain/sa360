import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config();

const db = new PrismaClient();

try {
  const row = await db.leadOrder.findFirst({
    where: { orderNumber: "LO-1043" },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      requestedQuantity: true,
      reservedQuantity: true,
      fulfilledQuantity: true,
      proposedQuantity: true,
    },
  });

  console.log(JSON.stringify({ lo1043: row ?? null, generatedAt: new Date().toISOString() }, null, 2));
} finally {
  await db.$disconnect();
}
