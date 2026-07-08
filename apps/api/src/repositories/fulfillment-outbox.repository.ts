import type { FulfillmentOutboxStatus, Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../lib/db.js";

/** Rows stuck in processing longer than this may be reclaimed by another worker. */
export const FULFILLMENT_OUTBOX_STALE_PROCESSING_MS = 15 * 60 * 1000;

export async function findFulfillmentOutboxByIdempotencyKey(
  idempotencyKey: string,
  db: PrismaClient = prisma
) {
  return db.fulfillmentOutbox.findUnique({ where: { idempotencyKey: idempotencyKey.trim() } });
}

export async function createFulfillmentOutboxPending(
  input: {
    idempotencyKey: string;
    sourceLeadEventId: string;
    workType: string;
  },
  db: PrismaClient = prisma
) {
  return db.fulfillmentOutbox.create({
    data: {
      idempotencyKey: input.idempotencyKey.trim(),
      sourceLeadEventId: input.sourceLeadEventId.trim(),
      workType: input.workType.trim(),
      status: "pending",
    },
  });
}

export async function upsertFulfillmentOutboxPending(
  input: {
    idempotencyKey: string;
    sourceLeadEventId: string;
    workType: string;
  },
  db: PrismaClient = prisma
) {
  return db.fulfillmentOutbox.upsert({
    where: { idempotencyKey: input.idempotencyKey.trim() },
    create: {
      idempotencyKey: input.idempotencyKey.trim(),
      sourceLeadEventId: input.sourceLeadEventId.trim(),
      workType: input.workType.trim(),
      status: "pending",
    },
    update: {},
  });
}

export async function claimFulfillmentOutboxForProcessing(
  id: string,
  db: PrismaClient = prisma
) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - FULFILLMENT_OUTBOX_STALE_PROCESSING_MS);
  const updated = await db.fulfillmentOutbox.updateMany({
    where: {
      id,
      OR: [
        {
          status: { in: ["pending", "enqueued", "retryable_failure"] },
          availableAt: { lte: now },
        },
        {
          status: "processing",
          processingAt: { lt: staleBefore },
        },
      ],
    },
    data: {
      status: "processing",
      processingAt: now,
      attemptCount: { increment: 1 },
    },
  });
  if (updated.count === 0) return null;
  return db.fulfillmentOutbox.findUnique({ where: { id } });
}

export async function markFulfillmentOutboxEnqueued(id: string, db: PrismaClient = prisma) {
  return db.fulfillmentOutbox.update({
    where: { id },
    data: { status: "enqueued", enqueuedAt: new Date() },
  });
}

export async function markFulfillmentOutboxCompleted(id: string, db: PrismaClient = prisma) {
  return db.fulfillmentOutbox.update({
    where: { id },
    data: { status: "completed", completedAt: new Date() },
  });
}

export async function markFulfillmentOutboxRetryableFailure(
  input: { id: string; lastErrorJson: Prisma.InputJsonValue; retryAfterMs?: number },
  db: PrismaClient = prisma
) {
  const availableAt = new Date(Date.now() + (input.retryAfterMs ?? 60_000));
  return db.fulfillmentOutbox.update({
    where: { id: input.id },
    data: {
      status: "retryable_failure",
      lastErrorJson: input.lastErrorJson,
      availableAt,
    },
  });
}

export async function markFulfillmentOutboxTerminalFailure(
  input: { id: string; lastErrorJson: Prisma.InputJsonValue },
  db: PrismaClient = prisma
) {
  return db.fulfillmentOutbox.update({
    where: { id: input.id },
    data: {
      status: "terminal_failure",
      lastErrorJson: input.lastErrorJson,
      completedAt: new Date(),
    },
  });
}

export async function listSourceLeadEventsMissingOutbox(
  input: { limit?: number; workType: string },
  db: PrismaClient = prisma
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  return db.sourceLeadEvent.findMany({
    where: {
      status: { in: ["normalized", "routing_matched", "approved"] },
      fulfillmentOutboxItems: { none: { workType: input.workType } },
    },
    orderBy: { receivedAt: "asc" },
    take: limit,
    select: { id: true, sourceLeadUid: true, receivedAt: true, status: true },
  });
}

export async function listFulfillmentOutboxByStatus(
  statuses: FulfillmentOutboxStatus[],
  limit = 50,
  db: PrismaClient = prisma
) {
  return db.fulfillmentOutbox.findMany({
    where: { status: { in: statuses } },
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    take: Math.min(Math.max(limit, 1), 200),
  });
}
