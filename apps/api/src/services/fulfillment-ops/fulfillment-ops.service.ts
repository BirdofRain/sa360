import type { LeadOrder, Prisma, PrismaClient } from "@prisma/client";
import {
  FULFILLMENT_ALLOCATION_POLICY_VERSION,
  FULFILLMENT_SUPPORTED_FULFILLMENT_MODES,
  FULFILLMENT_SUPPORTED_ORDER_KINDS,
} from "@sa360/shared";

import { maskSourceLeadUidForAudit } from "../../lib/identity-fingerprint.js";
import { isLeadInventoryReviewEnabled } from "../../lib/lead-inventory-review-env.js";
import {
  getLf2GhlAllowedClientIds,
  getLf2GhlAllowedLocationIds,
  getLf2GhlAllowedOrderIds,
  getLf2GhlAllowedSourceLanes,
  isLf2ExecutionEnabled,
  isLf2GhlCanaryEnabled,
} from "../../lib/lf2-ghl-canary-config.js";
import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { prisma } from "../../lib/db.js";
import {
  createDeliveryInstructions,
  createDeliveryTargetRecord,
} from "../../repositories/delivery-target.repository.js";
import { createShadowLeadAllocationIdempotent } from "../../repositories/lead-allocation.repository.js";
import { upsertLeadEligibilityAssessment } from "../../repositories/lead-eligibility.repository.js";
import {
  createLeadOrderRecord,
  findLeadOrderById,
  mapLeadOrderRow,
  nextLeadOrderNumber,
  updateLeadOrderRecord,
} from "../../repositories/lead-order.repository.js";
import {
  findLeadInventoryItemById,
  listActiveAgeBandDefinitions,
  listLeadInventoryItems,
} from "../../repositories/lead-inventory.repository.js";
import { getLeadProofByLeadUid, getLeadVerificationResultByLeadUid } from "../../repositories/lead-proof.repository.js";
import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";
import { calculateInventoryAgeDays, resolveAgeBandKey } from "../lead-inventory/lead-inventory-age.js";
import { evaluateLeadEligibility } from "../fulfillment-shadow/eligibility.service.js";
import { buildEligibilityPreviewForSourceLead } from "../fulfillment-shadow/eligibility-preview.service.js";
import { buildLeadInventorySummary } from "../lead-inventory/lead-inventory-summary.service.js";
import { buildLeadInventoryReviewSummary } from "../lead-inventory-review/lead-inventory-review-query.service.js";
import { reserveLeadAllocation } from "../fulfillment-execution/reservation.service.js";
import { simulateDeliveryInstruction } from "../fulfillment-execution/delivery-attempt.service.js";
import { listDeliveryAttemptsForInstruction } from "../../repositories/delivery-attempt.repository.js";
import type {
  FulfillmentOpsCandidateRow,
  FulfillmentOpsEligibilityPreview,
  FulfillmentOpsEvidence,
  FulfillmentOpsOrderSummary,
  FulfillmentOpsPrepareResult,
  FulfillmentOpsSafetyPosture,
} from "./fulfillment-ops.types.js";

export const FULFILLMENT_OPS_SIM_ADAPTER_KEY = "test.simulated.v1";
export const FULFILLMENT_OPS_SAFETY_MESSAGE =
  "Simulation only — no external delivery will occur.";

const WORKBENCH_ALLOCATION_PREFIX = "allocation:workbench";

function parseStates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
}

function remainingCapacity(order: LeadOrder): number | null {
  if (order.requestedQuantity == null) return null;
  return Math.max(order.requestedQuantity - order.reservedQuantity - order.fulfilledQuantity, 0);
}

