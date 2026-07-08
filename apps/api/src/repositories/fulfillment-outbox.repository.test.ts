import test from "node:test";
import assert from "node:assert/strict";
import type { FulfillmentOutbox, PrismaClient } from "@prisma/client";

import {
  claimFulfillmentOutboxForProcessing,
  FULFILLMENT_OUTBOX_STALE_PROCESSING_MS,
} from "./fulfillment-outbox.repository.js";

type OutboxRow = FulfillmentOutbox;

function createOutboxStore(initial: OutboxRow) {
  let row = { ...initial };
  const db = {
    fulfillmentOutbox: {
      async updateMany(args: {
        where: {
          id: string;
          OR: Array<Record<string, unknown>>;
        };
        data: {
          status: string;
          processingAt: Date;
          attemptCount: { increment: number };
        };
      }) {
        const now = new Date();
        const staleBefore = new Date(now.getTime() - FULFILLMENT_OUTBOX_STALE_PROCESSING_MS);
        const claimable = args.where.OR.some((clause) => {
          if ("status" in clause && clause.status === "processing") {
            return row.status === "processing" && row.processingAt && row.processingAt < staleBefore;
          }
          const statuses = (clause.status as { in: string[] }).in;
          return (
            statuses.includes(row.status) &&
            row.availableAt <= now
          );
        });
        if (!claimable || row.id !== args.where.id) return { count: 0 };
        row = {
          ...row,
          status: "processing",
          processingAt: args.data.processingAt,
          attemptCount: row.attemptCount + 1,
        };
        return { count: 1 };
      },
      async findUnique() {
        return row;
      },
    },
  } as unknown as PrismaClient;

  return {
    db,
    getRow: () => row,
    setRow: (next: OutboxRow) => {
      row = next;
    },
  };
}

function baseOutbox(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: "outbox_1",
    idempotencyKey: "fulfillment:shadow:evt_1",
    sourceLeadEventId: "evt_1",
    workType: "shadow_fulfillment_v1",
    status: "pending",
    availableAt: new Date("2020-01-01T00:00:00.000Z"),
    enqueuedAt: null,
    processingAt: null,
    completedAt: null,
    attemptCount: 0,
    lastErrorJson: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as OutboxRow;
}

test("only one concurrent claim succeeds for the same outbox row", async () => {
  const store = createOutboxStore(baseOutbox());
  const [first, second] = await Promise.all([
    claimFulfillmentOutboxForProcessing("outbox_1", store.db),
    claimFulfillmentOutboxForProcessing("outbox_1", store.db),
  ]);

  const winners = [first, second].filter(Boolean);
  assert.equal(winners.length, 1);
  assert.equal(store.getRow().status, "processing");
  assert.equal(store.getRow().attemptCount, 1);
});

test("completed outbox work cannot be claimed again", async () => {
  const store = createOutboxStore(
    baseOutbox({
      status: "completed",
      completedAt: new Date(),
    })
  );
  const claimed = await claimFulfillmentOutboxForProcessing("outbox_1", store.db);
  assert.equal(claimed, null);
});

test("stale processing rows can be reclaimed", async () => {
  const staleAt = new Date(Date.now() - FULFILLMENT_OUTBOX_STALE_PROCESSING_MS - 1_000);
  const store = createOutboxStore(
    baseOutbox({
      status: "processing",
      processingAt: staleAt,
      attemptCount: 2,
    })
  );
  const claimed = await claimFulfillmentOutboxForProcessing("outbox_1", store.db);
  assert.ok(claimed);
  assert.equal(store.getRow().status, "processing");
  assert.equal(store.getRow().attemptCount, 3);
});
