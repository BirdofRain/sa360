import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  OPERATOR_REVIEW_BILLING_STATUS,
  OPERATOR_REVIEW_CLOSE_PHRASE,
  assertOperatorReviewAllowsExport,
  closeOperatorReviewBatch,
  decideOperatorReviewItem,
  downloadOperatorSupplementalExport,
  fillOperatorReviewShortfall,
  isPplOperatorReviewEnabled,
  openOperatorReviewBatch,
  paginateOperatorReviewItems,
  reconcileOperatorReviewQuantities,
  reviewFlagsForIdentity,
} from "./operator-review.service.js";

const originalFlag = process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED;

afterEach(() => {
  if (originalFlag === undefined) delete process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED;
  else process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED = originalFlag;
});

describe("operator review flags", () => {
  it("defaults off and enables only for true", () => {
    delete process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED;
    assert.equal(isPplOperatorReviewEnabled(), false);
    process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED = "1";
    assert.equal(isPplOperatorReviewEnabled(), false);
    process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED = "true";
    assert.equal(isPplOperatorReviewEnabled(), true);
  });

  it("flags placeholder names without treating them as a delivery", () => {
    assert.deepEqual(
      reviewFlagsForIdentity({
        contact: { first_name: "Test", last_name: "Unknown", phone_e164: "+12025550100" },
      }),
      ["placeholder_first_name", "placeholder_last_name"]
    );
    assert.deepEqual(
      reviewFlagsForIdentity({
        contact: { first_name: "Al", last_name: "Ng", phone_e164: "+12025550101" },
      }),
      []
    );
  });
});

