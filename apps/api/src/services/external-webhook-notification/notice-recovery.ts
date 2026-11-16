/**
 * Re-queue pending notice receipts whose BullMQ job was lost.
 * Acceptance reconciliation does not see these rows, because the receipt
 * already exists. provider_accepted, uncertain, sent, failed, and suppressed
 * rows are not selected. A stale sending claim is not returned to pending.
 */

import type { PrismaClient } from "@prisma/client";

export const EXTERNAL_WEBHOOK_NOTICE_PENDING_RECOVERY_PAGE = 25;

export async function recoverPendingExternalWebhookNotices(
  db: PrismaClient,
  input: {
    limit?: number;
    /** Production omits this and scans the oldest pending page. */
    ids?: string[];
    enqueue: (receiptId: string) => Promise<unknown>;
  }
): Promise<{ scanned: number; enqueued: number }> {
  const limit = input.limit ?? EXTERNAL_WEBHOOK_NOTICE_PENDING_RECOVERY_PAGE;
  const rows = await db.externalWebhookNotificationReceipt.findMany({
    where: { status: "pending", ...(input.ids ? { id: { in: input.ids } } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  });
  let enqueued = 0;
  for (const row of rows) {
    await input.enqueue(row.id);
    enqueued += 1;
  }
  return { scanned: rows.length, enqueued };
}
