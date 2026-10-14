import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  selectAndReservePplReplacementCandidate,
  releasePplAllocation,
} from "./inventory-selection.service.js";
import {
  evaluatePplNameReviewFlags,
  readPplBuyerReadyNames,
} from "./ppl-buyer-ready-eligibility.js";
import { presentBuyerCsvCustomerPackage } from "./buyer-csv-customer-presentation.js";
import { createHash } from "node:crypto";

export const OPERATOR_REVIEW_CLOSE_PHRASE = "CLOSE REVIEW BATCH";
export const OPERATOR_REVIEW_BILLING_STATUS = "not_billed";

export const REVIEW_BATCH_OPEN = "open";
export const REVIEW_BATCH_CLOSED = "closed";
export const REVIEW_BATCH_CANCELED = "canceled";

export const REVIEW_ITEM_PENDING = "pending_review";
export const REVIEW_ITEM_ACCEPTED = "accepted";
export const REVIEW_ITEM_REJECTED = "rejected";
export const REVIEW_ITEM_UNUSED = "unused";

export const REVIEW_ROLE_PRIMARY = "primary";
export const REVIEW_ROLE_BUFFER = "buffer";
export const REVIEW_ROLE_SUPPLEMENTAL = "supplemental";

export const OPERATOR_REVIEW_PAGE_SIZE = 25;

/** Actionable structured rejection codes. Empty / operator_rejected is not accepted. */
export const OPERATOR_REJECTION_REASON_CODES = [
  "phone_quality",
  "name_quality",
  "placeholder_identity",
  "duplicate",
  "wrong_demographic",
  "structurally_invalid",
] as const;

export type OperatorRejectionReasonCode = (typeof OPERATOR_REJECTION_REASON_CODES)[number];

export function isOperatorRejectionReasonCode(
  value: string | null | undefined
): value is OperatorRejectionReasonCode {
  return (
    typeof value === "string" &&
    (OPERATOR_REJECTION_REASON_CODES as readonly string[]).includes(value.trim())
  );
}

export function isPplOperatorReviewEnabled(): boolean {
  return process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED === "true";
}

export type OperatorReviewItemView = {
  id: string;
  batchId: string;
  allocationId: string;
  inventoryItemId: string | null;
  sourceLeadEventId: string;
  role: string;
  status: string;
  rejectionReason: string | null;
  reviewFlags: string[];
  decidedBy: string | null;
  decidedAt: Date | null;
};

export type OperatorReviewBatchView = {
  id: string;
  leadOrderId: string;
  clientAccountId: string;
  status: string;
  purchasedQuantity: number;
  bufferQuantity: number;
  acceptedCount: number;
  rejectedCount: number;
  unusedBufferCount: number;
  shortfallCount: number;
  billedQuantity: number | null;
  billingStatus: typeof OPERATOR_REVIEW_BILLING_STATUS;
  requestId: string;
  createdBy: string | null;
  createdAt: Date;
  items: OperatorReviewItemView[];
  rejectionReport: OperatorRejectionReport;
};

export type OperatorRejectionReport = {
  purchasedQuantity: number;
  acceptedCount: number;
  rejectedCount: number;
  unusedBufferCount: number;
  shortfallCount: number;
  billedQuantity: null;
  billingNote: string;
  rejectionReasons: Record<string, number>;
};

export type PplSupplementalExportView = {
  id: string;
  batchId: string;
  leadOrderId: string;
  exportPackageId: string | null;
  shortfallQuantity: number;
  selectedQuantity: number;
  status: string;
  billingStatus: string;
  requestId: string;
  allocationIds: string[];
};

export type OperatorReviewReserveCandidate = (
  input: {
    orderId: string;
    idempotencyKey: string;
    capacityMode?: "billable_replacement" | "unbilled_review";
  },
  db?: PrismaClient
) => Promise<
  | { ok: true; allocationId: string; inventoryItemId: string }
  | { ok: false; code: string; reasons?: string[] }
>;

export type OperatorReviewReleaseAllocation = (
  input: { allocationId: string; reason: string },
  db?: PrismaClient
) => Promise<{ ok: true } | { ok: false; code: string }>;

export type OperatorReviewDeps = {
  reserveUnbilledCandidate?: OperatorReviewReserveCandidate;
  releaseAllocation?: OperatorReviewReleaseAllocation;
};

const BILLING_NOTE =
  "Unused buffers and supplemental replacements are never auto-billed. Record billing by hand.";