function reviewDb(overrides: Record<string, unknown> = {}) {
  const items: Array<Record<string, unknown>> = [];
  const batches: Array<Record<string, unknown>> = [];
  const supplementals: Array<Record<string, unknown>> = [];
  const deliveredWrites: unknown[] = [];

  const db = {
    deliveredWrites,
    pplOperatorReviewBatch: {
      findUnique: async ({ where }: { where: { id?: string; requestId?: string } }) => {
        const row = batches.find((b) => b.id === where.id || b.requestId === where.requestId);
        if (!row) return null;
        return { ...row, items: items.filter((item) => item.batchId === row.id) };
      },
      findFirst: async ({ where }: { where: { leadOrderId: string; status: string } }) =>
        batches.find((b) => b.leadOrderId === where.leadOrderId && b.status === where.status) ??
        null,
      findMany: async () =>
        batches.map((row) => ({
          ...row,
          items: items.filter((item) => item.batchId === row.id),
        })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const start = items.length;
        const createdItems = (
          (data.items as { create?: Array<Record<string, unknown>> } | undefined)?.create ?? []
        ).map((item, index) => ({
          id: `item_${start + index + 1}`,
          batchId: "batch_1",
          decidedBy: null,
          decidedAt: null,
          rejectionReason: null,
          ...item,
        }));
        items.push(...createdItems);
        const batch = {
          id: "batch_1",
          acceptedCount: 0,
          rejectedCount: 0,
          unusedBufferCount: 0,
          shortfallCount: 0,
          billedQuantity: null,
          createdAt: new Date("2026-10-13T00:00:00.000Z"),
          ...data,
          items: createdItems,
        };
        delete (batch as { items?: unknown }).items;
        batches.push(batch);
        return { ...batch, items: createdItems };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const batch = batches.find((row) => row.id === where.id);
        if (!batch) throw new Error("missing batch");
        if (data.acceptedCount && typeof data.acceptedCount === "object") {
          batch.acceptedCount =
            Number(batch.acceptedCount) +
            Number((data.acceptedCount as { increment?: number }).increment ?? 0);
        } else if (data.acceptedCount != null) {
          batch.acceptedCount = data.acceptedCount;
        }
        if (data.rejectedCount && typeof data.rejectedCount === "object") {
          batch.rejectedCount =
            Number(batch.rejectedCount) +
            Number((data.rejectedCount as { increment?: number }).increment ?? 0);
        } else if (data.rejectedCount != null) {
          batch.rejectedCount = data.rejectedCount;
        }
        if (data.unusedBufferCount && typeof data.unusedBufferCount === "object") {
          batch.unusedBufferCount =
            Number(batch.unusedBufferCount) +
            Number((data.unusedBufferCount as { increment?: number }).increment ?? 0);
        } else if (data.unusedBufferCount != null) {
          batch.unusedBufferCount = data.unusedBufferCount;
        }
        if (data.shortfallCount != null) batch.shortfallCount = data.shortfallCount;
        if (data.status) batch.status = data.status;
        if ("billedQuantity" in data) batch.billedQuantity = data.billedQuantity;
        return { ...batch, items: items.filter((item) => item.batchId === batch.id) };
      },
    },
    pplOperatorReviewItem: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const item = items.find((row) => row.id === where.id);
        if (!item) return null;
        return { ...item, batch: batches.find((row) => row.id === item.batchId) };
      },
      findMany: async ({
        where,
      }: {
        where: {
          batch?: { leadOrderId?: string };
          batchId?: string;
          allocationId?: { in?: string[] };
          role?: string;
          status?: string;
        };
      }) => {
        const orderId = where.batch?.leadOrderId;
        return items
          .filter((item) => {
            if (where.batchId && item.batchId !== where.batchId) return false;
            if (where.role && item.role !== where.role) return false;
            if (where.status && item.status !== where.status) return false;
            if (where.allocationId?.in && !where.allocationId.in.includes(String(item.allocationId))) {
              return false;
            }
            if (!orderId) return true;
            const batch = batches.find((row) => row.id === item.batchId);
            return batch?.leadOrderId === orderId;
          })
          .map((item) => ({
            ...item,
            batch: batches.find((row) => row.id === item.batchId),
          }));
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const item = items.find((row) => row.id === where.id);
        if (!item) throw new Error("missing item");
        Object.assign(item, data);
        return item;
      },
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        const start = items.length;
        data.forEach((row, index) => {
          items.push({
            id: `item_${start + index + 1}`,
            decidedBy: null,
            decidedAt: null,
            rejectionReason: null,
            ...row,
          });
        });
        return { count: data.length };
      },
    },
    pplSupplementalExport: {
      findUnique: async ({ where }: { where: { requestId?: string; id?: string } }) =>
        supplementals.find((row) => row.requestId === where.requestId || row.id === where.id) ??
        null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `sup_${supplementals.length + 1}`, exportPackageId: null, ...data };
        supplementals.push(row);
        return row;
      },
    },
    leadOrder: {
      findUnique: async () => ({
        id: "ord_1",
        clientAccountId: "client_1",
        status: "active",
        requestedQuantity: 2,
        leadVolume: 2,
        orderNumber: "LO-1",
        nicheKey: "vet",
        canceledAt: null,
        completedAt: null,
        pausedAt: null,
      }),
    },
    leadAllocation: {
      findMany: async ({ where }: { where?: { leadOrderId?: string; id?: { in: string[] } } }) => {
        if (where?.id?.in) {
          return where.id.in.map((id) => ({
            id,
            leadInventoryItemId: `inv_${id}`,
            sourceLeadEventId: `evt_${id}`,
            sourceLeadEvent: {
              normalizedPayloadJson: {
                contact: { first_name: "Ada", last_name: "Lee", phone_e164: "+12025550100" },
              },
            },
            leadInventoryItem: {
              generatedAt: new Date("2026-08-01T00:00:00.000Z"),
              nicheKey: "vet",
              normalizedState: "NC",
            },
          }));
        }
        return [
          {
            id: "alloc_1",
            leadInventoryItemId: "inv_1",
            sourceLeadEventId: "evt_1",
            sourceLeadEvent: {
              normalizedPayloadJson: {
                contact: { first_name: "Ada", last_name: "Lee", phone_e164: "+12025550100" },
              },
            },
            leadInventoryItem: {
              generatedAt: new Date("2026-08-01T00:00:00.000Z"),
              nicheKey: "vet",
              normalizedState: "NC",
            },
          },
          {
            id: "alloc_2",
            leadInventoryItemId: "inv_2",
            sourceLeadEventId: "evt_2",
            sourceLeadEvent: {
              normalizedPayloadJson: {
                contact: { first_name: "Test", last_name: "Lead", phone_e164: "+12025550101" },
              },
            },
            leadInventoryItem: {
              generatedAt: new Date("2026-08-01T00:00:00.000Z"),
              nicheKey: "vet",
              normalizedState: "NC",
            },
          },
        ];
      },
    },
    buyerDeliveredIdentity: {
      create: async (payload: unknown) => {
        deliveredWrites.push(payload);
        return payload;
      },
      createMany: async (payload: unknown) => {
        deliveredWrites.push(payload);
        return payload;
      },
    },
    $executeRaw: async () => 1,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    ...overrides,
  };

  return db as unknown as PrismaClient & { deliveredWrites: unknown[] };
}

