import type { ClientGhlDestination, Prisma, PrismaClient } from "@prisma/client";

import { maskSourceLeadUidForAudit } from "../../lib/identity-fingerprint.js";
import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { prisma } from "../../lib/db.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import {
  createDeliveryTargetRecord,
  presentDeliveryTargetSafe,
  updateDeliveryTargetRecord,
  validateDeliveryTargetMetadata,
} from "../../repositories/delivery-target.repository.js";
import {
  createLf2CheckpointAAuditEvent,
  findAppliedCheckpointACreateByRequestId,
  findAppliedCheckpointARevokeByRequestId,
  findLatestAppliedCheckpointACreateForSourceLead,
} from "../../repositories/lf2-checkpoint-a-audit.repository.js";
import { createLeadOrderRecord, nextLeadOrderNumber } from "../../repositories/lead-order.repository.js";
import { getLeadVerificationResultByLeadUid } from "../../repositories/lead-proof.repository.js";
import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";
import { resolveAuthoritativeGhlDestination } from "../fulfillment-execution/lf2-destination-resolution.service.js";
import { resolveCanonicalSourceLane } from "../fulfillment-execution/lf2-source-lane.service.js";
import { getDeliveryAdapter } from "./delivery-adapter.registry.js";
import {
  buildEligibilityPreviewForSourceLead,
  type EligibilityPreviewPayload,
} from "./eligibility-preview.service.js";

export const LF2_CHECKPOINT_A_CAMPAIGN_TYPE = "lf2_first_canary";
export const LF2_CHECKPOINT_A_DELIVERY_CADENCE = "controlled_manual_canary";
export const LF2_CHECKPOINT_A_CRM_PACKAGE = "ghl_crm_canary";
export const LF2_CHECKPOINT_A_ADAPTER_KEY = "ghl.crm.v1";
export const LF2_CHECKPOINT_A_TARGET_DISPLAY_NAME = "LF2 First Canary GHL Target";
export const LF2_CHECKPOINT_A_FULFILLMENT_PRIORITY = 1000;
export const LF2_CHECKPOINT_A_CYCLE_DAYS = 7;

export type Lf2CheckpointAConfigError =
  | "source_lead_not_found"
  | "source_lead_uid_missing"
  | "malformed_normalized_payload"
  | "client_account_missing"
  | "destination_missing"
  | "destination_mismatch"
  | "identity_missing"
  | "identity_incomplete"
  | "verification_not_passed_unique"
  | "eligibility_not_eligible"
  | "prior_delivery_evidence"
  | "lf2_execution_rows_present"
  | "conflicting_checkpoint_config"
  | "metadata_secret_like"
  | "metadata_validation_failed"
  | "destination_resolution_failed"
  | "checkpoint_config_not_found"
  | "checkpoint_config_not_active"
  | "shadow_processing_started"
  | "preview_not_safe";

export type ProposedLeadOrderFields = {
  orderNumber: string;
  clientAccountId: string;
  clientDisplayName: string | null;
  status: "active";
  nicheKey: string;
  productType: string | null;
  statesJson: string[];
  leadVolume: number;
  deliveryCadence: string;
  campaignType: string;
  crmPackage: string;
  aiVoiceAddon: boolean;
  deliveryDestinationType: string;
  deliveryDestinationLabel: string;
  notes: string;
  adminNotes: string;
  routingRuleId: string | null;
  campaignId: string | null;
  createdByRole: "admin";
  orderKind: "retainer_allocation";
  fulfillmentMode: "campaign_bound";
  requestedQuantity: number;
  fulfillmentCycleStart: string;
  fulfillmentCycleEnd: string;
  allowedSourceLanesJson: string[];
  proofPolicyKey: string;
  exclusivityRequired: boolean;
  fulfillmentPriority: number;
  proposedQuantity: number;
  reservedQuantity: number;
  fulfilledQuantity: number;
};

export type ProposedDeliveryTargetFields = {
  clientAccountId: string;
  displayName: string;
  adapterKey: string;
  enabled: boolean;
  isPrimary: boolean;
  isRequired: boolean;
  readinessStatus: string;
  configMetadataJson: Record<string, unknown>;
};