export function presentFulfillmentOpsOrder(row: ReturnType<typeof mapLeadOrderRow>): FulfillmentOpsOrderSummary {
  const states = row.states ?? parseStates(row.statesJson);
  const blockers: string[] = [];
  if (row.status !== "active") blockers.push(`order_status_${row.status}`);
  if (row.canceledAt) blockers.push("order_canceled");
  if (row.completedAt) blockers.push("order_completed");
  if (row.pausedAt) blockers.push("order_paused");
  if (!row.orderKind || !(FULFILLMENT_SUPPORTED_ORDER_KINDS as readonly string[]).includes(row.orderKind)) {
    blockers.push("order_kind_missing_or_unsupported");
  }
  if (
    !row.fulfillmentMode ||
    !(FULFILLMENT_SUPPORTED_FULFILLMENT_MODES as readonly string[]).includes(row.fulfillmentMode)
  ) {
    blockers.push("fulfillment_mode_missing_or_unsupported");
  }
  if (row.requestedQuantity == null || row.requestedQuantity <= 0) {
    blockers.push("requested_quantity_not_configured");
  }
  const remaining = remainingCapacity(row);
  if (remaining != null && remaining <= 0) blockers.push("order_capacity_exhausted");

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    clientAccountId: row.clientAccountId,
    clientDisplayName: row.clientDisplayName,
    status: row.status,
    nicheKey: row.nicheKey,
    productType: row.productType,
    states,
    leadVolume: row.leadVolume,
    requestedQuantity: row.requestedQuantity,
    proposedQuantity: row.proposedQuantity,
    reservedQuantity: row.reservedQuantity,
    fulfilledQuantity: row.fulfilledQuantity,
    remainingCapacity: remaining,
    orderKind: row.orderKind,
    fulfillmentMode: row.fulfillmentMode,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    allocationReady: blockers.length === 0,
    allocationBlockers: blockers,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function buildFulfillmentOpsSafetyPosture(): FulfillmentOpsSafetyPosture {
  const inventoryReviewEnabled = isLeadInventoryReviewEnabled();
  const lf2ExecutionEnabled = isLf2ExecutionEnabled();
  const lf2GhlCanaryEnabled = isLf2GhlCanaryEnabled();
  const allowlistsConfigured = Boolean(
    getLf2GhlAllowedClientIds() &&
      getLf2GhlAllowedLocationIds() &&
      getLf2GhlAllowedOrderIds() &&
      getLf2GhlAllowedSourceLanes()
  );

  return {
    simulationOnly: true,
    liveDeliveryEnabled: false,
    liveDeliveryStatus: "LIVE DISABLED",
    inventoryReviewEnabled,
    lf2ExecutionEnabled,
    lf2GhlCanaryEnabled,
    lf2AllowlistsConfigured: allowlistsConfigured,
    runtimeMode: process.env.NODE_ENV?.trim() || "unknown",
    nodeEnv: process.env.NODE_ENV?.trim() || "unknown",
    flags: {
      SA360_LEAD_INVENTORY_REVIEW_ENABLED: inventoryReviewEnabled,
      SA360_LF2_EXECUTION_ENABLED: lf2ExecutionEnabled,
      SA360_LF2_GHL_CANARY_ENABLED: lf2GhlCanaryEnabled,
      SA360_LF2_GHL_ALLOWED_CLIENT_IDS: Boolean(getLf2GhlAllowedClientIds()),
      SA360_LF2_GHL_ALLOWED_LOCATION_IDS: Boolean(getLf2GhlAllowedLocationIds()),
      SA360_LF2_GHL_ALLOWED_ORDER_IDS: Boolean(getLf2GhlAllowedOrderIds()),
      SA360_LF2_GHL_ALLOWED_SOURCE_LANES: Boolean(getLf2GhlAllowedSourceLanes()),
    },
    safetyMessage: FULFILLMENT_OPS_SAFETY_MESSAGE,
  };
}

export async function buildLatestFulfillmentOpsEvidenceForOrder(
  orderId: string,
  db: PrismaClient = prisma
): Promise<FulfillmentOpsEvidence | null> {
  const allocation = await db.leadAllocation.findFirst({
    where: {
      leadOrderId: orderId.trim(),
      status: { in: ["shadow", "reserved", "delivering", "committed", "review_required"] },
    },
    orderBy: [{ reservedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!allocation) return null;
  return buildFulfillmentOpsEvidence(allocation.id, db);
}

export async function buildFulfillmentOpsBootstrap(
  orderId: string | undefined,
  db: PrismaClient = prisma
) {
  const safety = buildFulfillmentOpsSafetyPosture();
  const [inventorySummary, reviewSummary] = await Promise.all([
    buildLeadInventorySummary(db),
    buildLeadInventoryReviewSummary(db),
  ]);

  let selectedOrder: FulfillmentOpsOrderSummary | null = null;
  let orderError: string | null = null;
  let latestEvidence: FulfillmentOpsEvidence | null = null;
  if (orderId?.trim()) {
    const row = await findLeadOrderById(orderId.trim(), db);
    if (!row) orderError = "lead_order_not_found";
    else {
      selectedOrder = presentFulfillmentOpsOrder(row);
      latestEvidence = await buildLatestFulfillmentOpsEvidenceForOrder(row.id, db);
    }
  }

  const byNiche = await db.leadInventoryItem.groupBy({
    by: ["nicheKey"],
    _count: { _all: true },
  });
  const byState = await db.leadInventoryItem.groupBy({
    by: ["normalizedState"],
    _count: { _all: true },
    where: { status: { in: ["available", "pending_review"] } },
  });

  return {
    safety,
    inventory: {
      summary: inventorySummary,
      review: {
        featureEnabled: safety.inventoryReviewEnabled,
        ...reviewSummary,
      },
      nicheDistribution: byNiche.map((row) => ({
        nicheKey: row.nicheKey,
        count: row._count._all,
      })),
      stateDistribution: byState
        .map((row) => ({
          state: row.normalizedState,
          count: row._count._all,
        }))
        .slice(0, 50),
    },
    selectedOrder,
    latestEvidence,
    orderError,
    limitations: [
      "Shadow matching is not inventory-aware; workbench prepare binds an operator-selected inventory item to the selected order.",
      "Inventory Explorer fixture data is not used.",
      "Live GHL / webhook delivery paths are never invoked from this workbench.",
    ],
  };
}

function buildWorkbenchAllocationIdempotencyKey(sourceLeadEventId: string, leadOrderId: string): string {
  return `${WORKBENCH_ALLOCATION_PREFIX}:${sourceLeadEventId.trim()}:${leadOrderId.trim()}:${FULFILLMENT_ALLOCATION_POLICY_VERSION}`;
}

export async function buildOrderEligibilityPreview(
  orderId: string,
  opts: { limit?: number } = {},
  db: PrismaClient = prisma
): Promise<
  | { ok: true; preview: FulfillmentOpsEligibilityPreview }
  | { ok: false; error: string }
> {
  const orderRow = await findLeadOrderById(orderId.trim(), db);
  if (!orderRow) return { ok: false, error: "lead_order_not_found" };

  const order = presentFulfillmentOpsOrder(orderRow);
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 50);
  const evaluatedAt = new Date();
  const ageBands = await listActiveAgeBandDefinitions(undefined, db);

  const items = await listLeadInventoryItems(
    {
      nicheKey: order.nicheKey,
      status: "available",
      limit: Math.max(limit * 3, 50),
    },
    db
  );

  const exclusionReasonCounts: Record<string, number> = {};
  const candidates: FulfillmentOpsCandidateRow[] = [];
  let scanned = 0;
  let eligibleCount = 0;
  let excludedCount = 0;

  const bump = (code: string) => {
    exclusionReasonCounts[code] = (exclusionReasonCounts[code] ?? 0) + 1;
  };

  for (const item of items) {
    if (candidates.length >= limit && scanned >= limit * 2) break;
    scanned += 1;

    const state = item.normalizedState?.trim().toUpperCase() ?? "";
    const ageDays = calculateInventoryAgeDays(item.generatedAt, evaluatedAt);
    const ageBandKey = resolveAgeBandKey(ageDays, ageBands);
    const warnings: string[] = [];

    if (order.states.length > 0 && state && !order.states.includes(state)) {
      excludedCount += 1;
      bump("state_mismatch");
      continue;
    }
    if (item.nicheKey.toLowerCase() !== order.nicheKey.toLowerCase()) {
      excludedCount += 1;
      bump("niche_mismatch");
      continue;
    }

    const preview = await buildEligibilityPreviewForSourceLead(item.sourceLeadEventId, db);
    if (!preview.ok) {
      excludedCount += 1;
      bump(preview.error);
      continue;
    }

    const status = preview.preview.predictedEligibilityStatus;
    const reasonCodes = preview.preview.predictedReasonCodes;
    const reservationPermitted =
      order.allocationReady && status === "eligible" && item.status === "available";

    if (preview.preview.summaries.duplicateBlocked || preview.preview.summaries.duplicateRequiresReview) {
      warnings.push("duplicate_or_previous_delivery_risk");
    }
    if (!preview.preview.summaries.requiredFieldsComplete) {
      warnings.push("required_fields_incomplete");
    }

    const row: FulfillmentOpsCandidateRow = {
      inventoryItemId: item.id,
      maskedItemId: maskSourceLeadUidForAudit(item.id) ?? "inv***",
      sourceLeadEventId: item.sourceLeadEventId,
      maskedSourceLeadUid: preview.preview.maskedSourceLeadUid,
      normalizedState: state || "UNKNOWN",
      nicheKey: item.nicheKey,
      ageDays,
      ageBandKey,
      inventoryStatus: item.status,
      proofStatus: preview.preview.proofStatus,
      verificationStatus: preview.preview.verificationStatus,
      duplicateStatus: preview.preview.duplicateStatus,
      predictedEligibilityStatus: status,
      predictedReasonCodes: reasonCodes,
      reservationPermitted,
      warnings,
    };

    if (status === "eligible") {
      eligibleCount += 1;
      candidates.push(row);
    } else {
      excludedCount += 1;
      for (const code of reasonCodes.length ? reasonCodes : [status]) bump(code);
      if (candidates.length < limit) candidates.push(row);
    }
  }

  return {
    ok: true,
    preview: {
      order,
      limitations: [
        "Candidate list is filtered from LeadInventoryItem (available) by order niche/states — not Inventory Explorer fixtures.",
        "Matching is not inventory-SKU-aware beyond niche/state filters; operator selects the candidate to bind.",
        "Reservation requires a prepared shadow allocation with a persisted eligible assessment.",
      ],
      evaluatedAt: evaluatedAt.toISOString(),
      scanned,
      eligibleCount,
      excludedCount,
      exclusionReasonCounts,
      candidates: candidates.slice(0, limit),
    },
  };
}

export type CreateDemoOrderInput = {
  clientAccountId: string;
  clientDisplayName?: string;
  nicheKey: string;
  states: string[];
  leadVolume: number;
  productType?: string;
  notes?: string;
};

export async function createFulfillmentOpsDemoOrder(
  input: CreateDemoOrderInput,
  db: PrismaClient = prisma
) {
  const now = new Date();
  const cycleEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const states = input.states.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (states.length === 0) {
    throw new Error("states_required");
  }

  const row = await createLeadOrderRecord(
    {
      orderNumber: await nextLeadOrderNumber(db),
      clientAccountId: input.clientAccountId.trim(),
      clientDisplayName: input.clientDisplayName?.trim() || null,
      status: "submitted",
      nicheKey: input.nicheKey.trim(),
      productType: input.productType?.trim() || null,
      statesJson: states,
      leadVolume: input.leadVolume,
      deliveryCadence: "manual_ops_workbench",
      campaignType: "fulfillment_ops_demo",
      crmPackage: "simulation_only",
      aiVoiceAddon: false,
      deliveryDestinationType: "simulation",
      deliveryDestinationLabel: "LF2 simulation adapter (test.simulated.v1)",
      notes: input.notes?.trim() || "Created from Fulfillment Ops Workbench",
      adminNotes: "Demo order — simulation only; no live delivery.",
      createdByRole: "admin",
      submittedAt: now,
      orderKind: "pay_per_lead",
      fulfillmentMode: "pooled_matching",
      requestedQuantity: input.leadVolume,
      fulfillmentCycleStart: now,
      fulfillmentCycleEnd: cycleEnd,
      allowedSourceLanesJson: [],
      proofPolicyKey: null,
      exclusivityRequired: false,
      fulfillmentPriority: 100,
      proposedQuantity: 0,
      reservedQuantity: 0,
      fulfilledQuantity: 0,
    },
    db
  );

  return presentFulfillmentOpsOrder(row);
}

export async function activateFulfillmentOpsOrder(
  orderId: string,
  db: PrismaClient = prisma
): Promise<
  | { ok: true; order: FulfillmentOpsOrderSummary }
  | { ok: false; error: string; reasons: string[] }
> {
  const existing = await findLeadOrderById(orderId.trim(), db);
  if (!existing) return { ok: false, error: "lead_order_not_found", reasons: ["lead_order_not_found"] };

  const now = new Date();
  const patch: Prisma.LeadOrderUpdateInput = {
    status: "active",
    activatedAt: existing.activatedAt ?? now,
    pausedAt: null,
  };

  if (!existing.orderKind) patch.orderKind = "pay_per_lead";
  if (!existing.fulfillmentMode) patch.fulfillmentMode = "pooled_matching";
  if (existing.requestedQuantity == null || existing.requestedQuantity <= 0) {
    patch.requestedQuantity = existing.leadVolume;
  }
  if (!existing.fulfillmentCycleStart) patch.fulfillmentCycleStart = now;
  if (!existing.fulfillmentCycleEnd) {
    patch.fulfillmentCycleEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  const updated = await updateLeadOrderRecord(existing.id, patch, db);
  const presented = presentFulfillmentOpsOrder(updated);
  if (!presented.allocationReady) {
    return {
      ok: false,
      error: "order_not_allocation_ready",
      reasons: presented.allocationBlockers,
    };
  }
  return { ok: true, order: presented };
}

async function ensureSimulationDeliveryTarget(
  clientAccountId: string,
  db: PrismaClient
) {
  const existing = await db.deliveryTarget.findFirst({
    where: {
      clientAccountId: clientAccountId.trim(),
      adapterKey: FULFILLMENT_OPS_SIM_ADAPTER_KEY,
      enabled: true,
    },
  });
  if (existing) return existing;

  return createDeliveryTargetRecord(
    {
      clientAccount: { connect: { clientAccountId: clientAccountId.trim() } },
      displayName: "Fulfillment Ops Simulation Target",
      adapterKey: FULFILLMENT_OPS_SIM_ADAPTER_KEY,
      enabled: true,
      isPrimary: false,
      isRequired: true,
      configMetadataJson: { purpose: "fulfillment_ops_workbench_simulation" },
      readinessStatus: "ready_for_simulation",
    },
    db
  );
}

export async function prepareFulfillmentOpsCandidate(
  input: { leadOrderId: string; inventoryItemId: string },
  db: PrismaClient = prisma
): Promise<FulfillmentOpsPrepareResult> {
  const orderRow = await findLeadOrderById(input.leadOrderId.trim(), db);
  if (!orderRow) {
    return { ok: false, error: "lead_order_not_found", reasons: ["lead_order_not_found"] };
  }
  const order = presentFulfillmentOpsOrder(orderRow);
  if (!order.allocationReady) {
    return { ok: false, error: "order_not_allocation_ready", reasons: order.allocationBlockers };
  }

  const item = await findLeadInventoryItemById(input.inventoryItemId.trim(), db);
  if (!item) {
    return { ok: false, error: "inventory_item_not_found", reasons: ["inventory_item_not_found"] };
  }
  if (item.status !== "available") {
    return {
      ok: false,
      error: "inventory_not_available",
      reasons: [`inventory_status_${item.status}`],
    };
  }
  if (item.nicheKey.toLowerCase() !== order.nicheKey.toLowerCase()) {
    return { ok: false, error: "niche_mismatch", reasons: ["niche_mismatch"] };
  }
  const itemState = item.normalizedState.trim().toUpperCase();
  if (order.states.length > 0 && !order.states.includes(itemState)) {
    return { ok: false, error: "state_mismatch", reasons: ["state_mismatch"] };
  }

  const event = await findSourceLeadEventById(item.sourceLeadEventId, db);
  if (!event) {
    return { ok: false, error: "source_lead_not_found", reasons: ["source_lead_not_found"] };
  }

  const leadUid = event.sourceLeadUid?.trim() || null;
  const leadProof = leadUid ? await getLeadProofByLeadUid(leadUid, db) : null;
  const verification = leadUid ? await getLeadVerificationResultByLeadUid(leadUid, db) : null;
  const identity = readNormalizedLeadIdentity(event.normalizedPayloadJson);

  const eligibilityEval = evaluateLeadEligibility({
    sourceLeadEvent: event,
    leadProof,
    verification,
    leadState: identity?.state ?? itemState,
  });

  await upsertLeadEligibilityAssessment(
    {
      sourceLeadEventId: event.id,
      policyKey: eligibilityEval.policyKey,
      policyVersion: eligibilityEval.policyVersion,
      status: eligibilityEval.status,
      reasonCodesJson: eligibilityEval.reasonCodes as Prisma.InputJsonValue,
      proofResultJson: eligibilityEval.proofResult as Prisma.InputJsonValue,
      duplicateResultJson: eligibilityEval.duplicateResult as Prisma.InputJsonValue,
      requiredFieldResultJson: eligibilityEval.requiredFieldResult as Prisma.InputJsonValue,
      geographyResultJson: eligibilityEval.geographyResult as Prisma.InputJsonValue,
      consentResultJson: eligibilityEval.consentResult as Prisma.InputJsonValue,
    },
    db
  );

  if (eligibilityEval.status !== "eligible") {
    return {
      ok: false,
      error: "eligibility_not_eligible",
      reasons:
        eligibilityEval.reasonCodes.length > 0
          ? eligibilityEval.reasonCodes
          : [eligibilityEval.status],
    };
  }

  const exclusive = await db.leadAllocation.findFirst({
    where: {
      sourceLeadEventId: event.id,
      status: { in: ["reserved", "delivering", "committed", "review_required"] },
    },
    select: { id: true, status: true, leadOrderId: true },
  });
  if (exclusive) {
    return {
      ok: false,
      error: "exclusive_source_conflict",
      reasons: [`exclusive_source_conflict:${exclusive.status}`],
    };
  }

  const simTarget = await ensureSimulationDeliveryTarget(order.clientAccountId, db);
  const idempotencyKey = buildWorkbenchAllocationIdempotencyKey(event.id, order.id);

  const { allocation, created } = await createShadowLeadAllocationIdempotent(
    {
      sourceLeadEventId: event.id,
      leadOrderId: order.id,
      clientAccountId: order.clientAccountId,
      allocationPolicyVersion: FULFILLMENT_ALLOCATION_POLICY_VERSION,
      decisionReasonsJson: ["fulfillment_ops_workbench_operator_selected"],
      candidateCount: 1,
      idempotencyKey,
    },
    db
  );

  if (allocation.leadOrderId !== order.id) {
    return {
      ok: false,
      error: "allocation_order_mismatch",
      reasons: ["existing_allocation_bound_to_different_order"],
    };
  }

  if (!allocation.leadInventoryItemId) {
    await db.leadAllocation.update({
      where: { id: allocation.id },
      data: { leadInventoryItemId: item.id },
    });
  }

  let instructions = allocation.deliveryInstructions ?? [];
  let createdInstruction = false;
  const simInstruction = instructions.find(
    (row) => row.deliveryTarget?.adapterKey === FULFILLMENT_OPS_SIM_ADAPTER_KEY
  );

  if (!simInstruction) {
    instructions = await createDeliveryInstructions(
      [
        {
          leadAllocationId: allocation.id,
          deliveryTargetId: simTarget.id,
          sequence: 1,
          isRequired: true,
        },
      ],
      db
    );
    createdInstruction = true;
  }

  const instruction =
    instructions.find((row) => row.deliveryTarget?.adapterKey === FULFILLMENT_OPS_SIM_ADAPTER_KEY) ??
    instructions[0];
  if (!instruction) {
    return {
      ok: false,
      error: "instruction_missing",
      reasons: ["no_delivery_instruction"],
    };
  }

  return {
    ok: true,
    allocationId: allocation.id,
    allocationStatus: allocation.status,
    leadOrderId: order.id,
    sourceLeadEventId: event.id,
    inventoryItemId: item.id,
    deliveryInstructionId: instruction.id,
    deliveryTargetAdapterKey: instruction.deliveryTarget?.adapterKey ?? FULFILLMENT_OPS_SIM_ADAPTER_KEY,
    simulationReady: allocation.status === "shadow" || allocation.status === "reserved",
    createdAllocation: created,
    createdInstruction,
    externalWriteOccurred: false,
    safetyMessage: FULFILLMENT_OPS_SAFETY_MESSAGE,
  };
}

export async function reserveFulfillmentOpsAllocation(allocationId: string) {
  const result = await reserveLeadAllocation(allocationId);
  if (!result.ok) {
    return {
      ok: false as const,
      error: result.code,
      reasons: result.reasons,
      externalWriteOccurred: false as const,
      safetyMessage: FULFILLMENT_OPS_SAFETY_MESSAGE,
    };
  }
  return {
    ...result,
    ok: true as const,
    externalWriteOccurred: false as const,
    safetyMessage: FULFILLMENT_OPS_SAFETY_MESSAGE,
  };
}

export async function simulateFulfillmentOpsInstruction(instructionId: string) {
  const result = await simulateDeliveryInstruction(instructionId);
  if (!result.ok) {
    return {
      ok: false as const,
      error: result.code,
      reasons: result.reasons,
      simulation: true as const,
      externalWriteOccurred: false as const,
      safetyMessage: FULFILLMENT_OPS_SAFETY_MESSAGE,
    };
  }
  return {
    ...result,
    ok: true as const,
    simulation: true as const,
    externalWriteOccurred: false as const,
    liveWriteOccurred: false as const,
    safetyMessage: FULFILLMENT_OPS_SAFETY_MESSAGE,
  };
}

export async function buildFulfillmentOpsEvidence(
  allocationId: string,
  db: PrismaClient = prisma
): Promise<FulfillmentOpsEvidence | null> {
  const allocation = await db.leadAllocation.findUnique({
    where: { id: allocationId.trim() },
    include: {
      leadOrder: true,
      deliveryInstructions: {
        include: {
          deliveryTarget: true,
          deliveryAttempts: { orderBy: { attemptNumber: "desc" } },
        },
        orderBy: { sequence: "asc" },
      },
    },
  });
  if (!allocation) return null;

  let simulationAttemptCount = 0;
  let simulationSucceededCount = 0;
  let simulationFailedCount = 0;
  let liveAttemptCount = 0;

  const instructions = [];
  for (const instruction of allocation.deliveryInstructions) {
    const attempts = instruction.deliveryAttempts.length
      ? instruction.deliveryAttempts
      : await listDeliveryAttemptsForInstruction(instruction.id, db);

    for (const attempt of attempts) {
      if (attempt.executionMode === "live") liveAttemptCount += 1;
      if (attempt.executionMode === "simulation") {
        simulationAttemptCount += 1;
        if (attempt.status === "succeeded") simulationSucceededCount += 1;
        if (
          attempt.status === "terminal_failure" ||
          attempt.status === "retryable_failure" ||
          attempt.status === "unknown_outcome"
        ) {
          simulationFailedCount += 1;
        }
      }
    }

    const latest = attempts[0] ?? null;
    instructions.push({
      id: instruction.id,
      status: instruction.status,
      adapterKey: instruction.deliveryTarget.adapterKey,
      isRequired: instruction.isRequired,
      attemptCount: attempts.length,
      latestAttempt: latest
        ? {
            id: latest.id,
            attemptNumber: latest.attemptNumber,
            status: latest.status,
            executionMode: latest.executionMode,
            startedAt: latest.startedAt?.toISOString() ?? null,
            completedAt: latest.completedAt?.toISOString() ?? null,
            errorCode: latest.errorCode,
            errorSummary: latest.errorSummary,
          }
        : null,
    });
  }

  return {
    allocationId: allocation.id,
    allocationStatus: allocation.status,
    reservedAt: allocation.reservedAt?.toISOString() ?? null,
    committedAt: allocation.committedAt?.toISOString() ?? null,
    leadOrderId: allocation.leadOrderId,
    orderNumber: allocation.leadOrder.orderNumber,
    orderCounters: {
      requestedQuantity: allocation.leadOrder.requestedQuantity,
      proposedQuantity: allocation.leadOrder.proposedQuantity,
      reservedQuantity: allocation.leadOrder.reservedQuantity,
      fulfilledQuantity: allocation.leadOrder.fulfilledQuantity,
    },
    instructions,
    simulationAttemptCount,
    simulationSucceededCount,
    simulationFailedCount,
    liveAttemptCount,
    externalWriteOccurred: liveAttemptCount > 0,
    safetyMessage: FULFILLMENT_OPS_SAFETY_MESSAGE,
  };
}
