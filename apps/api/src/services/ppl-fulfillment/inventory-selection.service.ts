import type {
  InventoryLot,
  LeadInventoryItem,
  PrismaClient,
  SourceLeadEvent,
} from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { findLeadOrderById } from "../../repositories/lead-order.repository.js";
import { buildReservationIdempotencyKey } from "../fulfillment-execution/fulfillment-execution-keys.js";
import { reserveLeadAllocationAtomicTx } from "../fulfillment-execution/reservation.service.js";
import { calculateInventoryAgeDays } from "../lead-inventory/lead-inventory-age.js";
import {
  type CommerceAgeBucketKey,
  parseCommerceAgeBucketKeys,
  resolveCommerceAgeBucketKey,
} from "./commerce-age-buckets.js";
import {
  isItemExcludedByProtectedAgents,
  listActiveExclusions,
  type ProtectedAgentExclusionRecord,
} from "./protected-agent-exclusion.service.js";

export const PPL_ALLOCATION_POLICY_VERSION = "ppl-aged-inventory-selection-v1";
export const PPL_PRODUCTION_MIN_QTY = 100;

export function isPplSelectionEnabled(): boolean {
  return process.env.SA360_PPL_SELECTION_ENABLED === "true";
}

export function resolvePplMinQuantity(): number {
  if (isPplSelectionEnabled()) {
    const local = process.env.SA360_PPL_LOCAL_MIN_QTY;
    if (local != null && local.trim() !== "") {
      const parsed = Number.parseInt(local, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return PPL_PRODUCTION_MIN_QTY;
}

export function validatePplRequestedQuantity(
  requestedQuantity: number
): { ok: true } | { ok: false; code: "under_100_unresolved" } {
  if (requestedQuantity < resolvePplMinQuantity()) {
    return { ok: false, code: "under_100_unresolved" };
  }
  return { ok: true };
}

export type PplInventoryCandidate = {
  item: LeadInventoryItem;
  inventoryLot: Pick<InventoryLot, "supplierAccountId" | "status">;
  sourceLeadEvent: Pick<
    SourceLeadEvent,
    "id" | "normalizedPayloadJson" | "enrichmentMetadataJson"
  >;
  ageDays: number;
  commerceAgeBucketKey: CommerceAgeBucketKey | null;
  phoneFingerprint: string | null;
  emailFingerprint: string | null;
};

export type PplInventorySelectionResult =
  | {
      ok: true;
      orderId: string;
      requestedQuantity: number;
      selectedQuantity: number;
      eligibleQuantity: number;
      selectedItemIds: string[];
      allocationIds?: string[];
      commerceAgeBucketKeys: CommerceAgeBucketKey[];
    }
  | {
      ok: false;
      code:
        | "selection_disabled"
        | "order_not_found"
        | "order_not_active"
        | "unsupported_order_kind"
        | "under_100_unresolved"
        | "shortage"
        | "idempotency_replay_failed";
      reasons: string[];
      eligibleQuantity?: number;
      requestedQuantity?: number;
    };

function parseOrderStates(statesJson: unknown): string[] {
  if (!Array.isArray(statesJson)) return [];
  return statesJson.map((state) => String(state).trim().toUpperCase()).filter(Boolean);
}

function buildIdentityFingerprints(normalizedPayloadJson: unknown): {
  phoneFingerprint: string | null;
  emailFingerprint: string | null;
} {
  const identity = readNormalizedLeadIdentity(normalizedPayloadJson);
  return {
    phoneFingerprint: identity?.phoneE164
      ? fingerprintIdentityValue("phone", identity.phoneE164)
      : null,
    emailFingerprint: identity?.email
      ? fingerprintIdentityValue("email", identity.email)
      : null,
  };
}

export function matchesCommerceAgeBucketFilter(
  commerceAgeBucketKey: CommerceAgeBucketKey | null,
  requestedBucketKeys: CommerceAgeBucketKey[]
): boolean {
  if (requestedBucketKeys.length === 0) return commerceAgeBucketKey != null;
  if (!commerceAgeBucketKey) return false;
  return requestedBucketKeys.includes(commerceAgeBucketKey);
}

export function sortCandidatesFcfs<T extends { generatedAt: Date; id: string }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    const generatedDiff = a.generatedAt.getTime() - b.generatedAt.getTime();
    if (generatedDiff !== 0) return generatedDiff;
    return a.id.localeCompare(b.id);
  });
}