export type Lf2CheckpointAConfigPreview = {
  sourceLeadEventId: string;
  maskedSourceLeadUid: string | null;
  clientAccountId: string;
  clientDisplayName: string | null;
  authoritativeLocationId: string;
  canonicalSourceLane: string;
  state: string | null;
  nicheKey: string;
  productType: string | null;
  campaignId: string | null;
  routingRuleId: string | null;
  verifiedEligibilitySummary: {
    predictedEligibilityStatus: EligibilityPreviewPayload["predictedEligibilityStatus"];
    predictedReasonCodes: string[];
    duplicateStatus: string | null;
    verificationStatus: string | null;
    verificationPresent: boolean;
  };
  proposedLeadOrder: ProposedLeadOrderFields;
  proposedDeliveryTarget: ProposedDeliveryTargetFields;
  expectedWrites: string[];
  structuralBlockers: string[];
  checkpointACreateSafe: boolean;
  existingLeadOrderId: string | null;
  existingDeliveryTargetId: string | null;
};

export type Lf2CheckpointAConfigPreviewResult =
  | { ok: true; preview: Lf2CheckpointAConfigPreview }
  | { ok: false; error: Lf2CheckpointAConfigError; structuralBlockers: string[] };

export type Lf2CheckpointACreateSuccess = {
  checkpointAStatus: "applied" | "idempotent_replay";
  sourceLeadEventId: string;
  maskedSourceLeadUid: string | null;
  clientAccountId: string;
  authoritativeLocationId: string;
  leadOrderId: string;
  leadOrderNumber: string;
  deliveryTargetId: string;
  previousLeadOrderStatus: string | null;
  previousDeliveryTargetEnabled: boolean | null;
  auditEventId: string;
  postCreatePreview: Lf2CheckpointAConfigPreview;
  shadowEnqueueOccurred: false;
  lf2ExecutionRowsCreated: false;
};

export type Lf2CheckpointACreateResult =
  | { ok: true } & Lf2CheckpointACreateSuccess
  | { ok: false; error: Lf2CheckpointAConfigError; auditEventId?: string; structuralBlockers?: string[] };

export type Lf2CheckpointARevokeSuccess = {
  revocationStatus: "applied" | "idempotent_replay";
  sourceLeadEventId: string;
  maskedSourceLeadUid: string | null;
  clientAccountId: string;
  authoritativeLocationId: string;
  leadOrderId: string;
  leadOrderNumber: string;
  deliveryTargetId: string;
  auditEventId: string;
  postRevocationPreview: Lf2CheckpointAConfigPreview;
};

export type Lf2CheckpointARevokeResult =
  | { ok: true } & Lf2CheckpointARevokeSuccess
  | { ok: false; error: Lf2CheckpointAConfigError; auditEventId?: string };

export type Lf2CheckpointAConfigInput = {
  sourceLeadEventId: string;
  requestedBy?: string | null;
  requestId?: string | null;
  operatorNote?: string | null;
};

