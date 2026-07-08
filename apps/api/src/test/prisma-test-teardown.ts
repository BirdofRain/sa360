import { after } from "node:test";
import { prisma } from "../lib/db.js";
import { disconnectRedisForTests } from "../lib/redis.js";
import {
  closeMetaDispatchQueue,
  wasMetaDispatchQueueOpened,
} from "../services/queue-service.js";
import {
  closeBulkImportDeliveryQueue,
  wasBulkImportDeliveryQueueOpened,
} from "../services/bulk-import/bulk-import-queue.service.js";

const TEARDOWN_TIMEOUT_MS = 5_000;

async function withTeardownTimeout<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label} timed out after ${TEARDOWN_TIMEOUT_MS}ms`)),
        TEARDOWN_TIMEOUT_MS
      );
    }),
  ]);
}

/**
 * Release Prisma pool slots and optional Redis/BullMQ handles when a test file finishes.
 * Queue and Redis teardown are skipped when those clients were never opened.
 */
after(async () => {
  if (wasMetaDispatchQueueOpened()) {
    await withTeardownTimeout("closeMetaDispatchQueue", () => closeMetaDispatchQueue());
  }
  if (wasBulkImportDeliveryQueueOpened()) {
    await withTeardownTimeout("closeBulkImportDeliveryQueue", () =>
      closeBulkImportDeliveryQueue()
    );
  }
  await disconnectRedisForTests(TEARDOWN_TIMEOUT_MS);
  await withTeardownTimeout("prisma.$disconnect", () => prisma.$disconnect());
});
