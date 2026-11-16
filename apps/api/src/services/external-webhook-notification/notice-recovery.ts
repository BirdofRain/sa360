/**
 * Re-queue pending notice receipts whose BullMQ job was lost.
 * The page is a keyset on (createdAt, id). A full page advances the cursor,
 * so a permanently pending older page cannot hide a later receipt.
 * The cursor wraps after the last row. provider_accepted, uncertain, sent,
 * failed, and suppressed rows are not selected. A stale sending claim is not
 * returned to pending. The receipt is not deleted when enqueue fails.
 */

import type { PrismaClient } from "@prisma/client";

export const EXTERNAL_WEBHOOK_NOTICE_PENDING_RECOVERY_PAGE = 25;
export const EXTERNAL_WEBHOOK_NOTICE_PENDING_CURSOR_ID = "pending-receipt";

type PendingKey = { id: string; createdAt: Date };

export async function recoverPendingExternalWebhookNotices(
  db: PrismaClient,
  input: {
    limit?: number;
    /** Test isolation. Production omits this and walks the durable cursor. */
    ids?: string[];
    enqueue: (receiptId: string) => Promise<unknown>;
  }
): Promise<{ scanned: number; enqueued: number }> {
  const limit = input.limit ?? EXTERNAL_WEBHOOK_NOTICE_PENDING_RECOVERY_PAGE;
  if (input.ids) {
    const rows = await db.externalWebhookNotificationReceipt.findMany({
      where: { status: "pending", id: { in: input.ids } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
      select: { id: true },
    });
    for (const row of rows) await input.enqueue(row.id);
    return { scanned: rows.length, enqueued: rows.length };
  }

  const stored = await db.externalWebhookNoticeDiscoveryCursor.findUnique({
    where: { id: EXTERNAL_WEBHOOK_NOTICE_PENDING_CURSOR_ID },
  });
  const after =
    stored?.lastHttpAcceptedAt && stored.lastAttemptId
      ? { createdAt: stored.lastHttpAcceptedAt, id: stored.lastAttemptId }
      : null;
  let rows = await readPendingPage(db, after, limit);
  if (rows.length < limit && after) {
    const head = await readPendingPage(db, null, limit - rows.length);
    const seen = new Set(rows.map((row) => row.id));
    for (const row of head) {
      if (seen.has(row.id)) continue;
      if (!isAtOrBefore(row, after)) continue;
      rows.push(row);
      if (rows.length >= limit) break;
    }
  }
  let inspected: PendingKey | null = null;
  let enqueued = 0;
  for (const row of rows) {
    await input.enqueue(row.id);
    inspected = row;
    enqueued += 1;
  }
  if (inspected) {
    await db.externalWebhookNoticeDiscoveryCursor.upsert({
      where: { id: EXTERNAL_WEBHOOK_NOTICE_PENDING_CURSOR_ID },
      create: {
        id: EXTERNAL_WEBHOOK_NOTICE_PENDING_CURSOR_ID,
        lastHttpAcceptedAt: inspected.createdAt,
        lastAttemptId: inspected.id,
        updatedAt: new Date(),
      },
      update: { lastHttpAcceptedAt: inspected.createdAt, lastAttemptId: inspected.id },
    });
  }
  return { scanned: rows.length, enqueued };
}

async function readPendingPage(db: PrismaClient, after: PendingKey | null, limit: number): Promise<PendingKey[]> {
  return db.externalWebhookNotificationReceipt.findMany({
    where: after
      ? {
          AND: [
            { status: "pending" },
            {
              OR: [
                { createdAt: { gt: after.createdAt } },
                { AND: [{ createdAt: after.createdAt }, { id: { gt: after.id } }] },
              ],
            },
          ],
        }
      : { status: "pending" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, createdAt: true },
  });
}

function isAtOrBefore(row: PendingKey, cursor: PendingKey): boolean {
  if (row.createdAt < cursor.createdAt) return true;
  return row.createdAt.getTime() === cursor.createdAt.getTime() && row.id <= cursor.id;
}