export type Lf2CheckpointAConfigDeps = {
  findSourceLeadEventById?: typeof findSourceLeadEventById;
  findClientAccountById?: typeof findClientAccountById;
  buildEligibilityPreview?: typeof buildEligibilityPreviewForSourceLead;
  nextLeadOrderNumber?: typeof nextLeadOrderNumber;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeState(value: string | null): string | null {
  if (!value?.trim()) return null;
  return value.trim();
}

function checkpointAAdminNotes(sourceLeadEventId: string): string {
  return `LF2 Checkpoint A first canary configuration only. sourceLeadEventId=${sourceLeadEventId}`;
}

function hasPriorDeliveryEvidence(event: {
  deliveredAt: Date | null;
  deliveryResultJson: unknown;
}): boolean {
  if (event.deliveredAt) return true;
  const delivery = asRecord(event.deliveryResultJson);
  if (!delivery) return false;
  if (delivery.externalCallExecuted === true) return true;
  const mode = typeof delivery.mode === "string" ? delivery.mode.trim().toLowerCase() : "";
  if (mode === "live_canary" || mode === "live") return true;
  if (typeof delivery.contactIdGhl === "string" && delivery.contactIdGhl.trim()) return true;
  return false;
}

async function hasLf2ExecutionRows(sourceLeadEventId: string, db: PrismaClient): Promise<boolean> {
  const [eligibility, outbox, allocation, instruction, attempt] = await Promise.all([
    db.leadEligibilityAssessment.count({ where: { sourceLeadEventId } }),
    db.fulfillmentOutbox.count({ where: { sourceLeadEventId } }),
    db.leadAllocation.count({ where: { sourceLeadEventId } }),
    db.deliveryInstruction.count({
      where: { leadAllocation: { sourceLeadEventId } },
    }),
    db.deliveryAttempt.count({
      where: { deliveryInstruction: { leadAllocation: { sourceLeadEventId } } },
    }),
  ]);
  return eligibility + outbox + allocation + instruction + attempt > 0;
}

async function deriveCommercialFields(
  event: {
    routingRuleIdResolved: string | null;
    sourceCampaignId: string | null;
    sourceType: string;
  },
  db: PrismaClient
) {
  let nicheKey = "lf2_first_canary";
  let productType: string | null = event.sourceType ?? null;
  let routingRuleId = event.routingRuleIdResolved?.trim() || null;
  let campaignId = event.sourceCampaignId?.trim() || null;

  if (routingRuleId) {
    const rule = await db.campaignRoutingRule.findUnique({ where: { id: routingRuleId } });
    if (rule) {
      nicheKey = rule.nicheKey?.trim() || nicheKey;
      productType = rule.productType?.trim() || productType;
      campaignId = rule.campaignId?.trim() || campaignId;
    }
  }

  return { nicheKey, productType, routingRuleId, campaignId };
}

function buildProposedDeliveryTargetMetadata(authoritativeLocationId: string): Record<string, unknown> {
  return {
    destinationSubaccountIdGhl: authoritativeLocationId,
    checkpointAVersion: "1",
    purpose: "lf2_first_canary",
  };
}

function validateProposedDeliveryTargetMetadata(
  metadata: Record<string, unknown>,
  clientDestination: {
    destinationSubaccountIdGhl: string;
    locationName?: string | null;
  }
):
  | { ok: true; readinessStatus: string }
  | { ok: false; error: Lf2CheckpointAConfigError } {
  const metadataValidation = validateDeliveryTargetMetadata(metadata);
  if (!metadataValidation.ok) {
    return { ok: false, error: "metadata_secret_like" };
  }

  const destinationResolution = resolveAuthoritativeGhlDestination({
    clientDestination: clientDestination as ClientGhlDestination,
    targetConfigMetadataJson: metadata,
  });
  if (!destinationResolution.ok) {
    return { ok: false, error: "destination_resolution_failed" };
  }

  const adapter = getDeliveryAdapter(LF2_CHECKPOINT_A_ADAPTER_KEY);
  if (!adapter) {
    return { ok: false, error: "metadata_validation_failed" };
  }
  const adapterValidation = adapter.validateTarget({ configMetadata: metadata });
  if (!adapterValidation.ok) {
    return { ok: false, error: "metadata_validation_failed" };
  }

  return { ok: true, readinessStatus: adapterValidation.readinessStatus };
}

async function loadCheckpointAContext(
  sourceLeadEventId: string,
  db: PrismaClient,
  deps: Lf2CheckpointAConfigDeps
) {
  const findEvent = deps.findSourceLeadEventById ?? findSourceLeadEventById;
  const findClient = deps.findClientAccountById ?? findClientAccountById;
  const buildPreview = deps.buildEligibilityPreview ?? buildEligibilityPreviewForSourceLead;

  const event = await findEvent(sourceLeadEventId, db);
  if (!event) return { ok: false as const, error: "source_lead_not_found" as const };

  const leadUid = event.sourceLeadUid?.trim() || null;
  if (!leadUid) return { ok: false as const, error: "source_lead_uid_missing" as const };

  if (event.normalizedPayloadJson !== null && readNormalizedLeadIdentity(event.normalizedPayloadJson) === null) {
    return { ok: false as const, error: "malformed_normalized_payload" as const };
  }

  const clientAccountId = event.clientAccountIdResolved?.trim() || null;
  if (!clientAccountId) return { ok: false as const, error: "client_account_missing" as const };

  const client = await findClient(clientAccountId, db);
  if (!client?.ghlDestination?.destinationSubaccountIdGhl?.trim()) {
    return { ok: false as const, error: "destination_missing" as const };
  }

  const authoritativeLocationId = client.ghlDestination.destinationSubaccountIdGhl.trim();
  const resolvedDestination = event.destinationLocationIdResolved?.trim() || null;
  if (resolvedDestination && resolvedDestination !== authoritativeLocationId) {
    return { ok: false as const, error: "destination_mismatch" as const };
  }

  const identity = readNormalizedLeadIdentity(event.normalizedPayloadJson);
  const phone = identity?.phoneE164 ?? null;
  const email = identity?.email ?? null;
  const state = normalizeState(identity?.state ?? null);
  if (!phone && !email) return { ok: false as const, error: "identity_missing" as const };
  if (!phone || !email || !state) return { ok: false as const, error: "identity_incomplete" as const };

  const verification = await getLeadVerificationResultByLeadUid(leadUid, db);
  if (verification?.verificationStatus !== "PASSED" || verification.duplicateStatus !== "UNIQUE") {
    return { ok: false as const, error: "verification_not_passed_unique" as const };
  }

  const previewResult = await buildPreview(event.id, db);
  if (!previewResult.ok) return { ok: false as const, error: "source_lead_not_found" as const };
  if (
    previewResult.preview.predictedEligibilityStatus !== "eligible" ||
    previewResult.preview.predictedReasonCodes.length > 0
  ) {
    return { ok: false as const, error: "eligibility_not_eligible" as const };
  }

  return {
    ok: true as const,
    event,
    leadUid,
    client,
    clientAccountId,
    authoritativeLocationId,
    identity,
    phone,
    email,
    state,
    verification,
    eligibilityPreview: previewResult.preview,
  };
}

export async function buildLf2CheckpointAConfigPreviewForSourceLead(
  sourceLeadEventId: string,
  db: PrismaClient = prisma,
  deps: Lf2CheckpointAConfigDeps = {}
): Promise<Lf2CheckpointAConfigPreviewResult> {
  const context = await loadCheckpointAContext(sourceLeadEventId, db, deps);
  const structuralBlockers: string[] = [];
  if (!context.ok) {
    structuralBlockers.push(context.error);
    return { ok: false, error: context.error, structuralBlockers };
  }

  const {
    event,
    leadUid,
    client,
    clientAccountId,
    authoritativeLocationId,
    state,
    eligibilityPreview,
  } = context;

  if (hasPriorDeliveryEvidence(event)) structuralBlockers.push("prior_delivery_evidence");
  if (await hasLf2ExecutionRows(event.id, db)) structuralBlockers.push("lf2_execution_rows_present");

  const existingCreateAudit = await findLatestAppliedCheckpointACreateForSourceLead(event.id, db);
  let existingLeadOrderId: string | null = existingCreateAudit?.leadOrderId ?? null;
  let existingDeliveryTargetId: string | null = existingCreateAudit?.deliveryTargetId ?? null;

  if (existingCreateAudit?.leadOrderId) {
    const existingOrder = await db.leadOrder.findUnique({ where: { id: existingCreateAudit.leadOrderId } });
    if (existingOrder?.status === "active" && !existingOrder.canceledAt) {
      structuralBlockers.push("existing_checkpoint_config");
    }
  }

  const conflictingTargets = await db.deliveryTarget.findMany({
    where: {
      clientAccountId,
      enabled: true,
      adapterKey: LF2_CHECKPOINT_A_ADAPTER_KEY,
      isRequired: true,
      ...(existingDeliveryTargetId ? { id: { not: existingDeliveryTargetId } } : {}),
    },
  });
  if (conflictingTargets.length > 0) structuralBlockers.push("conflicting_delivery_target");

  const conflictingOrders = await db.leadOrder.findMany({
    where: {
      clientAccountId,
      campaignType: LF2_CHECKPOINT_A_CAMPAIGN_TYPE,
      status: "active",
      canceledAt: null,
      ...(existingLeadOrderId ? { id: { not: existingLeadOrderId } } : {}),
    },
  });
  if (conflictingOrders.length > 0) structuralBlockers.push("conflicting_checkpoint_order");

  const commercial = await deriveCommercialFields(event, db);
  const canonicalSourceLane = resolveCanonicalSourceLane(event);
  const nextNumber = deps.nextLeadOrderNumber ?? nextLeadOrderNumber;
  const orderNumber = await nextNumber(db);
  const now = new Date();
  const cycleEnd = new Date(now.getTime() + LF2_CHECKPOINT_A_CYCLE_DAYS * 24 * 60 * 60 * 1000);
  const proposedMetadata = buildProposedDeliveryTargetMetadata(authoritativeLocationId);
  const metadataValidation = validateProposedDeliveryTargetMetadata(proposedMetadata, client.ghlDestination!);
  if (!metadataValidation.ok) structuralBlockers.push(metadataValidation.error);

  const destinationLabel =
    client.ghlDestination!.locationName?.trim() ||
    `GHL location ${authoritativeLocationId.slice(0, 4)}***${authoritativeLocationId.slice(-4)}`;

  const proposedLeadOrder: ProposedLeadOrderFields = {
    orderNumber,
    clientAccountId,
    clientDisplayName: client.clientDisplayName ?? null,
    status: "active",
    nicheKey: commercial.nicheKey,
    productType: commercial.productType,
    statesJson: [state!],
    leadVolume: 1,
    deliveryCadence: LF2_CHECKPOINT_A_DELIVERY_CADENCE,
    campaignType: LF2_CHECKPOINT_A_CAMPAIGN_TYPE,
    crmPackage: LF2_CHECKPOINT_A_CRM_PACKAGE,
    aiVoiceAddon: false,
    deliveryDestinationType: "ghl",
    deliveryDestinationLabel: destinationLabel,
    notes: "LF2 first canary configuration order.",
    adminNotes: checkpointAAdminNotes(event.id),
    routingRuleId: commercial.routingRuleId,
    campaignId: commercial.campaignId,
    createdByRole: "admin",
    orderKind: "retainer_allocation",
    fulfillmentMode: "campaign_bound",
    requestedQuantity: 1,
    fulfillmentCycleStart: now.toISOString(),
    fulfillmentCycleEnd: cycleEnd.toISOString(),
    allowedSourceLanesJson: [canonicalSourceLane],
    proofPolicyKey: eligibilityPreview.resolvedProofPolicy,
    exclusivityRequired: true,
    fulfillmentPriority: LF2_CHECKPOINT_A_FULFILLMENT_PRIORITY,
    proposedQuantity: 0,
    reservedQuantity: 0,
    fulfilledQuantity: 0,
  };

  const proposedDeliveryTarget: ProposedDeliveryTargetFields = {
    clientAccountId,
    displayName: LF2_CHECKPOINT_A_TARGET_DISPLAY_NAME,
    adapterKey: LF2_CHECKPOINT_A_ADAPTER_KEY,
    enabled: true,
    isPrimary: true,
    isRequired: true,
    readinessStatus: metadataValidation.ok ? metadataValidation.readinessStatus : "not_configured",
    configMetadataJson: proposedMetadata,
  };

  const preview: Lf2CheckpointAConfigPreview = {
    sourceLeadEventId: event.id,
    maskedSourceLeadUid: maskSourceLeadUidForAudit(leadUid),
    clientAccountId,
    clientDisplayName: client.clientDisplayName ?? null,
    authoritativeLocationId,
    canonicalSourceLane,
    state,
    nicheKey: commercial.nicheKey,
    productType: commercial.productType,
    campaignId: commercial.campaignId,
    routingRuleId: commercial.routingRuleId,
    verifiedEligibilitySummary: {
      predictedEligibilityStatus: eligibilityPreview.predictedEligibilityStatus,
      predictedReasonCodes: eligibilityPreview.predictedReasonCodes,
      duplicateStatus: eligibilityPreview.duplicateStatus,
      verificationStatus: eligibilityPreview.verificationStatus,
      verificationPresent: eligibilityPreview.verificationPresent,
    },
    proposedLeadOrder,
    proposedDeliveryTarget,
    expectedWrites: ["LeadOrder", "DeliveryTarget", "Lf2CheckpointAAuditEvent"],
    structuralBlockers,
    checkpointACreateSafe: structuralBlockers.length === 0,
    existingLeadOrderId,
    existingDeliveryTargetId,
  };

  return { ok: true, preview };
}

async function recordRejectedCheckpointAAudit(input: {
  db: PrismaClient;
  sourceLeadEventId: string;
  leadUid: string;
  clientAccountId: string;
  destinationSubaccountIdGhl: string;
  actionType: "CREATE_CONFIG" | "REVOKE_CONFIG";
  error: Lf2CheckpointAConfigError;
  requestedBy?: string | null;
  requestId?: string | null;
  operatorNote?: string | null;
  leadOrderId?: string | null;
  deliveryTargetId?: string | null;
}) {
  return createLf2CheckpointAAuditEvent(
    {
      sourceLeadEventId: input.sourceLeadEventId,
      sourceLeadUidMasked: maskSourceLeadUidForAudit(input.leadUid),
      clientAccountId: input.clientAccountId,
      destinationSubaccountIdGhl: input.destinationSubaccountIdGhl,
      leadOrderId: input.leadOrderId ?? null,
      deliveryTargetId: input.deliveryTargetId ?? null,
      actionType: input.actionType,
      checkpointAStatus: "rejected",
      requestedBy: input.requestedBy ?? null,
      requestId: input.requestId ?? null,
      reasonsJson: {
        error: input.error,
        operatorNote: input.operatorNote ?? null,
      },
    },
    input.db
  );
}

export async function createLf2CheckpointAConfigForSourceLead(
  input: Lf2CheckpointAConfigInput,
  db: PrismaClient = prisma,
  deps: Lf2CheckpointAConfigDeps = {}
): Promise<Lf2CheckpointACreateResult> {
  const sourceLeadEventId = input.sourceLeadEventId.trim();
  const requestId = input.requestId?.trim() || null;

  const previewResult = await buildLf2CheckpointAConfigPreviewForSourceLead(sourceLeadEventId, db, deps);
  if (!previewResult.ok) {
    return {
      ok: false,
      error: previewResult.error,
      structuralBlockers: previewResult.structuralBlockers,
    };
  }

  const preview = previewResult.preview;

  if (requestId) {
    const priorAudit = await findAppliedCheckpointACreateByRequestId(requestId, db);
    if (
      priorAudit &&
      priorAudit.sourceLeadEventId === sourceLeadEventId &&
      priorAudit.clientAccountId === preview.clientAccountId &&
      priorAudit.destinationSubaccountIdGhl === preview.authoritativeLocationId &&
      priorAudit.leadOrderId &&
      priorAudit.deliveryTargetId
    ) {
      const postCreatePreview = await buildLf2CheckpointAConfigPreviewForSourceLead(sourceLeadEventId, db, deps);
      if (!postCreatePreview.ok) return { ok: false, error: postCreatePreview.error };
      const order = await db.leadOrder.findUnique({ where: { id: priorAudit.leadOrderId } });
      if (!order) return { ok: false, error: "checkpoint_config_not_found" };
      return {
        ok: true,
        checkpointAStatus: "idempotent_replay",
        sourceLeadEventId,
        maskedSourceLeadUid: preview.maskedSourceLeadUid,
        clientAccountId: preview.clientAccountId,
        authoritativeLocationId: preview.authoritativeLocationId,
        leadOrderId: priorAudit.leadOrderId,
        leadOrderNumber: order.orderNumber,
        deliveryTargetId: priorAudit.deliveryTargetId,
        previousLeadOrderStatus: order.status,
        previousDeliveryTargetEnabled: true,
        auditEventId: priorAudit.id,
        postCreatePreview: postCreatePreview.preview,
        shadowEnqueueOccurred: false,
        lf2ExecutionRowsCreated: false,
      };
    }
  }

  const existingAudit = await findLatestAppliedCheckpointACreateForSourceLead(sourceLeadEventId, db);
  if (existingAudit?.leadOrderId && existingAudit.deliveryTargetId) {
    const existingOrder = await db.leadOrder.findUnique({ where: { id: existingAudit.leadOrderId } });
    const existingTarget = await db.deliveryTarget.findUnique({ where: { id: existingAudit.deliveryTargetId } });
    if (
      existingOrder?.status === "active" &&
      !existingOrder.canceledAt &&
      existingTarget?.enabled
    ) {
      const postCreatePreview = await buildLf2CheckpointAConfigPreviewForSourceLead(sourceLeadEventId, db, deps);
      if (!postCreatePreview.ok) return { ok: false, error: postCreatePreview.error };
      return {
        ok: true,
        checkpointAStatus: "idempotent_replay",
        sourceLeadEventId,
        maskedSourceLeadUid: preview.maskedSourceLeadUid,
        clientAccountId: preview.clientAccountId,
        authoritativeLocationId: preview.authoritativeLocationId,
        leadOrderId: existingAudit.leadOrderId,
        leadOrderNumber: existingOrder.orderNumber,
        deliveryTargetId: existingAudit.deliveryTargetId,
        previousLeadOrderStatus: existingOrder.status,
        previousDeliveryTargetEnabled: existingTarget.enabled,
        auditEventId: existingAudit.id,
        postCreatePreview: postCreatePreview.preview,
        shadowEnqueueOccurred: false,
        lf2ExecutionRowsCreated: false,
      };
    }
  }

  if (!preview.checkpointACreateSafe) {
    return {
      ok: false,
      error: "preview_not_safe",
      structuralBlockers: preview.structuralBlockers,
    };
  }

  const proposed = preview.proposedLeadOrder;
  const proposedTarget = preview.proposedDeliveryTarget;
  const now = new Date();

  const result = await db.$transaction(async (tx) => {
    const txDb = tx as PrismaClient;
    const order = await createLeadOrderRecord(
      {
        orderNumber: proposed.orderNumber,
        clientAccountId: proposed.clientAccountId,
        clientDisplayName: proposed.clientDisplayName,
        status: proposed.status,
        nicheKey: proposed.nicheKey,
        productType: proposed.productType,
        statesJson: proposed.statesJson,
        leadVolume: proposed.leadVolume,
        deliveryCadence: proposed.deliveryCadence,
        campaignType: proposed.campaignType,
        crmPackage: proposed.crmPackage,
        aiVoiceAddon: proposed.aiVoiceAddon,
        deliveryDestinationType: proposed.deliveryDestinationType,
        deliveryDestinationLabel: proposed.deliveryDestinationLabel,
        notes: proposed.notes,
        adminNotes: proposed.adminNotes,
        routingRuleId: proposed.routingRuleId,
        campaignId: proposed.campaignId,
        createdByRole: proposed.createdByRole,
        submittedAt: now,
        approvedAt: now,
        activatedAt: now,
        orderKind: proposed.orderKind,
        fulfillmentMode: proposed.fulfillmentMode,
        requestedQuantity: proposed.requestedQuantity,
        fulfillmentCycleStart: new Date(proposed.fulfillmentCycleStart),
        fulfillmentCycleEnd: new Date(proposed.fulfillmentCycleEnd),
        allowedSourceLanesJson: proposed.allowedSourceLanesJson,
        proofPolicyKey: proposed.proofPolicyKey,
        exclusivityRequired: proposed.exclusivityRequired,
        fulfillmentPriority: proposed.fulfillmentPriority,
        proposedQuantity: proposed.proposedQuantity,
        reservedQuantity: proposed.reservedQuantity,
        fulfilledQuantity: proposed.fulfilledQuantity,
      },
      txDb
    );

    const target = await createDeliveryTargetRecord(
      {
        clientAccount: { connect: { clientAccountId: proposedTarget.clientAccountId } },
        displayName: proposedTarget.displayName,
        adapterKey: proposedTarget.adapterKey,
        enabled: proposedTarget.enabled,
        isPrimary: proposedTarget.isPrimary,
        isRequired: proposedTarget.isRequired,
        readinessStatus: proposedTarget.readinessStatus,
        configMetadataJson: proposedTarget.configMetadataJson as Prisma.InputJsonValue,
      },
      txDb
    );

    const audit = await createLf2CheckpointAAuditEvent(
      {
        sourceLeadEventId,
        sourceLeadUidMasked: preview.maskedSourceLeadUid,
        clientAccountId: preview.clientAccountId,
        destinationSubaccountIdGhl: preview.authoritativeLocationId,
        leadOrderId: order.id,
        deliveryTargetId: target.id,
        actionType: "CREATE_CONFIG",
        checkpointAStatus: "applied",
        requestedBy: input.requestedBy ?? null,
        requestId,
        reasonsJson: {
          source: "lf2_checkpoint_a_create",
          operatorNote: input.operatorNote ?? null,
          orderNumber: order.orderNumber,
        },
        metadataJson: {
          createdAt: now.toISOString(),
        },
      },
      txDb
    );

    return { order, target, audit };
  });

  const postCreatePreview = await buildLf2CheckpointAConfigPreviewForSourceLead(sourceLeadEventId, db, deps);
  if (!postCreatePreview.ok) return { ok: false, error: postCreatePreview.error };

  return {
    ok: true,
    checkpointAStatus: "applied",
    sourceLeadEventId,
    maskedSourceLeadUid: preview.maskedSourceLeadUid,
    clientAccountId: preview.clientAccountId,
    authoritativeLocationId: preview.authoritativeLocationId,
    leadOrderId: result.order.id,
    leadOrderNumber: result.order.orderNumber,
    deliveryTargetId: result.target.id,
    previousLeadOrderStatus: null,
    previousDeliveryTargetEnabled: null,
    auditEventId: result.audit.id,
    postCreatePreview: postCreatePreview.preview,
    shadowEnqueueOccurred: false,
    lf2ExecutionRowsCreated: false,
  };
}

export async function revokeLf2CheckpointAConfigForSourceLead(
  input: Lf2CheckpointAConfigInput,
  db: PrismaClient = prisma,
  deps: Lf2CheckpointAConfigDeps = {}
): Promise<Lf2CheckpointARevokeResult> {
  const sourceLeadEventId = input.sourceLeadEventId.trim();
  const requestId = input.requestId?.trim() || null;

  const context = await loadCheckpointAContext(sourceLeadEventId, db, deps);
  if (!context.ok) return { ok: false, error: context.error };

  if (await hasLf2ExecutionRows(sourceLeadEventId, db)) {
    const audit = await recordRejectedCheckpointAAudit({
      db,
      sourceLeadEventId,
      leadUid: context.leadUid,
      clientAccountId: context.clientAccountId,
      destinationSubaccountIdGhl: context.authoritativeLocationId,
      actionType: "REVOKE_CONFIG",
      error: "shadow_processing_started",
      requestedBy: input.requestedBy,
      requestId,
      operatorNote: input.operatorNote,
    });
    return { ok: false, error: "shadow_processing_started", auditEventId: audit.id };
  }

  const createAudit = await findLatestAppliedCheckpointACreateForSourceLead(sourceLeadEventId, db);
  if (!createAudit?.leadOrderId || !createAudit.deliveryTargetId) {
    return { ok: false, error: "checkpoint_config_not_found" };
  }

  const order = await db.leadOrder.findUnique({ where: { id: createAudit.leadOrderId } });
  const target = await db.deliveryTarget.findUnique({ where: { id: createAudit.deliveryTargetId } });
  if (!order || !target) return { ok: false, error: "checkpoint_config_not_found" };

  if (requestId) {
    const priorRevoke = await findAppliedCheckpointARevokeByRequestId(requestId, db);
    if (priorRevoke && priorRevoke.sourceLeadEventId === sourceLeadEventId) {
      const postRevocationPreview = await buildLf2CheckpointAConfigPreviewForSourceLead(
        sourceLeadEventId,
        db,
        deps
      );
      if (!postRevocationPreview.ok) return { ok: false, error: postRevocationPreview.error };
      return {
        ok: true,
        revocationStatus: "idempotent_replay",
        sourceLeadEventId,
        maskedSourceLeadUid: maskSourceLeadUidForAudit(context.leadUid),
        clientAccountId: context.clientAccountId,
        authoritativeLocationId: context.authoritativeLocationId,
        leadOrderId: order.id,
        leadOrderNumber: order.orderNumber,
        deliveryTargetId: target.id,
        auditEventId: priorRevoke.id,
        postRevocationPreview: postRevocationPreview.preview,
      };
    }
  }

  const alreadyRevoked = order.status === "canceled" && !target.enabled;
  const wasActive = order.status === "active" && !order.canceledAt && target.enabled;
  if (!wasActive && !alreadyRevoked) {
    return { ok: false, error: "checkpoint_config_not_active" };
  }

  const now = new Date();
  const revocationStatus = alreadyRevoked ? "idempotent_replay" : "applied";

  const result = await db.$transaction(async (tx) => {
    const updatedOrder = alreadyRevoked
      ? order
      : (
          await tx.leadOrder.update({
            where: { id: order.id },
            data: { status: "canceled", canceledAt: now },
          })
        );

    const instructionCount = await tx.deliveryInstruction.count({
      where: { deliveryTargetId: target.id },
    });
    const updatedTarget =
      alreadyRevoked || instructionCount > 0
        ? target
        : await updateDeliveryTargetRecord(target.id, { enabled: false }, tx);

    const audit = await createLf2CheckpointAAuditEvent(
      {
        sourceLeadEventId,
        sourceLeadUidMasked: maskSourceLeadUidForAudit(context.leadUid),
        clientAccountId: context.clientAccountId,
        destinationSubaccountIdGhl: context.authoritativeLocationId,
        leadOrderId: order.id,
        deliveryTargetId: target.id,
        actionType: "REVOKE_CONFIG",
        checkpointAStatus: revocationStatus,
        requestedBy: input.requestedBy ?? null,
        requestId,
        reasonsJson: {
          source: "lf2_checkpoint_a_revoke",
          operatorNote: input.operatorNote ?? null,
          previousOrderStatus: order.status,
          previousTargetEnabled: target.enabled,
        },
      },
      tx
    );

    return { updatedOrder, updatedTarget, audit };
  });

  const postRevocationPreview = await buildLf2CheckpointAConfigPreviewForSourceLead(
    sourceLeadEventId,
    db,
    deps
  );
  if (!postRevocationPreview.ok) return { ok: false, error: postRevocationPreview.error };

  return {
    ok: true,
    revocationStatus,
    sourceLeadEventId,
    maskedSourceLeadUid: maskSourceLeadUidForAudit(context.leadUid),
    clientAccountId: context.clientAccountId,
    authoritativeLocationId: context.authoritativeLocationId,
    leadOrderId: result.updatedOrder.id,
    leadOrderNumber: result.updatedOrder.orderNumber,
    deliveryTargetId: result.updatedTarget.id,
    auditEventId: result.audit.id,
    postRevocationPreview: postRevocationPreview.preview,
  };
}

export function presentCheckpointADeliveryTargetSafe(
  target: Parameters<typeof presentDeliveryTargetSafe>[0]
) {
  return presentDeliveryTargetSafe(target);
}
