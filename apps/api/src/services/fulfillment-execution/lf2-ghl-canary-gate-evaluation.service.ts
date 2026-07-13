import type { ClientGhlDestination, DeliveryAttempt, PrismaClient } from "@prisma/client";
import {
  FULFILLMENT_ELIGIBILITY_POLICY_KEY,
  FULFILLMENT_ELIGIBILITY_POLICY_VERSION,
  FULFILLMENT_SUPPORTED_FULFILLMENT_MODES,
  FULFILLMENT_SUPPORTED_ORDER_KINDS,
} from "@sa360/shared";

import { getGhlDeliveryAdapterMode } from "../../lib/ghl-delivery-adapter-mode.js";
import {
  evaluateLf2GhlCanaryAllowlists,
  getLf2GhlAllowedClientIds,
  getLf2GhlAllowedLocationIds,
  getLf2GhlAllowedOrderIds,
  getLf2GhlAllowedSourceLanes,
  isLf2ExecutionEnabled,
  isLf2GhlCanaryEnabled,
  LF2_EXECUTION_ENABLED_ENV,
  LF2_GHL_ALLOWED_CLIENT_IDS_ENV,
  LF2_GHL_ALLOWED_LOCATION_IDS_ENV,
  LF2_GHL_ALLOWED_ORDER_IDS_ENV,
  LF2_GHL_ALLOWED_SOURCE_LANES_ENV,
  LF2_GHL_CANARY_ENABLED_ENV,
} from "../../lib/lf2-ghl-canary-config.js";
import { prisma } from "../../lib/db.js";
import { assertLiveDeliveryAllowed, LiveDeliveryNotAllowedError } from "../delivery-guard.js";
import {
  applyDestinationFieldMappingToReadinessInput,
  clientDestinationFieldMappingFromDest,
} from "../delivery-readiness-admin.present.js";
import type { DeliveryReadinessRuleInput } from "../delivery-readiness.service.js";
import { warmEffectiveDeliveryAdapterMode } from "../delivery-runtime-mode.service.js";
import { findLeadEligibilityAssessment } from "../../repositories/lead-eligibility.repository.js";
import { getLeadProofByLeadUid, getLeadVerificationResultByLeadUid } from "../../repositories/lead-proof.repository.js";
import { evaluateLeadEligibility } from "../fulfillment-shadow/eligibility.service.js";
import { getLiveCanaryContactIdentityPreview } from "../ghl-delivery-adapter/ghl-live-canary-gates.service.js";
import {
  CLAIMABLE_INSTRUCTION_STATUSES,
  EXECUTABLE_ALLOCATION_STATUSES,
  EXECUTION_MODE_LIVE,
} from "./fulfillment-execution.constants.js";
import { resolveAuthoritativeGhlDestination } from "./lf2-destination-resolution.service.js";
import { buildLf2GhlAdapterContext, loadLf2GhlInstructionBundle } from "./lf2-ghl-plan-context.service.js";
import { resolveCanonicalSourceLane } from "./lf2-source-lane.service.js";
import type { Lf2ExecutionPosture } from "./fulfillment-execution.types.js";

export type Lf2AllowlistGateResults = {
  executionEnabled: boolean;
  ghlCanaryEnabled: boolean;
  client: { configured: boolean; allowed: boolean };
  location: { configured: boolean; allowed: boolean };
  order: { configured: boolean; allowed: boolean };
  sourceLane: { configured: boolean; allowed: boolean; resolvedLane: string | null };
};