describe("operator review workflow", () => {
  it("opens a batch from reserved primaries plus unbilled buffers", async () => {
    process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED = "true";
    const reserved: string[] = [];
    const db = reviewDb();
    const opened = await openOperatorReviewBatch(
      { orderId: "ord_1", bufferQuantity: 1, requestId: "rev-1" },
      db,
      {
        reserveUnbilledCandidate: async ({ idempotencyKey }) => {
          reserved.push(idempotencyKey);
          return { ok: true, allocationId: "alloc_buf", inventoryItemId: "inv_buf" };
        },
      }
    );
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal(opened.item.purchasedQuantity, 2);
    assert.equal(opened.item.bufferQuantity, 1);
    assert.equal(opened.item.billedQuantity, null);
    assert.equal(opened.item.billingStatus, OPERATOR_REVIEW_BILLING_STATUS);
    assert.equal(opened.item.items.length, 3);
    assert.equal(opened.item.items.filter((row) => row.role === "buffer").length, 1);
    assert.deepEqual(reserved, ["rev-1:buffer:0"]);
    assert.equal((db as unknown as { deliveredWrites: unknown[] }).deliveredWrites.length, 0);
  });

  it("rejects a lead without marking it delivered and reports the reason", async () => {
    process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED = "true";
    const released: string[] = [];
    const db = reviewDb();
    const opened = await openOperatorReviewBatch(
      { orderId: "ord_1", bufferQuantity: 0, requestId: "rev-2" },
      db
    );
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const decided = await decideOperatorReviewItem(
      {
        itemId: opened.item.items[0]!.id,
        action: "reject",
        rejectionReason: "placeholder_identity",
      },
      db,
      {
        releaseAllocation: async ({ allocationId }) => {
          released.push(allocationId);
          return { ok: true };
        },
      }
    );
    assert.equal(decided.ok, true);
    if (!decided.ok) return;
    assert.equal(decided.item.status, "rejected");
    assert.equal(decided.batch.rejectedCount, 1);
    assert.equal(decided.batch.billedQuantity, null);
    assert.equal(decided.batch.rejectionReport.rejectionReasons.placeholder_identity, 1);
    assert.deepEqual(released, [opened.item.items[0]!.allocationId]);
    assert.equal((db as unknown as { deliveredWrites: unknown[] }).deliveredWrites.length, 0);
  });

  it("closes leftover buffers as unused, never bills them, and reports shortfall", async () => {
    process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED = "true";
    const db = reviewDb();
    const opened = await openOperatorReviewBatch(
      { orderId: "ord_1", bufferQuantity: 1, requestId: "rev-3" },
      db,
      {
        reserveUnbilledCandidate: async () => ({
          ok: true,
          allocationId: "alloc_buf",
          inventoryItemId: "inv_buf",
        }),
      }
    );
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    for (const item of opened.item.items.filter((row) => row.role === "primary")) {
      const accepted = await decideOperatorReviewItem({ itemId: item.id, action: "accept" }, db);
      assert.equal(accepted.ok, true);
    }
    const closed = await closeOperatorReviewBatch(
      {
        batchId: opened.item.id,
        confirmationPhrase: OPERATOR_REVIEW_CLOSE_PHRASE,
      },
      db,
      { releaseAllocation: async () => ({ ok: true }) }
    );
    assert.equal(closed.ok, true);
    if (!closed.ok) return;
    assert.equal(closed.item.status, "closed");
    assert.equal(closed.item.unusedBufferCount, 1);
    assert.equal(closed.item.shortfallCount, 0);
    assert.equal(closed.item.billedQuantity, null);
    assert.equal(closed.item.rejectionReport.billedQuantity, null);
    assert.match(closed.item.rejectionReport.billingNote, /never auto-billed/);
  });

  it("fills shortfall with unbilled supplementals", async () => {
    process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED = "true";
    const db = reviewDb();
    const opened = await openOperatorReviewBatch(
      { orderId: "ord_1", bufferQuantity: 0, requestId: "rev-4" },
      db
    );
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    await decideOperatorReviewItem({ itemId: opened.item.items[0]!.id, action: "accept" }, db);
    await decideOperatorReviewItem(
      { itemId: opened.item.items[1]!.id, action: "reject", rejectionReason: "phone_quality" },
      db,
      { releaseAllocation: async () => ({ ok: true }) }
    );
    const filled = await fillOperatorReviewShortfall(
      { batchId: opened.item.id, requestId: "sup-1" },
      db,
      {
        reserveUnbilledCandidate: async () => ({
          ok: true,
          allocationId: "alloc_sup",
          inventoryItemId: "inv_sup",
        }),
      }
    );
    assert.equal(filled.ok, true);
    if (!filled.ok) return;
    assert.equal(filled.supplemental.billingStatus, "not_billed");
    assert.equal(filled.supplemental.selectedQuantity, 1);
    assert.equal(filled.item.items.some((row) => row.role === "supplemental"), true);
    assert.equal(filled.item.billedQuantity, null);
  });

  it("blocks export while review items are pending", async () => {
    process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED = "true";
    const db = reviewDb();
    const opened = await openOperatorReviewBatch(
      { orderId: "ord_1", bufferQuantity: 0, requestId: "rev-5" },
      db
    );
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const blocked = await assertOperatorReviewAllowsExport("ord_1", ["alloc_1", "alloc_2"], db);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "operator_review_pending");
  });

  it("stays inert when the feature flag is off", async () => {
    delete process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED;
    const opened = await openOperatorReviewBatch(
      { orderId: "ord_1", bufferQuantity: 1, requestId: "rev-off" },
      reviewDb()
    );
    assert.equal(opened.ok, false);
    if (!opened.ok) assert.equal(opened.code, "feature_disabled");
    const exportOk = await assertOperatorReviewAllowsExport("ord_1", ["alloc_1"], reviewDb());
    assert.equal(exportOk.ok, true);
  });

  it("requires an actionable rejection reason and does not default to operator_rejected", async () => {
    process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED = "true";
    const db = reviewDb();
    const opened = await openOperatorReviewBatch(
      { orderId: "ord_1", bufferQuantity: 0, requestId: "rev-reason" },
      db
    );
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const missing = await decideOperatorReviewItem(
      { itemId: opened.item.items[0]!.id, action: "reject" },
      db
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "invalid_rejection_reason");
    const generic = await decideOperatorReviewItem(
      {
        itemId: opened.item.items[0]!.id,
        action: "reject",
        rejectionReason: "operator_rejected",
      },
      db
    );
    assert.equal(generic.ok, false);
    if (!generic.ok) assert.equal(generic.code, "invalid_rejection_reason");
  });

  it("does not release inventory or change accepted counts when close reports shortfall_open", async () => {
    process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED = "true";
    const released: string[] = [];
    const db = reviewDb();
    const opened = await openOperatorReviewBatch(
      { orderId: "ord_1", bufferQuantity: 1, requestId: "rev-close-fail" },
      db,
      {
        reserveUnbilledCandidate: async () => ({
          ok: true,
          allocationId: "alloc_buf",
          inventoryItemId: "inv_buf",
        }),
      }
    );
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    await decideOperatorReviewItem({ itemId: opened.item.items[0]!.id, action: "accept" }, db);
    await decideOperatorReviewItem(
      {
        itemId: opened.item.items[1]!.id,
        action: "reject",
        rejectionReason: "phone_quality",
      },
      db,
      {
        releaseAllocation: async ({ allocationId }) => {
          released.push(allocationId);
          return { ok: true };
        },
      }
    );
    const afterReject = await decideOperatorReviewItem(
      { itemId: opened.item.items[0]!.id, action: "accept" },
      db
    );
    assert.equal(afterReject.ok, true);
    if (!afterReject.ok) return;
    const acceptedBeforeClose = afterReject.batch.acceptedCount;
    const beforeRelease = released.length;
    const closed = await closeOperatorReviewBatch(
      {
        batchId: opened.item.id,
        confirmationPhrase: OPERATOR_REVIEW_CLOSE_PHRASE,
        allowShortfall: false,
      },
      db,
      {
        releaseAllocation: async ({ allocationId }) => {
          released.push(allocationId);
          return { ok: true };
        },
      }
    );
    assert.equal(closed.ok, false);
    if (!closed.ok) assert.equal(closed.code, "shortfall_open");
    assert.equal(released.length, beforeRelease);
    const stillOpen = await closeOperatorReviewBatch(
      {
        batchId: opened.item.id,
        confirmationPhrase: "WRONG PHRASE",
      },
      db
    );
    assert.equal(stillOpen.ok, false);
    assert.equal(afterReject.batch.status, "open");
    assert.equal(acceptedBeforeClose, 1);
    const replay = await decideOperatorReviewItem(
      { itemId: opened.item.items[0]!.id, action: "accept" },
      db
    );
    assert.equal(replay.ok, true);
    if (!replay.ok) return;
    assert.equal(replay.batch.status, "open");
    assert.equal(replay.batch.acceptedCount, acceptedBeforeClose);
  });

  it("treats a second decide on the same item as an idempotent replay", async () => {
    process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED = "true";
    const db = reviewDb();
    const opened = await openOperatorReviewBatch(
      { orderId: "ord_1", bufferQuantity: 0, requestId: "rev-idemp" },
      db
    );
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const first = await decideOperatorReviewItem(
      { itemId: opened.item.items[0]!.id, action: "accept" },
      db
    );
    const second = await decideOperatorReviewItem(
      { itemId: opened.item.items[0]!.id, action: "reject", rejectionReason: "phone_quality" },
      db
    );
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(second.item.status, "accepted");
    assert.equal(second.batch.acceptedCount, 1);
    assert.equal(second.batch.rejectedCount, 0);
  });

  it("rejects a second open batch while one remains open", async () => {
    process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED = "true";
    const db = reviewDb();
    const first = await openOperatorReviewBatch(
      { orderId: "ord_1", bufferQuantity: 0, requestId: "rev-open-a" },
      db
    );
    assert.equal(first.ok, true);
    const second = await openOperatorReviewBatch(
      { orderId: "ord_1", bufferQuantity: 0, requestId: "rev-open-b" },
      db
    );
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "open_batch_exists");
  });

  it("rolls back reserved supplementals after a failed reservation and retries cleanly", async () => {
    process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED = "true";
    const released: string[] = [];
    const db = reviewDb();
    const opened = await openOperatorReviewBatch(
      { orderId: "ord_1", bufferQuantity: 0, requestId: "rev-retry" },
      db
    );
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    await decideOperatorReviewItem({ itemId: opened.item.items[0]!.id, action: "accept" }, db);
    await decideOperatorReviewItem(
      {
        itemId: opened.item.items[1]!.id,
        action: "reject",
        rejectionReason: "name_quality",
      },
      db,
      { releaseAllocation: async () => ({ ok: true }) }
    );
    let attempts = 0;
    const failed = await fillOperatorReviewShortfall(
      { batchId: opened.item.id, requestId: "sup-fail" },
      db,
      {
        reserveUnbilledCandidate: async () => {
          attempts += 1;
          return { ok: false, code: "shortage", reasons: ["eligible_inventory_shortage"] };
        },
        releaseAllocation: async ({ allocationId }) => {
          released.push(allocationId);
          return { ok: true };
        },
      }
    );
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.equal(failed.code, "buffer_reserve_failed");
    const retry = await fillOperatorReviewShortfall(
      { batchId: opened.item.id, requestId: "sup-retry" },
      db,
      {
        reserveUnbilledCandidate: async () => ({
          ok: true,
          allocationId: "alloc_sup_retry",
          inventoryItemId: "inv_sup_retry",
        }),
      }
    );
    assert.equal(retry.ok, true);
    if (!retry.ok) return;
    assert.equal(retry.idempotentReplay, false);
    assert.deepEqual(retry.supplemental.allocationIds, ["alloc_sup_retry"]);
    assert.equal(attempts, 1);
  });

  it("downloads only accepted supplemental allocations linked to the original order", async () => {
    process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED = "true";
    const db = reviewDb();
    const opened = await openOperatorReviewBatch(
      { orderId: "ord_1", bufferQuantity: 0, requestId: "rev-dl" },
      db
    );
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    await decideOperatorReviewItem({ itemId: opened.item.items[0]!.id, action: "accept" }, db);
    await decideOperatorReviewItem(
      {
        itemId: opened.item.items[1]!.id,
        action: "reject",
        rejectionReason: "duplicate",
      },
      db,
      { releaseAllocation: async () => ({ ok: true }) }
    );
    const filled = await fillOperatorReviewShortfall(
      { batchId: opened.item.id, requestId: "sup-dl" },
      db,
      {
        reserveUnbilledCandidate: async () => ({
          ok: true,
          allocationId: "alloc_sup",
          inventoryItemId: "inv_sup",
        }),
      }
    );
    assert.equal(filled.ok, true);
    if (!filled.ok) return;
    assert.equal(
      filled.item.items.length,
      3,
      JSON.stringify(filled.item.items.map((row) => ({ id: row.id, role: row.role, status: row.status })))
    );
    const pendingDownload = await downloadOperatorSupplementalExport(
      { supplementalId: filled.supplemental.id },
      db
    );
    assert.equal(pendingDownload.ok, false);
    const supplementalItem = filled.item.items.find(
      (row) => row.role === "supplemental" && row.status === "pending_review"
    );
    assert.ok(
      supplementalItem,
      JSON.stringify(filled.item.items.map((row) => ({ id: row.id, role: row.role, status: row.status })))
    );
    const acceptedSupplemental = await decideOperatorReviewItem(
      { itemId: supplementalItem!.id, action: "accept" },
      db
    );
    assert.equal(acceptedSupplemental.ok, true, JSON.stringify(acceptedSupplemental));
    if (!acceptedSupplemental.ok) return;
    assert.equal(
      acceptedSupplemental.item.status,
      "accepted",
      JSON.stringify({
        decidedId: supplementalItem!.id,
        resultId: acceptedSupplemental.item.id,
        resultRole: acceptedSupplemental.item.role,
        items: acceptedSupplemental.batch.items.map((row) => ({
          id: row.id,
          role: row.role,
          status: row.status,
        })),
      })
    );
    assert.equal(acceptedSupplemental.item.role, "supplemental");
    const downloaded = await downloadOperatorSupplementalExport(
      { supplementalId: filled.supplemental.id },
      db
    );
    assert.equal(downloaded.ok, true, JSON.stringify(downloaded));
    if (!downloaded.ok) return;
    assert.equal(downloaded.leadOrderId, "ord_1");
    assert.deepEqual(downloaded.allocationIds, ["alloc_sup"]);
    assert.match(downloaded.csv, /"\+12025550100"/);
    assert.equal(downloaded.rowCount, 1);
  });

  it("paginates review items and reconciles accepted/reserved/unused/purchased counts", async () => {
    process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED = "true";
    const db = reviewDb();
    const opened = await openOperatorReviewBatch(
      { orderId: "ord_1", bufferQuantity: 1, requestId: "rev-page" },
      db,
      {
        reserveUnbilledCandidate: async () => ({
          ok: true,
          allocationId: "alloc_buf",
          inventoryItemId: "inv_buf",
        }),
      }
    );
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const page1 = paginateOperatorReviewItems(opened.item.items, { page: 1, pageSize: 2 });
    assert.equal(page1.items.length, 2);
    assert.equal(page1.pageCount, 2);
    assert.equal(page1.total, 3);
    const search = paginateOperatorReviewItems(opened.item.items, { query: "buffer" });
    assert.equal(search.total, 1);
    const reconciled = reconcileOperatorReviewQuantities(opened.item);
    assert.equal(reconciled.ok, true);
    assert.equal(reconciled.purchasedQuantity, 2);
    assert.equal(reconciled.pendingCount, 3);
    assert.equal(reconciled.shortfallCount, 2);
  });
});