export function dedupeCandidatesByIdentityFingerprints(
  candidates: PplInventoryCandidate[],
  seenPhoneFingerprints: Set<string>,
  seenEmailFingerprints: Set<string>
): PplInventoryCandidate[] {
  const selected: PplInventoryCandidate[] = [];
  const batchPhones = new Set<string>();
  const batchEmails = new Set<string>();

  for (const candidate of candidates) {
    if (candidate.phoneFingerprint) {
      if (
        seenPhoneFingerprints.has(candidate.phoneFingerprint) ||
        batchPhones.has(candidate.phoneFingerprint)
      ) {
        continue;
      }
    }
    if (candidate.emailFingerprint) {
      if (
        seenEmailFingerprints.has(candidate.emailFingerprint) ||
        batchEmails.has(candidate.emailFingerprint)
      ) {
        continue;
      }
    }

    if (candidate.phoneFingerprint) batchPhones.add(candidate.phoneFingerprint);
    if (candidate.emailFingerprint) batchEmails.add(candidate.emailFingerprint);
    selected.push(candidate);
  }

  return selected;
}

function buildPplSelectionAllocationIdempotencyKey(batchKey: string, itemId: string): string {
  return `ppl-selection:${batchKey.trim()}:${itemId.trim()}`;
}

function buildPplSelectionBatchPrefix(batchKey: string): string {
  return `ppl-selection:${batchKey.trim()}:`;
}

async function loadBuyerSeenFingerprints(clientAccountId: string, db: PrismaClient) {
  const rows = await db.buyerDeliveredIdentity.findMany({
    where: { clientAccountId: clientAccountId.trim() },
    select: { phoneFingerprint: true, emailFingerprint: true },
  });

  const phoneFingerprints = new Set<string>();
  const emailFingerprints = new Set<string>();
  for (const row of rows) {
    if (row.phoneFingerprint) phoneFingerprints.add(row.phoneFingerprint);
    if (row.emailFingerprint) emailFingerprints.add(row.emailFingerprint);
  }
  return { phoneFingerprints, emailFingerprints };
}

async function queryEligibleInventoryCandidates(
  input: {
    nicheKey: string;
    states: string[];
    commerceAgeBucketKeys: CommerceAgeBucketKey[];
    clientAccountId: string;
    exclusions: ProtectedAgentExclusionRecord[];
    evaluatedAt: Date;
  },
  db: PrismaClient
): Promise<PplInventoryCandidate[]> {
  const rows = await db.leadInventoryItem.findMany({
    where: {
      status: "available",
      inventoryClass: "aged",
      nicheKey: { equals: input.nicheKey.trim(), mode: "insensitive" },
      ...(input.states.length > 0 ? { normalizedState: { in: input.states } } : {}),
      inventoryLot: { status: "active" },
    },
    include: {
      inventoryLot: { select: { supplierAccountId: true, status: true } },
      sourceLeadEvent: {
        select: {
          id: true,
          normalizedPayloadJson: true,
          enrichmentMetadataJson: true,
        },
      },
    },
    orderBy: [{ generatedAt: "asc" }, { id: "asc" }],
  });

  const { phoneFingerprints, emailFingerprints } = await loadBuyerSeenFingerprints(
    input.clientAccountId,
    db
  );

  const candidates: PplInventoryCandidate[] = [];

  for (const row of rows) {
    const ageDays = calculateInventoryAgeDays(row.generatedAt, input.evaluatedAt);
    const commerceAgeBucketKey = resolveCommerceAgeBucketKey(ageDays);
    if (!matchesCommerceAgeBucketFilter(commerceAgeBucketKey, input.commerceAgeBucketKeys)) {
      continue;
    }

    const exclusionInput = {
      inventoryLot: row.inventoryLot,
      sourceLeadEvent: row.sourceLeadEvent,
    };
    if (isItemExcludedByProtectedAgents(exclusionInput, input.exclusions)) {
      continue;
    }

    const fingerprints = buildIdentityFingerprints(row.sourceLeadEvent.normalizedPayloadJson);
    if (
      (fingerprints.phoneFingerprint && phoneFingerprints.has(fingerprints.phoneFingerprint)) ||
      (fingerprints.emailFingerprint && emailFingerprints.has(fingerprints.emailFingerprint))
    ) {
      continue;
    }

    candidates.push({
      item: row,
      inventoryLot: row.inventoryLot,
      sourceLeadEvent: row.sourceLeadEvent,
      ageDays,
      commerceAgeBucketKey,
      phoneFingerprint: fingerprints.phoneFingerprint,
      emailFingerprint: fingerprints.emailFingerprint,
    });
  }

  return dedupeCandidatesByIdentityFingerprints(candidates, phoneFingerprints, emailFingerprints);
}