export type Lf2GhlCanaryGateEvaluation = {
  canExecute: boolean;
  blockers: string[];
  warnings: string[];
  adapterMode: string;
  adapterKey: string | null;
  executionMode: "live";
  clientAccountId: string | null;
  authoritativeLocationId: string | null;
  leadOrderId: string | null;
  canonicalSourceLane: string | null;
  allocationStatus: string | null;
  instructionStatus: string | null;
  instructionRequired: boolean;
  targetEnabled: boolean | null;
  targetReadinessStatus: string | null;
  destinationMismatch: boolean;
  eligibilityStatus: string | null;
  eligibilityPolicyVersion: string | null;
  proofPolicyResult: Record<string, unknown> | null;
  existingLiveAttempt: {
    id: string;
    status: string;
    attemptNumber: number;
  } | null;
  runtime: {
    effectiveMode: string;
    maxAllowedMode: string;
    canRunLiveCanary: boolean;
    liveCanaryEnabledUntil: string | null;
    expired: boolean;
  };
  allowlists: Lf2AllowlistGateResults;
  executionPosture: Lf2ExecutionPosture;
};

function withinFulfillmentCycle(
  order: { fulfillmentCycleStart: Date | null; fulfillmentCycleEnd: Date | null },
  at: Date
): boolean {
  if (!order.fulfillmentCycleStart && !order.fulfillmentCycleEnd) return true;
  if (order.fulfillmentCycleStart && at < order.fulfillmentCycleStart) return false;
  if (order.fulfillmentCycleEnd && at > order.fulfillmentCycleEnd) return false;
  return true;
}

function lf2DestinationToReadinessInput(input: {
  clientAccountId: string;
  clientDisplayName: string | null;
  destinationSubaccountIdGhl: string;
  destination: ClientGhlDestination;
}): DeliveryReadinessRuleInput {
  const mapping = clientDestinationFieldMappingFromDest(input.destination);
  const base: DeliveryReadinessRuleInput = {
    id: `lf2:${input.clientAccountId}`,
    masterClientAccountId: input.clientAccountId,
    clientAccountId: input.clientAccountId,
    clientDisplayName: input.clientDisplayName,
    destinationSubaccountIdGhl: input.destinationSubaccountIdGhl,
    destinationWorkflowIdGhl: input.destination.destinationWorkflowIdGhl,
    destinationPipelineIdGhl: input.destination.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: input.destination.destinationPipelineStageIdGhl,
    defaultAssignedUserIdGhl: input.destination.defaultAssignedUserIdGhl,
    backupSheetEnabled: false,
    backupSheetId: null,
    ghlConnectionStatus: input.destination.ghlConnectionStatus,
    snapshotInstalled: input.destination.snapshotInstalled,
    requiredFieldsInstalled: input.destination.requiredFieldsInstalled,
    deliveryMode: input.destination.deliveryMode,
    deliveryEnabled: input.destination.deliveryEnabled,
    clientCutoverApproved: input.destination.clientCutoverApproved,
    internalApprovalStatus: input.destination.internalApprovalStatus,
    opportunityCreationEnabled: input.destination.opportunityCreationEnabled,
    active: true,
  };
  return applyDestinationFieldMappingToReadinessInput(base, mapping);
}

function buildAllowlistResults(input: {
  clientAccountId: string;
  locationIdGhl: string;
  leadOrderId: string;
  sourceLane: string;
}): Lf2AllowlistGateResults {
  const clientAllowlist = getLf2GhlAllowedClientIds();
  const locationAllowlist = getLf2GhlAllowedLocationIds();
  const orderAllowlist = getLf2GhlAllowedOrderIds();
  const sourceLaneAllowlist = getLf2GhlAllowedSourceLanes();
  return {
    executionEnabled: isLf2ExecutionEnabled(),
    ghlCanaryEnabled: isLf2GhlCanaryEnabled(),
    client: {
      configured: clientAllowlist !== null,
      allowed: clientAllowlist?.includes(input.clientAccountId.trim()) ?? false,
    },
    location: {
      configured: locationAllowlist !== null,
      allowed: locationAllowlist?.includes(input.locationIdGhl.trim()) ?? false,
    },
    order: {
      configured: orderAllowlist !== null,
      allowed: orderAllowlist?.includes(input.leadOrderId.trim()) ?? false,
    },
    sourceLane: {
      configured: sourceLaneAllowlist !== null,
      allowed: sourceLaneAllowlist?.includes(input.sourceLane.trim()) ?? false,
      resolvedLane: input.sourceLane,
    },
  };
}