function presentItem(row: {
  id: string;
  batchId: string;
  allocationId: string;
  inventoryItemId: string | null;
  sourceLeadEventId: string;
  role: string;
  status: string;
  rejectionReason: string | null;
  reviewFlagsJson: Prisma.JsonValue | null;
  decidedBy: string | null;
  decidedAt: Date | null;
}): OperatorReviewItemView {
  return {
    id: row.id,
    batchId: row.batchId,
    allocationId: row.allocationId,
    inventoryItemId: row.inventoryItemId,
    sourceLeadEventId: row.sourceLeadEventId,
    role: row.role,
    status: row.status,
    rejectionReason: row.rejectionReason,
    reviewFlags: Array.isArray(row.reviewFlagsJson)
      ? row.reviewFlagsJson.filter((flag): flag is string => typeof flag === "string")
      : [],
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
  };
}

function rejectionReport(
  batch: {
    purchasedQuantity: number;
    acceptedCount: number;
    rejectedCount: number;
    unusedBufferCount: number;
    shortfallCount: number;
  },
  items: Array<{ status: string; rejectionReason: string | null }>
): OperatorRejectionReport {
  const rejectionReasons: Record<string, number> = {};
  for (const item of items) {
    if (item.status !== REVIEW_ITEM_REJECTED) continue;
    const reason = item.rejectionReason?.trim() || "unspecified";
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
  }
  return {
    purchasedQuantity: batch.purchasedQuantity,
    acceptedCount: batch.acceptedCount,
    rejectedCount: batch.rejectedCount,
    unusedBufferCount: batch.unusedBufferCount,
    shortfallCount: batch.shortfallCount,
    billedQuantity: null,
    billingNote: BILLING_NOTE,
    rejectionReasons,
  };
}

function presentBatch(
  batch: {
    id: string;
    leadOrderId: string;
    clientAccountId: string;
    status: string;
    purchasedQuantity: number;
    bufferQuantity: number;
    acceptedCount: number;
    rejectedCount: number;
    unusedBufferCount: number;
    shortfallCount: number;
    billedQuantity: number | null;
    requestId: string;
    createdBy: string | null;
    createdAt: Date;
    items: Array<{
      id: string;
      batchId: string;
      allocationId: string;
      inventoryItemId: string | null;
      sourceLeadEventId: string;
      role: string;
      status: string;
      rejectionReason: string | null;
      reviewFlagsJson: Prisma.JsonValue | null;
      decidedBy: string | null;
      decidedAt: Date | null;
    }>;
  }
): OperatorReviewBatchView {
  const items = batch.items.map(presentItem);
  return {
    id: batch.id,
    leadOrderId: batch.leadOrderId,
    clientAccountId: batch.clientAccountId,
    status: batch.status,
    purchasedQuantity: batch.purchasedQuantity,
    bufferQuantity: batch.bufferQuantity,
    acceptedCount: batch.acceptedCount,
    rejectedCount: batch.rejectedCount,
    unusedBufferCount: batch.unusedBufferCount,
    shortfallCount: batch.shortfallCount,
    billedQuantity: batch.billedQuantity,
    billingStatus: OPERATOR_REVIEW_BILLING_STATUS,
    requestId: batch.requestId,
    createdBy: batch.createdBy,
    createdAt: batch.createdAt,
    items,
    rejectionReport: rejectionReport(batch, batch.items),
  };
}

export function reviewFlagsForIdentity(normalizedPayloadJson: unknown): string[] {
  const names = readPplBuyerReadyNames(normalizedPayloadJson);
  return evaluatePplNameReviewFlags(names.firstName, names.lastName);
}

