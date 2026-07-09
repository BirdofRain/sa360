import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config();

const db = new PrismaClient();

try {
  const counts = {
    LeadAllocation: await db.leadAllocation.count(),
    DeliveryInstruction: await db.deliveryInstruction.count(),
    DeliveryAttempt: await db.deliveryAttempt.count(),
    DeliveryTarget: await db.deliveryTarget.count(),
    LeadEligibilityAssessment: await db.leadEligibilityAssessment.count(),
    FulfillmentOutbox: await db.fulfillmentOutbox.count(),
  };

  console.log(JSON.stringify({ counts, generatedAt: new Date().toISOString() }, null, 2));
} finally {
  await db.$disconnect();
}
