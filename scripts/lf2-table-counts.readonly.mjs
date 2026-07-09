import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config();
const db = new PrismaClient();

const tables = [
  "LeadAllocation",
  "DeliveryInstruction",
  "DeliveryAttempt",
  "DeliveryTarget",
  "LeadEligibilityAssessment",
  "FulfillmentOutbox",
];

const counts = {};
for (const table of tables) {
  const rows = await db.$queryRawUnsafe(`SELECT count(*)::int AS c FROM "${table}"`);
  counts[table] = rows[0].c;
}

console.log(JSON.stringify({ counts, generatedAt: new Date().toISOString() }, null, 2));
await db.$disconnect();