export function paginateOperatorReviewItems<T extends OperatorReviewItemView>(
  items: T[],
  input: { page?: number; query?: string; pageSize?: number } = {}
): { items: T[]; page: number; pageCount: number; total: number } {
  const query = input.query?.trim().toLowerCase() ?? "";
  const filtered = query
    ? items.filter((item) => {
        const haystack = [
          item.allocationId,
          item.role,
          item.status,
          item.rejectionReason ?? "",
          ...item.reviewFlags,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
    : items;
  const pageSize = Math.max(1, input.pageSize ?? OPERATOR_REVIEW_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, input.page ?? 1), pageCount);
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    page,
    pageCount,
    total: filtered.length,
  };
}

export function reconcileOperatorReviewQuantities(batch: OperatorReviewBatchView): {
  ok: boolean;
  purchasedQuantity: number;
  acceptedCount: number;
  rejectedCount: number;
  unusedBufferCount: number;
  pendingCount: number;
  shortfallCount: number;
  itemTotal: number;
} {
  const acceptedCount = batch.items.filter((item) => item.status === REVIEW_ITEM_ACCEPTED).length;
  const rejectedCount = batch.items.filter((item) => item.status === REVIEW_ITEM_REJECTED).length;
  const unusedBufferCount = batch.items.filter((item) => item.status === REVIEW_ITEM_UNUSED).length;
  const pendingCount = batch.items.filter((item) => item.status === REVIEW_ITEM_PENDING).length;
  const shortfallCount = Math.max(0, batch.purchasedQuantity - acceptedCount);
  const itemTotal = acceptedCount + rejectedCount + unusedBufferCount + pendingCount;
  const ok =
    acceptedCount === batch.acceptedCount &&
    rejectedCount === batch.rejectedCount &&
    unusedBufferCount === batch.unusedBufferCount &&
    (batch.status !== REVIEW_BATCH_CLOSED || batch.shortfallCount === shortfallCount) &&
    itemTotal === batch.items.length &&
    batch.billedQuantity == null &&
    batch.purchasedQuantity === batch.rejectionReport.purchasedQuantity;
  return {
    ok,
    purchasedQuantity: batch.purchasedQuantity,
    acceptedCount,
    rejectedCount,
    unusedBufferCount,
    pendingCount,
    shortfallCount,
    itemTotal,
  };
}

function readAllocationIdsJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
}

function presentSupplemental(row: {
  id: string;
  batchId: string;
  leadOrderId: string;
  exportPackageId: string | null;
  shortfallQuantity: number;
  selectedQuantity: number;
  status: string;
  billingStatus: string;
  requestId: string;
  allocationIdsJson?: Prisma.JsonValue;
}): PplSupplementalExportView {
  return {
    id: row.id,
    batchId: row.batchId,
    leadOrderId: row.leadOrderId,
    exportPackageId: row.exportPackageId,
    shortfallQuantity: row.shortfallQuantity,
    selectedQuantity: row.selectedQuantity,
    status: row.status,
    billingStatus: row.billingStatus,
    requestId: row.requestId,
    allocationIds: readAllocationIdsJson(row.allocationIdsJson),
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
  );
}

async function runInTransaction<T>(
  db: PrismaClient,
  work: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  const txCapable = db as PrismaClient & {
    $transaction?: (fn: (tx: PrismaClient) => Promise<T>) => Promise<T>;
  };
  if (typeof txCapable.$transaction === "function") {
    return txCapable.$transaction((tx) => work(tx as PrismaClient));
  }
  return work(db);
}

function defaultReserve(): OperatorReviewReserveCandidate {
  return async (input, db) => {
    const result = await selectAndReservePplReplacementCandidate(
      {
        orderId: input.orderId,
        idempotencyKey: input.idempotencyKey,
        capacityMode: input.capacityMode ?? "unbilled_review",
      },
      db
    );
    if (!result.ok) return result;
    return {
      ok: true,
      allocationId: result.allocationId,
      inventoryItemId: result.inventoryItemId,
    };
  };
}

async function decrementReviewAllowance(orderId: string, db: PrismaClient): Promise<void> {
  await db.$executeRaw`
    UPDATE "LeadOrder"
    SET
      "reviewCapacityAllowance" = GREATEST("reviewCapacityAllowance" - 1, 0),
      "updatedAt" = NOW()
    WHERE id = ${orderId}
  `;
}

