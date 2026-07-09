import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config();
const db = new PrismaClient();

const row = await db.$queryRaw`
  SELECT id, "orderNumber", status, "assignmentStatus",
         "requestedQuantity", "reservedQuantity", "fulfilledQuantity",
         "updatedAt", "createdAt"
  FROM "LeadOrder"
  WHERE "orderNumber" = 'LO-1043'
`;

console.log(JSON.stringify({ lo1043: row[0] ?? null, generatedAt: new Date().toISOString() }, null, 2));
await db.$disconnect();