async function resolveSelectionContext(
  input: {
    orderId: string;
    commerceAgeBucketKeys?: unknown;
    requestedQuantity?: number;
  },
  db: PrismaClient
): Promise<
  | {
      ok: true;
      order: NonNullable<Awaited<ReturnType<typeof findLeadOrderById>>>;
      commerceAgeBucketKeys: CommerceAgeBucketKey[];
      requestedQuantity: number;
      exclusions: ProtectedAgentExclusionRecord[];
    }
  | { ok: false; result: PplInventorySelectionResult }
> {
  if (!isPplSelectionEnabled()) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "selection_disabled",
        reasons: ["ppl_selection_disabled"],
      },
    };
  }

  const order = await findLeadOrderById(input.orderId, db);
  if (!order) {
    return {
      ok: false,
      result: { ok: false, code: "order_not_found", reasons: ["order_not_found"] },
    };
  }

  if (order.status !== "active" || order.canceledAt || order.completedAt || order.pausedAt) {
    return {
      ok: false,
      result: { ok: false, code: "order_not_active", reasons: ["order_not_active"] },
    };
  }

  if (order.orderKind && order.orderKind !== "pay_per_lead") {
    return {
      ok: false,
      result: {
        ok: false,
        code: "unsupported_order_kind",
        reasons: [`order_kind_${order.orderKind}`],
      },
    };
  }

  const requestedQuantity = input.requestedQuantity ?? order.requestedQuantity ?? order.leadVolume;
  const quantityValidation = validatePplRequestedQuantity(requestedQuantity);
  if (!quantityValidation.ok) {
    return {
      ok: false,
      result: {
        ok: false,
        code: quantityValidation.code,
        reasons: [quantityValidation.code],
        requestedQuantity,
      },
    };
  }

  const commerceAgeBucketKeys = parseCommerceAgeBucketKeys(input.commerceAgeBucketKeys);
  const exclusions = await listActiveExclusions(db);

  return {
    ok: true,
    order,
    commerceAgeBucketKeys,
    requestedQuantity,
    exclusions,
  };
}