async function loadBatch(
  batchId: string,
  db: PrismaClient
) {
  return db.pplOperatorReviewBatch.findUnique({
    where: { id: batchId.trim() },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
}

export async function listOperatorReviewBatches(
  orderId: string,
  db: PrismaClient = prisma
): Promise<OperatorReviewBatchView[]> {
  const rows = await db.pplOperatorReviewBatch.findMany({
    where: { leadOrderId: orderId.trim() },
    include: { items: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(presentBatch);
}

export async function openOperatorReviewBatch(
  input: {
    orderId: string;
    bufferQuantity: number;
    requestId: string;
    createdBy?: string | null;
  },
  db: PrismaClient = prisma,
  deps: OperatorReviewDeps = {}
): Promise<
  | { ok: true; item: OperatorReviewBatchView; idempotentReplay: boolean }
  | {
      ok: false;
      code:
        | "feature_disabled"
        | "invalid_buffer_quantity"
        | "order_not_found"
        | "order_not_active"
        | "insufficient_reserved"
        | "open_batch_exists"
        | "buffer_reserve_failed";
      reasons?: string[];
    }
> {
  if (!isPplOperatorReviewEnabled()) return { ok: false, code: "feature_disabled" };

  const bufferQuantity = input.bufferQuantity;
  if (!Number.isInteger(bufferQuantity) || bufferQuantity < 0 || bufferQuantity > 500) {
    return { ok: false, code: "invalid_buffer_quantity" };
  }

  const requestId = input.requestId.trim();
  const existing = await db.pplOperatorReviewBatch.findUnique({
    where: { requestId },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  if (existing) {
    return { ok: true, item: presentBatch(existing), idempotentReplay: true };
  }

  const order = await db.leadOrder.findUnique({
    where: { id: input.orderId.trim() },
    select: {
      id: true,
      clientAccountId: true,
      status: true,
      requestedQuantity: true,
      leadVolume: true,
      canceledAt: true,
      completedAt: true,
      pausedAt: true,
    },
  });
  if (!order) return { ok: false, code: "order_not_found" };
  if (order.status !== "active" || order.canceledAt || order.completedAt || order.pausedAt) {
    return { ok: false, code: "order_not_active" };
  }

  const open = await db.pplOperatorReviewBatch.findFirst({
    where: { leadOrderId: order.id, status: REVIEW_BATCH_OPEN },
    select: { id: true },
  });
  if (open) return { ok: false, code: "open_batch_exists" };

  const purchasedQuantity = order.requestedQuantity ?? order.leadVolume;
  const reserved = await db.leadAllocation.findMany({
    where: { leadOrderId: order.id, status: "reserved" },
    select: {
      id: true,
      leadInventoryItemId: true,
      sourceLeadEventId: true,
      sourceLeadEvent: { select: { normalizedPayloadJson: true } },
    },
    orderBy: [{ reservedAt: "asc" }, { id: "asc" }],
  });
  if (reserved.length < purchasedQuantity) {
    return { ok: false, code: "insufficient_reserved" };
  }

  const reserve = deps.reserveUnbilledCandidate ?? defaultReserve();
  const release = deps.releaseAllocation ?? releasePplAllocation;
  const extrasNeeded = Math.max(0, purchasedQuantity + bufferQuantity - reserved.length);
  const extraAllocations: typeof reserved = [];
  for (let i = 0; i < extrasNeeded; i += 1) {
    const reservedResult = await reserve(
      {
        orderId: order.id,
        idempotencyKey: `${requestId}:buffer:${i}`,
        capacityMode: "unbilled_review",
      },
      db
    );
    if (!reservedResult.ok) {
      for (const extra of extraAllocations) {
        await release({ allocationId: extra.id, reason: "operator_review_open_rollback" }, db);
      }
      return {
        ok: false,
        code: "buffer_reserve_failed",
        reasons: reservedResult.reasons ?? [reservedResult.code],
      };
    }
    extraAllocations.push({
      id: reservedResult.allocationId,
      leadInventoryItemId: reservedResult.inventoryItemId,
      sourceLeadEventId: "",
      sourceLeadEvent: { normalizedPayloadJson: null },
    });
  }

  const extraRows =
    extraAllocations.length === 0
      ? []
      : await db.leadAllocation.findMany({
          where: { id: { in: extraAllocations.map((row) => row.id) } },
          select: {
            id: true,
            leadInventoryItemId: true,
            sourceLeadEventId: true,
            sourceLeadEvent: { select: { normalizedPayloadJson: true } },
          },
        });

  const allReserved = [...reserved, ...extraRows.filter((row) => !reserved.some((r) => r.id === row.id))];
  const primaries = allReserved.slice(0, purchasedQuantity);
  const buffers = allReserved.slice(purchasedQuantity, purchasedQuantity + bufferQuantity);

  try {
    const created = await db.pplOperatorReviewBatch.create({
      data: {
        leadOrderId: order.id,
        clientAccountId: order.clientAccountId,
        status: REVIEW_BATCH_OPEN,
        purchasedQuantity,
        bufferQuantity,
        requestId,
        createdBy: input.createdBy?.trim() || null,
        items: {
          create: [
            ...primaries.map((row) => ({
              allocationId: row.id,
              inventoryItemId: row.leadInventoryItemId,
              sourceLeadEventId: row.sourceLeadEventId,
              role: REVIEW_ROLE_PRIMARY,
              status: REVIEW_ITEM_PENDING,
              reviewFlagsJson: reviewFlagsForIdentity(row.sourceLeadEvent.normalizedPayloadJson),
            })),
            ...buffers.map((row) => ({
              allocationId: row.id,
              inventoryItemId: row.leadInventoryItemId,
              sourceLeadEventId: row.sourceLeadEventId,
              role: REVIEW_ROLE_BUFFER,
              status: REVIEW_ITEM_PENDING,
              reviewFlagsJson: reviewFlagsForIdentity(row.sourceLeadEvent.normalizedPayloadJson),
            })),
          ],
        },
      },
      include: { items: { orderBy: { createdAt: "asc" } } },
    });
    return { ok: true, item: presentBatch(created), idempotentReplay: false };
  } catch (error) {
    for (const extra of extraAllocations) {
      await release({ allocationId: extra.id, reason: "operator_review_open_rollback" }, db);
    }
    if (isUniqueConstraintError(error)) {
      const replay = await db.pplOperatorReviewBatch.findUnique({
        where: { requestId },
        include: { items: { orderBy: { createdAt: "asc" } } },
      });
      if (replay) return { ok: true, item: presentBatch(replay), idempotentReplay: true };
      return { ok: false, code: "open_batch_exists" };
    }
    throw error;
  }
}

export async function decideOperatorReviewItem(
  input: {
    itemId: string;
    action: "accept" | "reject" | "unused";
    rejectionReason?: string | null;
    decidedBy?: string | null;
  },
  db: PrismaClient = prisma,
  deps: OperatorReviewDeps = {}
): Promise<
  | { ok: true; item: OperatorReviewItemView; batch: OperatorReviewBatchView }
  | {
      ok: false;
      code:
        | "feature_disabled"
        | "item_not_found"
        | "invalid_status"
        | "invalid_action"
        | "invalid_rejection_reason"
        | "release_failed";
    }
> {
  if (!isPplOperatorReviewEnabled()) return { ok: false, code: "feature_disabled" };

  return runInTransaction(db, async (tx) => {
    const item = await tx.pplOperatorReviewItem.findUnique({
      where: { id: input.itemId.trim() },
      include: { batch: true },
    });
    if (!item) return { ok: false, code: "item_not_found" };
    if (item.batch.status !== REVIEW_BATCH_OPEN) return { ok: false, code: "invalid_status" };
    if (item.status !== REVIEW_ITEM_PENDING) {
      const batch = await loadBatch(item.batchId, tx);
      if (!batch) return { ok: false, code: "item_not_found" };
      return { ok: true, item: presentItem(item), batch: presentBatch(batch) };
    }

    if (input.action === "unused" && item.role === REVIEW_ROLE_PRIMARY) {
      return { ok: false, code: "invalid_action" };
    }

    const now = new Date();
    let nextStatus = REVIEW_ITEM_ACCEPTED;
    if (input.action === "reject") nextStatus = REVIEW_ITEM_REJECTED;
    if (input.action === "unused") nextStatus = REVIEW_ITEM_UNUSED;

    if (nextStatus === REVIEW_ITEM_REJECTED && !isOperatorRejectionReasonCode(input.rejectionReason)) {
      return { ok: false, code: "invalid_rejection_reason" };
    }

    if (nextStatus === REVIEW_ITEM_REJECTED || nextStatus === REVIEW_ITEM_UNUSED) {
      const release = deps.releaseAllocation ?? releasePplAllocation;
      const released = await release(
        { allocationId: item.allocationId, reason: `operator_review_${nextStatus}` },
        tx
      );
      if (!released.ok) return { ok: false, code: "release_failed" };
      if (item.role !== REVIEW_ROLE_PRIMARY) {
        await decrementReviewAllowance(item.batch.leadOrderId, tx);
      }
    }

    await tx.pplOperatorReviewItem.update({
      where: { id: item.id },
      data: {
        status: nextStatus,
        rejectionReason:
          nextStatus === REVIEW_ITEM_REJECTED
            ? input.rejectionReason!.trim()
            : null,
        decidedBy: input.decidedBy?.trim() || null,
        decidedAt: now,
      },
    });

    const acceptedDelta = nextStatus === REVIEW_ITEM_ACCEPTED ? 1 : 0;
    const rejectedDelta = nextStatus === REVIEW_ITEM_REJECTED ? 1 : 0;
    const unusedDelta = nextStatus === REVIEW_ITEM_UNUSED ? 1 : 0;
    await tx.pplOperatorReviewBatch.update({
      where: { id: item.batchId },
      data: {
        acceptedCount: { increment: acceptedDelta },
        rejectedCount: { increment: rejectedDelta },
        unusedBufferCount: { increment: unusedDelta },
      },
    });

    const batch = await loadBatch(item.batchId, tx);
    if (!batch) return { ok: false, code: "item_not_found" };
    const updatedItem = batch.items.find((row) => row.id === item.id);
    if (!updatedItem) return { ok: false, code: "item_not_found" };
    return { ok: true, item: presentItem(updatedItem), batch: presentBatch(batch) };
  });
}

export async function closeOperatorReviewBatch(
  input: {
    batchId: string;
    confirmationPhrase: string;
    allowShortfall?: boolean;
    decidedBy?: string | null;
  },
  db: PrismaClient = prisma,
  deps: OperatorReviewDeps = {}
): Promise<
  | { ok: true; item: OperatorReviewBatchView }
  | {
      ok: false;
      code:
        | "feature_disabled"
        | "batch_not_found"
        | "invalid_status"
        | "confirmation_required"
        | "pending_review_items"
        | "shortfall_open"
        | "release_failed";
    }
> {
  if (!isPplOperatorReviewEnabled()) return { ok: false, code: "feature_disabled" };
  if (input.confirmationPhrase.trim() !== OPERATOR_REVIEW_CLOSE_PHRASE) {
    return { ok: false, code: "confirmation_required" };
  }

  const batch = await loadBatch(input.batchId, db);
  if (!batch) return { ok: false, code: "batch_not_found" };
  if (batch.status === REVIEW_BATCH_CLOSED) {
    return { ok: true, item: presentBatch(batch) };
  }
  if (batch.status !== REVIEW_BATCH_OPEN) return { ok: false, code: "invalid_status" };

  return runInTransaction(db, async (tx) => {
    const latest = await loadBatch(batch.id, tx);
    if (!latest) return { ok: false, code: "batch_not_found" };
    if (latest.status === REVIEW_BATCH_CLOSED) {
      return { ok: true, item: presentBatch(latest) };
    }
    if (latest.status !== REVIEW_BATCH_OPEN) return { ok: false, code: "invalid_status" };

    const pendingPrimaries = latest.items.filter(
      (item) => item.status === REVIEW_ITEM_PENDING && item.role === REVIEW_ROLE_PRIMARY
    );
    if (pendingPrimaries.length > 0) {
      return { ok: false, code: "pending_review_items" };
    }

    const acceptedCount = latest.items.filter((item) => item.status === REVIEW_ITEM_ACCEPTED).length;
    const shortfallCount = Math.max(0, latest.purchasedQuantity - acceptedCount);
    if (shortfallCount > 0 && !input.allowShortfall) {
      return { ok: false, code: "shortfall_open" };
    }

    const pendingExtras = latest.items.filter(
      (item) =>
        item.status === REVIEW_ITEM_PENDING &&
        (item.role === REVIEW_ROLE_BUFFER || item.role === REVIEW_ROLE_SUPPLEMENTAL)
    );
    const release = deps.releaseAllocation ?? releasePplAllocation;
    for (const extra of pendingExtras) {
      const released = await release(
        { allocationId: extra.allocationId, reason: "operator_review_unused" },
        tx
      );
      if (!released.ok) return { ok: false, code: "release_failed" };
      await decrementReviewAllowance(latest.leadOrderId, tx);
      await tx.pplOperatorReviewItem.update({
        where: { id: extra.id },
        data: {
          status: REVIEW_ITEM_UNUSED,
          decidedBy: input.decidedBy?.trim() || null,
          decidedAt: new Date(),
        },
      });
    }

    const after = await loadBatch(latest.id, tx);
    if (!after) return { ok: false, code: "batch_not_found" };
    const closedAccepted = after.items.filter((item) => item.status === REVIEW_ITEM_ACCEPTED).length;
    const closedRejected = after.items.filter((item) => item.status === REVIEW_ITEM_REJECTED).length;
    const closedUnused = after.items.filter((item) => item.status === REVIEW_ITEM_UNUSED).length;
    const closedShortfall = Math.max(0, after.purchasedQuantity - closedAccepted);

    const closed = await tx.pplOperatorReviewBatch.update({
      where: { id: latest.id },
      data: {
        status: REVIEW_BATCH_CLOSED,
        acceptedCount: closedAccepted,
        rejectedCount: closedRejected,
        unusedBufferCount: closedUnused,
        shortfallCount: closedShortfall,
        billedQuantity: null,
      },
      include: { items: { orderBy: { createdAt: "asc" } } },
    });

    return { ok: true, item: presentBatch(closed) };
  });
}

export async function fillOperatorReviewShortfall(
  input: {
    batchId: string;
    requestId: string;
    createdBy?: string | null;
  },
  db: PrismaClient = prisma,
  deps: OperatorReviewDeps = {}
): Promise<
  | { ok: true; item: OperatorReviewBatchView; supplemental: PplSupplementalExportView; idempotentReplay: boolean }
  | {
      ok: false;
      code:
        | "feature_disabled"
        | "batch_not_found"
        | "invalid_status"
        | "no_shortfall"
        | "pending_review_items"
        | "buffer_reserve_failed";
      reasons?: string[];
    }
> {
  if (!isPplOperatorReviewEnabled()) return { ok: false, code: "feature_disabled" };

  const existing = await db.pplSupplementalExport.findUnique({
    where: { requestId: input.requestId.trim() },
  });
  if (existing) {
    const batch = await loadBatch(existing.batchId, db);
    if (!batch) return { ok: false, code: "batch_not_found" };
    return {
      ok: true,
      item: presentBatch(batch),
      supplemental: presentSupplemental(existing),
      idempotentReplay: true,
    };
  }

  const batch = await loadBatch(input.batchId, db);
  if (!batch) return { ok: false, code: "batch_not_found" };
  if (batch.status !== REVIEW_BATCH_OPEN) return { ok: false, code: "invalid_status" };
  if (batch.items.some((item) => item.status === REVIEW_ITEM_PENDING)) {
    return { ok: false, code: "pending_review_items" };
  }

  const acceptedCount = batch.items.filter((item) => item.status === REVIEW_ITEM_ACCEPTED).length;
  const shortfall = Math.max(0, batch.purchasedQuantity - acceptedCount);
  if (shortfall === 0) return { ok: false, code: "no_shortfall" };

  const reserve = deps.reserveUnbilledCandidate ?? defaultReserve();
  const release = deps.releaseAllocation ?? releasePplAllocation;
  const reservedIds: string[] = [];
  for (let i = 0; i < shortfall; i += 1) {
    const reservedResult = await reserve(
      {
        orderId: batch.leadOrderId,
        idempotencyKey: `${input.requestId.trim()}:supplemental:${i}`,
        capacityMode: "unbilled_review",
      },
      db
    );
    if (!reservedResult.ok) {
      for (const allocationId of reservedIds) {
        await release({ allocationId, reason: "operator_review_shortfall_rollback" }, db);
      }
      return {
        ok: false,
        code: "buffer_reserve_failed",
        reasons: reservedResult.reasons ?? [reservedResult.code],
      };
    }
    reservedIds.push(reservedResult.allocationId);
  }

  const allocations = await db.leadAllocation.findMany({
    where: { id: { in: reservedIds } },
    select: {
      id: true,
      leadInventoryItemId: true,
      sourceLeadEventId: true,
      sourceLeadEvent: { select: { normalizedPayloadJson: true } },
    },
  });

  await db.pplOperatorReviewItem.createMany({
    data: allocations.map((row) => ({
      batchId: batch.id,
      allocationId: row.id,
      inventoryItemId: row.leadInventoryItemId,
      sourceLeadEventId: row.sourceLeadEventId,
      role: REVIEW_ROLE_SUPPLEMENTAL,
      status: REVIEW_ITEM_PENDING,
      reviewFlagsJson: reviewFlagsForIdentity(row.sourceLeadEvent.normalizedPayloadJson),
    })),
  });

  const supplemental = await db.pplSupplementalExport.create({
    data: {
      batchId: batch.id,
      leadOrderId: batch.leadOrderId,
      shortfallQuantity: shortfall,
      selectedQuantity: allocations.length,
      status: "reserved",
      billingStatus: OPERATOR_REVIEW_BILLING_STATUS,
      allocationIdsJson: reservedIds,
      requestId: input.requestId.trim(),
      createdBy: input.createdBy?.trim() || null,
    },
  });

  const updated = await loadBatch(batch.id, db);
  if (!updated) return { ok: false, code: "batch_not_found" };
  return {
    ok: true,
    item: presentBatch(updated),
    supplemental: presentSupplemental(supplemental),
    idempotentReplay: false,
  };
}

/**
 * When the review flag is on, export may include only accepted review items.
 * Pending review blocks preview/commit so unreviewed leads never ship.
 */
export async function assertOperatorReviewAllowsExport(
  orderId: string,
  allocationIds: string[],
  db: PrismaClient = prisma
): Promise<
  | { ok: true; exportableAllocationIds: string[] }
  | { ok: false; code: "operator_review_pending" | "operator_review_rejected_allocation" }
> {
  if (!isPplOperatorReviewEnabled()) {
    return { ok: true, exportableAllocationIds: allocationIds };
  }

  const items = await db.pplOperatorReviewItem.findMany({
    where: { batch: { leadOrderId: orderId.trim() } },
    select: { allocationId: true, status: true, batch: { select: { status: true } } },
  });
  if (items.length === 0) {
    return { ok: true, exportableAllocationIds: allocationIds };
  }

  if (items.some((item) => item.status === REVIEW_ITEM_PENDING && item.batch.status === REVIEW_BATCH_OPEN)) {
    return { ok: false, code: "operator_review_pending" };
  }

  const blocked = new Set(
    items
      .filter((item) => item.status === REVIEW_ITEM_REJECTED || item.status === REVIEW_ITEM_UNUSED)
      .map((item) => item.allocationId)
  );
  if (allocationIds.some((id) => blocked.has(id))) {
    return { ok: false, code: "operator_review_rejected_allocation" };
  }

  const accepted = new Set(
    items.filter((item) => item.status === REVIEW_ITEM_ACCEPTED).map((item) => item.allocationId)
  );
  return {
    ok: true,
    exportableAllocationIds: allocationIds.filter((id) => accepted.has(id)),
  };
}

export async function downloadOperatorSupplementalExport(
  input: { supplementalId: string },
  db: PrismaClient = prisma
): Promise<
  | {
      ok: true;
      supplementalId: string;
      leadOrderId: string;
      filename: string;
      csv: string;
      contentSha256: string;
      allocationIds: string[];
      rowCount: number;
    }
  | {
      ok: false;
      code:
        | "feature_disabled"
        | "supplemental_not_found"
        | "no_accepted_supplementals"
        | "order_not_found";
    }
> {
  if (!isPplOperatorReviewEnabled()) return { ok: false, code: "feature_disabled" };

  const supplemental = await db.pplSupplementalExport.findUnique({
    where: { id: input.supplementalId.trim() },
  });
  if (!supplemental) return { ok: false, code: "supplemental_not_found" };

  const batch = await loadBatch(supplemental.batchId, db);
  if (!batch) return { ok: false, code: "supplemental_not_found" };
  const storedIds = new Set(readAllocationIdsJson(supplemental.allocationIdsJson));
  const acceptedIds = batch.items
    .filter(
      (item) => item.role === REVIEW_ROLE_SUPPLEMENTAL && item.status === REVIEW_ITEM_ACCEPTED
    )
    .map((item) => item.allocationId)
    .filter((id) => storedIds.size === 0 || storedIds.has(id));
  if (acceptedIds.length === 0) return { ok: false, code: "no_accepted_supplementals" };

  const order = await db.leadOrder.findUnique({
    where: { id: supplemental.leadOrderId },
    select: { id: true, orderNumber: true, nicheKey: true },
  });
  if (!order) return { ok: false, code: "order_not_found" };

  const allocations = await db.leadAllocation.findMany({
    where: { id: { in: acceptedIds } },
    select: {
      id: true,
      sourceLeadEvent: { select: { normalizedPayloadJson: true } },
      leadInventoryItem: {
        select: { generatedAt: true, nicheKey: true, normalizedState: true },
      },
    },
  });

  const nicheKey = order.nicheKey;
  const {
    extractBuyerCsvV2Fields,
    extractBuyerCsvV3Fields,
    isBuyerCsvV3ActiveNiche,
  } = await import("./buyer-csv-export.service.js");
  const rows = allocations.map((allocation) => {
    const item = allocation.leadInventoryItem;
    const extractor = isBuyerCsvV3ActiveNiche(nicheKey)
      ? extractBuyerCsvV3Fields
      : extractBuyerCsvV2Fields;
    return extractor({
      normalizedPayloadJson: allocation.sourceLeadEvent.normalizedPayloadJson,
      generatedAt: item?.generatedAt ?? supplemental.createdAt,
      nicheKey: item?.nicheKey ?? nicheKey,
      normalizedState: item?.normalizedState ?? null,
    });
  });
  const presented = presentBuyerCsvCustomerPackage(rows, nicheKey);
  const csv = presented.csv;
  return {
    ok: true,
    supplementalId: supplemental.id,
    leadOrderId: order.id,
    filename: `sa360-supplemental_${order.orderNumber ?? order.id}_${supplemental.id}.csv`,
    csv,
    contentSha256: createHash("sha256").update(csv).digest("hex"),
    allocationIds: acceptedIds,
    rowCount: rows.length,
  };
}
