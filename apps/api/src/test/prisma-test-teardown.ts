import { after } from "node:test";
import { prisma } from "../lib/db.js";
import { redis } from "../lib/redis.js";
import { closeMetaDispatchQueue } from "../services/queue-service.js";
import { closeBulkImportDeliveryQueue } from "../services/bulk-import/bulk-import-queue.service.js";

/**
 * Release Prisma pool slots when a test file finishes (each file may run in its own worker).
 * Complements db.ts beforeExit disconnect; helps parallel runs against small Postgres instances.
 */
after(async () => {
  await closeMetaDispatchQueue();
  await closeBulkImportDeliveryQueue();
  redis.disconnect(false);
  await prisma.$disconnect();
});