export async function previewPplInventorySelection(
  input: {
    orderId: string;
    commerceAgeBucketKeys?: unknown;
    requestedQuantity?: number;
  },
  db: PrismaClient = prisma
): Promise<PplInventorySelectionResult> {
  const context = await resolveSelectionContext(input, db);
  if (!context.ok) return context.result;

  const { order, commerceAgeBucketKeys, requestedQuantity, exclusions } = context;
  const evaluatedAt = new Date();
  const eligible = await queryEligibleInventoryCandidates(
    {
      nicheKey: order.nicheKey,
      states: parseOrderStates(order.statesJson),
      commerceAgeBucketKeys,
      clientAccountId: order.clientAccountId,
      exclusions,
      evaluatedAt,
    },
    db
  );

  const selected = eligible.slice(0, requestedQuantity);
  if (selected.length < requestedQuantity) {
    return {
      ok: false,
      code: "shortage",
      reasons: ["eligible_inventory_shortage"],
      eligibleQuantity: eligible.length,
      requestedQuantity,
    };
  }

  return {
    ok: true,
    orderId: order.id,
    requestedQuantity,
    selectedQuantity: selected.length,
    eligibleQuantity: eligible.length,
    selectedItemIds: selected.map((candidate) => candidate.item.id),
    commerceAgeBucketKeys,
  };
}

