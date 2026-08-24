import type { Prisma, PrismaClient } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { isPrismaSerializableConflict } from "../../lib/prisma-serializable-conflict.js";
import {
  buildReservationIdempotencyKey,
  FULFILLMENT_RESERVATION_POLICY_VERSION,
} from "./fulfillment-execution-keys.js";
import type { ReservationResult } from "./fulfillment-execution.types.js";
import {
  loadAllocationForReservation,
  validateReservationEligibility,
} from "./reservation-eligibility.service.js";

const MAX_SERIALIZABLE_RETRIES = 3;

export async function reserveLeadAllocationAtomicTx(
  allocationId: string,
  reservationIdempotencyKey: string,
  tx: Prisma.TransactionClient
) {
  const allocationRows = await tx.$queryRaw<
    Array<{ id: string; leadOrderId: string; status: string; leadInventoryItemId: string | null }>
  >`
    UPDATE "LeadAllocation"
    SET
      status = 'reserved'::"LeadAllocationStatus",
      "reservedAt" = NOW(),
      "reservationPolicyVersion" = ${FULFILLMENT_RESERVATION_POLICY_VERSION},
      "reservationIdempotencyKey" = ${reservationIdempotencyKey},
      "updatedAt" = NOW()
    WHERE id = ${allocationId}
      AND status = 'shadow'::"LeadAllocationStatus"
    RETURNING id, "leadOrderId", status, "leadInventoryItemId"
  `;

  if (allocationRows.length === 0) {
    return { reserved: false as const };
  }

  const leadOrderId = allocationRows[0]!.leadOrderId;
  const leadInventoryItemId = allocationRows[0]!.leadInventoryItemId;

  const orderRows = await tx.$queryRaw<Array<{ id: string; reservedQuantity: number }>>`
    UPDATE "LeadOrder"
    SET
      "reservedQuantity" = "reservedQuantity" + 1,
      "updatedAt" = NOW()
    WHERE id = ${leadOrderId}
      AND status = 'active'::"LeadOrderStatus"
      AND "requestedQuantity" IS NOT NULL
      AND "requestedQuantity" > 0
      AND "reservedQuantity" + "fulfilledQuantity" < "requestedQuantity"
      AND "canceledAt" IS NULL
      AND "completedAt" IS NULL
      AND "pausedAt" IS NULL
    RETURNING id, "reservedQuantity"
  `;

  if (orderRows.length === 0) {
    throw new Error("capacity_claim_failed");
  }

  if (leadInventoryItemId) {
    const itemRows = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "LeadInventoryItem"
      SET
        status = 'reserved'::"LeadInventoryItemStatus",
        "reservedAt" = NOW(),
        "updatedAt" = NOW()
      WHERE id = ${leadInventoryItemId}
        AND status = 'available'::"LeadInventoryItemStatus"
        AND "commerceExcludedAt" IS NULL
      RETURNING id
    `;
    if (itemRows.length === 0) {
      throw new Error("inventory_reserve_failed");
    }
  }

  return {
    reserved: true as const,
    leadOrderId,
    reservedQuantity: orderRows[0]!.reservedQuantity,
  };
}

export async function reserveLeadAllocation(
  allocationId: string,
  db: PrismaClient = prisma
): Promise<ReservationResult> {
  const trimmedId = allocationId.trim();
  const reservationIdempotencyKey = buildReservationIdempotencyKey(trimmedId);

  const existing = await db.leadAllocation.findUnique({
    where: { reservationIdempotencyKey },
    include: { leadOrder: true },
  });
  if (existing?.status === "reserved" || existing?.status === "delivering") {
    return {
      ok: true,
      status: "already_reserved",
      allocationId: existing.id,
      leadOrderId: existing.leadOrderId,
      reservedQuantity: existing.leadOrder.reservedQuantity,
    };
  }

  const allocation = await loadAllocationForReservation(trimmedId, db);
  if (!allocation) {
    return { ok: false, code: "allocation_not_found", reasons: ["allocation_not_found"] };
  }

  const eligibility = await validateReservationEligibility(allocation, db);
  if (!eligibility.ok) {
    return eligibility;
  }

  for (let attempt = 0; attempt < MAX_SERIALIZABLE_RETRIES; attempt += 1) {
    try {
      const result = await db.$transaction(
        async (tx) => reserveLeadAllocationAtomicTx(trimmedId, reservationIdempotencyKey, tx),
        { isolationLevel: PrismaNamespace.TransactionIsolationLevel.Serializable }
      );

      if (result.reserved) {
        return {
          ok: true,
          status: "reserved",
          allocationId: trimmedId,
          leadOrderId: result.leadOrderId,
          reservedQuantity: result.reservedQuantity,
        };
      }

      const raced = await db.leadAllocation.findUnique({
        where: { id: trimmedId },
        include: { leadOrder: true },
      });
      if (!raced) {
        return { ok: false, code: "allocation_not_found", reasons: ["allocation_not_found"] };
      }
      if (
        raced.reservationIdempotencyKey === reservationIdempotencyKey &&
        (raced.status === "reserved" || raced.status === "delivering")
      ) {
        return {
          ok: true,
          status: "already_reserved",
          allocationId: raced.id,
          leadOrderId: raced.leadOrderId,
          reservedQuantity: raced.leadOrder.reservedQuantity,
        };
      }
      if (raced.status !== "shadow") {
        return {
          ok: false,
          code: "invalid_allocation_status",
          reasons: [`allocation_status_${raced.status}`],
        };
      }

      return { ok: false, code: "reservation_race_lost", reasons: ["reservation_race_lost"] };
    } catch (err) {
      if (err instanceof Error && err.message === "capacity_claim_failed") {
        return { ok: false, code: "capacity_exhausted", reasons: ["order_capacity_exhausted"] };
      }
      if (err instanceof Error && err.message === "inventory_reserve_failed") {
        return { ok: false, code: "reservation_race_lost", reasons: ["inventory_reserve_failed"] };
      }
      if (isPrismaSerializableConflict(err)) {
        if (attempt + 1 >= MAX_SERIALIZABLE_RETRIES) {
          const replay = await db.leadAllocation.findUnique({
            where: { reservationIdempotencyKey },
            include: { leadOrder: true },
          });
          if (replay) {
            return {
              ok: true,
              status: "already_reserved",
              allocationId: replay.id,
              leadOrderId: replay.leadOrderId,
              reservedQuantity: replay.leadOrder.reservedQuantity,
            };
          }
          return { ok: false, code: "exclusive_source_conflict", reasons: ["exclusive_source_conflict"] };
        }
        continue;
      }
      throw err;
    }
  }

  return { ok: false, code: "reservation_race_lost", reasons: ["reservation_race_lost"] };
}