function deriveExecutionPosture(attempts: DeliveryAttempt[]): Lf2ExecutionPosture {
  const liveAttempts = attempts.filter((row) => row.executionMode === EXECUTION_MODE_LIVE);
  if (liveAttempts.some((row) => row.status === "unknown_outcome")) {
    return "reconciliation_required";
  }
  if (liveAttempts.some((row) => row.status === "succeeded")) {
    return "blocked_replay";
  }
  if (liveAttempts.some((row) => row.status === "claimed" || row.status === "in_progress")) {
    return "active_execution";
  }
  return "first_execution";
}

export async function evaluateLf2GhlCanaryGates(
  deliveryInstructionId: string,
  db: PrismaClient = prisma,
  at = new Date()
): Promise<Lf2GhlCanaryGateEvaluation | { notFound: true }> {
  const bundle = await loadLf2GhlInstructionBundle(deliveryInstructionId, db);
  if (!bundle) return { notFound: true };

  const blockers: string[] = [];
  const warnings: string[] = [];
  const runtime = await warmEffectiveDeliveryAdapterMode();
  const adapterMode = getGhlDeliveryAdapterMode();

  const { instruction, client, destination, order, sourceLeadEvent } = bundle;
  const canonicalSourceLane = resolveCanonicalSourceLane(sourceLeadEvent);
  if (!canonicalSourceLane) {
    blockers.push("Canonical source lane could not be resolved.");
  }

  const liveAttempts = await db.deliveryAttempt.findMany({
    where: { deliveryInstructionId: instruction.id, executionMode: EXECUTION_MODE_LIVE },
    orderBy: { attemptNumber: "desc" },
  });
  const existingLiveAttempt = liveAttempts[0]
    ? {
        id: liveAttempts[0].id,
        status: liveAttempts[0].status,
        attemptNumber: liveAttempts[0].attemptNumber,
      }
    : null;
  const executionPosture = deriveExecutionPosture(liveAttempts);

  let authoritativeLocationId: string | null = null;
  let destinationMismatch = false;
  let allowlists: Lf2AllowlistGateResults = {
    executionEnabled: false,
    ghlCanaryEnabled: false,
    client: { configured: false, allowed: false },
    location: { configured: false, allowed: false },
    order: { configured: false, allowed: false },
    sourceLane: { configured: false, allowed: false, resolvedLane: canonicalSourceLane },
  };

  let eligibilityStatus: string | null = null;
  let eligibilityPolicyVersion: string | null = null;
  let proofPolicyResult: Record<string, unknown> | null = null;

  if (!client) {
    blockers.push("Client account not found.");
  }
  if (!destination) {
    blockers.push("Client GHL destination is not configured.");
  }

  if (destination) {
    const resolvedDestination = resolveAuthoritativeGhlDestination({
      clientDestination: destination,
      targetConfigMetadataJson: instruction.deliveryTarget.configMetadataJson,
    });
    if (!resolvedDestination.ok) {
      if (resolvedDestination.code === "delivery_target_destination_mismatch") {
        destinationMismatch = true;
        blockers.push("delivery_target_destination_mismatch");
      } else {
        blockers.push("destination_not_configured");
      }
    } else {
      authoritativeLocationId = resolvedDestination.authoritativeLocationId;
    }
  }

  if (instruction.deliveryTarget.adapterKey !== "ghl.crm.v1") {
    blockers.push("Instruction delivery target is not ghl.crm.v1.");
  }

  if (!instruction.isRequired) {
    blockers.push("Optional delivery instructions cannot trigger commercial LF2 completion.");
  }

  if (!instruction.deliveryTarget.enabled) {
    blockers.push("DeliveryTarget is disabled.");
  }

  const targetReadiness = instruction.deliveryTarget.readinessStatus;
  if (targetReadiness === "not_configured" || targetReadiness === "blocked") {
    blockers.push(`DeliveryTarget readiness is ${targetReadiness}.`);
  }

  if (!(CLAIMABLE_INSTRUCTION_STATUSES as readonly string[]).includes(instruction.status)) {
    if (instruction.status !== "executing") {
      blockers.push(`Instruction status ${instruction.status} is not executable.`);
    }
  }

  const allocationStatus = instruction.leadAllocation.status;
  if (!(EXECUTABLE_ALLOCATION_STATUSES as readonly string[]).includes(allocationStatus)) {
    blockers.push(`Allocation status ${allocationStatus} is not executable.`);
  }

  if (order.status !== "active" || order.canceledAt || order.completedAt || order.pausedAt) {
    blockers.push(`Lead order status ${order.status} is not active.`);
  }

  if (
    order.orderKind &&
    !(FULFILLMENT_SUPPORTED_ORDER_KINDS as readonly string[]).includes(order.orderKind)
  ) {
    blockers.push("Order kind is not supported for LF2 execution.");
  }

  if (
    order.fulfillmentMode &&
    !(FULFILLMENT_SUPPORTED_FULFILLMENT_MODES as readonly string[]).includes(order.fulfillmentMode)
  ) {
    blockers.push("Fulfillment mode is not supported for LF2 execution.");
  }

  if (!withinFulfillmentCycle(order, at)) {
    blockers.push("Lead order is outside its active fulfillment cycle.");
  }

  if (!runtime.canRunLiveCanary || runtime.expired) {
    blockers.push(
      `Effective delivery adapter mode must be live_canary and unexpired (max: ${runtime.maxAllowedMode}, effective: ${runtime.effectiveMode}). ${runtime.reason}`
    );
  }

  if (client && authoritativeLocationId) {
    allowlists = buildAllowlistResults({
      clientAccountId: client.clientAccountId,
      locationIdGhl: authoritativeLocationId,
      leadOrderId: order.id,
      sourceLane: canonicalSourceLane,
    });
    const allowlist = evaluateLf2GhlCanaryAllowlists({
      clientAccountId: client.clientAccountId,
      locationIdGhl: authoritativeLocationId,
      leadOrderId: order.id,
      sourceLane: canonicalSourceLane,
    });
    blockers.push(...allowlist.blockers);
  } else if (client) {
    allowlists = buildAllowlistResults({
      clientAccountId: client.clientAccountId,
      locationIdGhl: "",
      leadOrderId: order.id,
      sourceLane: canonicalSourceLane,
    });
    blockers.push(`${LF2_GHL_ALLOWED_LOCATION_IDS_ENV} is missing or empty; LF2 GHL canary denied.`);
  }

  const eligibility = await findLeadEligibilityAssessment(
    {
      sourceLeadEventId: sourceLeadEvent.id,
      policyKey: FULFILLMENT_ELIGIBILITY_POLICY_KEY,
      policyVersion: FULFILLMENT_ELIGIBILITY_POLICY_VERSION,
    },
    db
  );
  eligibilityStatus = eligibility?.status ?? null;
  eligibilityPolicyVersion = eligibility?.policyVersion ?? null;
  if (!eligibility || eligibility.status !== "eligible") {
    blockers.push("Lead eligibility assessment is not eligible.");
  }

  const leadProof = sourceLeadEvent.sourceLeadUid
    ? await getLeadProofByLeadUid(sourceLeadEvent.sourceLeadUid, db)
    : null;
  const verification = sourceLeadEvent.sourceLeadUid
    ? await getLeadVerificationResultByLeadUid(sourceLeadEvent.sourceLeadUid, db)
    : null;
  const proofEval = evaluateLeadEligibility({
    sourceLeadEvent,
    leadProof,
    verification,
  });
  proofPolicyResult = proofEval.proofResult;
  if (proofEval.status === "ineligible") {
    blockers.push("Proof policy requirements are not satisfied.");
  } else if (proofEval.status === "review_required") {
    blockers.push("Proof policy requires review before live execution.");
  }

  if (liveAttempts.some((row) => row.status === "succeeded")) {
    blockers.push("A succeeded live attempt already exists for this instruction.");
  }
  if (liveAttempts.some((row) => row.status === "unknown_outcome")) {
    blockers.push("A live attempt with unknown outcome requires reconciliation.");
  }
  const otherActive = liveAttempts.filter(
    (row) => row.status === "claimed" || row.status === "in_progress"
  );
  if (otherActive.length > 1) {
    blockers.push("Multiple active live attempts detected.");
  }

  if (destination && client && authoritativeLocationId) {
    try {
      assertLiveDeliveryAllowed(
        lf2DestinationToReadinessInput({
          clientAccountId: client.clientAccountId,
          clientDisplayName: client.clientDisplayName,
          destinationSubaccountIdGhl: authoritativeLocationId,
          destination,
        })
      );
    } catch (err) {
      if (err instanceof LiveDeliveryNotAllowedError) {
        blockers.push(...err.assessment.blockers);
      } else {
        blockers.push(err instanceof Error ? err.message : String(err));
      }
    }

    const adapterCtx = buildLf2GhlAdapterContext({
      instruction,
      client,
      destination,
      sourceLeadEvent,
      authoritativeLocationId,
    });
    const contactPreview = getLiveCanaryContactIdentityPreview(adapterCtx.plan);
    const missingPhone = contactPreview.missing.includes("phone");
    const missingEmail = contactPreview.missing.includes("email");
    if (missingPhone && missingEmail) {
      blockers.push("Contact phone and email are both missing.");
    }
    if (contactPreview.missing.includes("name")) {
      warnings.push("Contact name is incomplete.");
    }
  }

  if (!isLf2ExecutionEnabled()) {
    blockers.push(`${LF2_EXECUTION_ENABLED_ENV} must be true for LF2 execution.`);
  }
  if (!isLf2GhlCanaryEnabled()) {
    blockers.push(`${LF2_GHL_CANARY_ENABLED_ENV} must be true for LF2 GHL canary.`);
  }

  return {
    canExecute: blockers.length === 0,
    blockers,
    warnings,
    adapterMode,
    adapterKey: instruction.deliveryTarget.adapterKey,
    executionMode: "live",
    clientAccountId: client?.clientAccountId ?? null,
    authoritativeLocationId,
    leadOrderId: order.id,
    canonicalSourceLane,
    allocationStatus,
    instructionStatus: instruction.status,
    instructionRequired: instruction.isRequired,
    targetEnabled: instruction.deliveryTarget.enabled,
    targetReadinessStatus: targetReadiness,
    destinationMismatch,
    eligibilityStatus,
    eligibilityPolicyVersion,
    proofPolicyResult,
    existingLiveAttempt,
    runtime: {
      effectiveMode: runtime.effectiveMode,
      maxAllowedMode: runtime.maxAllowedMode,
      canRunLiveCanary: runtime.canRunLiveCanary,
      liveCanaryEnabledUntil: runtime.liveCanaryEnabledUntil,
      expired: runtime.expired,
    },
    allowlists,
    executionPosture,
  };
}

export type Lf2GhlCanaryPreflightResult = Lf2GhlCanaryGateEvaluation;

export async function evaluateLf2GhlCanaryPreflight(
  deliveryInstructionId: string,
  db: PrismaClient = prisma
): Promise<Lf2GhlCanaryPreflightResult | { notFound: true }> {
  return evaluateLf2GhlCanaryGates(deliveryInstructionId, db);
}

export async function evaluateLf2GhlCanaryWriteBoundaryGates(
  deliveryInstructionId: string,
  db: PrismaClient = prisma
): Promise<Lf2GhlCanaryGateEvaluation | { notFound: true }> {
  return evaluateLf2GhlCanaryGates(deliveryInstructionId, db);
}