export async function commitPplInventorySelection(
  input: {
    orderId: string;
    commerceAgeBucketKeys?: unknown;
    requestedQuantity?: number;
    idempotencyKey: string;
  },
  db: PrismaClient = prisma
): Promise<PplInventorySelectionResult> {
  const batchKey = input.idempotencyKey.trim();
  if (!batchKey) {
    return {
      ok: false,
      code: "idempotency_replay_failed",
      reasons: ["idempotency_key_required"],
    };
  }

  const existingAllocations = await db.leadAllocation.findMany({
    where: {
      idempotencyKey: { startsWith: buildPplSelectionBatchPrefix(batchKey) },
    },
    select: { id: true, leadInventoryItemId: true },
    orderBy: { createdAt: "asc" },
  });
  if (existingAllocations.length > 0) {
    return {
      ok: true,
      orderId: input.orderId.trim(),
      requestedQuantity: existingAllocations.length,
      selectedQuantity: existingAllocations.length,
      eligibleQuantity: existingAllocations.length,
      selectedItemIds: existingAllocations
        .map((allocation) => allocation.leadInventoryItemId)
        .filter((itemId): itemId is string => itemId != null),
      allocationIds: existingAllocations.map((allocation) => allocation.id),
      commerceAgeBucketKeys: parseCommerceAgeBucketKeys(input.commerceAgeBucketKeys),
    };
  }

  const context = await resolveSelectionContext(input, db);
  if (!context.ok) return context.result;

  const { order, commerceAgeBucketKeys, requestedQuantity, exclusions } = context;
  const evaluatedAt = new Date();
  const eligible = await queryEligibleInventoryCandidates(
    {
      nicheKey: order.nicheKey,
      states: parseOrderStates(order.statesJson),
      commerceAgeBucketKeys,
      clientAccountId: order.clientAccountId,
      exclusions,
      evaluatedAt,
    },
    db
  );

  const selected = eligible.slice(0, requestedQuantity);
  if (selected.length < requestedQuantity) {
    return {
      ok: false,
      code: "shortage",
      reasons: ["eligible_inventory_shortage"],
      eligibleQuantity: eligible.length,
      requestedQuantity,
    };
  }

  const allocationIds: string[] = [];

  try {
    await db.$transaction(
      async (tx) => {
        for (const candidate of selected) {
          const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
            SELECT id, status::text AS status
            FROM "LeadInventoryItem"
            WHERE id = ${candidate.item.id}
            FOR UPDATE
          `;
          const lockedRow = locked[0];
          if (!lockedRow || lockedRow.status !== "available") {
            throw new Error("inventory_revalidation_failed");
          }

          const allocation = await tx.leadAllocation.create({
            data: {
              sourceLeadEventId: candidate.sourceLeadEvent.id,
              leadOrderId: order.id,
              clientAccountId: order.clientAccountId,
              leadInventoryItemId: candidate.item.id,
              status: "shadow",
              allocationPolicyVersion: PPL_ALLOCATION_POLICY_VERSION,
              decisionReasonsJson: [
                "ppl_aged_inventory_selection",
                candidate.commerceAgeBucketKey ?? "commerce_bucket_unresolved",
              ],
              candidateCount: eligible.length,
              idempotencyKey: buildPplSelectionAllocationIdempotencyKey(
                batchKey,
                candidate.item.id
              ),
              proposedAt: evaluatedAt,
            },
          });

          await tx.leadOrder.update({
            where: { id: order.id },
            data: { proposedQuantity: { increment: 1 } },
          });

          const reservationIdempotencyKey = buildReservationIdempotencyKey(allocation.id);
          const reserveResult = await reserveLeadAllocationAtomicTx(
            allocation.id,
            reservationIdempotencyKey,
            tx
          );
          if (!reserveResult.reserved) {
            throw new Error("reservation_failed");
          }

          allocationIds.push(allocation.id);
        }
      },
      { isolationLevel: PrismaNamespace.TransactionIsolationLevel.Serializable }
    );
  } catch (err) {
    if (err instanceof Error) {
      if (
        err.message === "inventory_revalidation_failed" ||
        err.message === "inventory_reserve_failed" ||
        err.message === "reservation_failed" ||
        err.message === "capacity_claim_failed"
      ) {
        return {
          ok: false,
          code: "shortage",
          reasons: [err.message],
          eligibleQuantity: eligible.length,
          requestedQuantity,
        };
      }
    }
    throw err;
  }

  return {
    ok: true,
    orderId: order.id,
    requestedQuantity,
    selectedQuantity: selected.length,
    eligibleQuantity: eligible.length,
    selectedItemIds: selected.map((candidate) => candidate.item.id),
    allocationIds,
    commerceAgeBucketKeys,
  };
}

export async function releasePplAllocation(
  input: { allocationId: string; reason: string },
  db: PrismaClient = prisma
): Promise<
  | { ok: true }
  | {
      ok: false;
      code:
        | "allocation_not_found"
        | "buyer_already_delivered"
        | "invalid_allocation_status"
        | "release_transition_failed";
    }
> {
  const allocationId = input.allocationId.trim();
  const allocation = await db.leadAllocation.findUnique({
    where: { id: allocationId },
    select: {
      id: true,
      status: true,
      leadOrderId: true,
      leadInventoryItemId: true,
    },
  });
  if (!allocation) {
    return { ok: false, code: "allocation_not_found" };
  }

  const delivered = await db.buyerDeliveredIdentity.findFirst({
    where: { leadAllocationId: allocation.id },
    select: { id: true },
  });
  if (delivered) {
    return { ok: false, code: "buyer_already_delivered" };
  }

  if (allocation.status !== "reserved") {
    return { ok: false, code: "invalid_allocation_status" };
  }

  const now = new Date();
  try {
    await db.$transaction(async (tx) => {
      const released = await tx.leadAllocation.updateMany({
        where: { id: allocation.id, status: "reserved" },
        data: {
          status: "released",
          releasedAt: now,
          releaseReasonJson: { code: input.reason.trim(), detail: null },
        },
      });
      if (released.count !== 1) throw new Error("release_transition_failed");

      const orderUpdated = await tx.$executeRaw`
        UPDATE "LeadOrder"
        SET
          "reservedQuantity" = "reservedQuantity" - 1,
          "updatedAt" = ${now}
        WHERE id = ${allocation.leadOrderId}
          AND "reservedQuantity" > 0
      `;
      if (orderUpdated !== 1) throw new Error("release_transition_failed");

      if (allocation.leadInventoryItemId) {
        const itemUpdated = await tx.leadInventoryItem.updateMany({
          where: {
            id: allocation.leadInventoryItemId,
            status: "reserved",
          },
          data: {
            status: "available",
            reservedAt: null,
          },
        });
        if (itemUpdated.count !== 1) throw new Error("release_transition_failed");
      }
    });
  } catch (err) {
    if (err instanceof Error && err.message === "release_transition_failed") {
      return { ok: false, code: "release_transition_failed" };
    }
    throw err;
  }

  return { ok: true };
}
