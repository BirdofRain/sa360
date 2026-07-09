import type {
  CampaignRoutingRule,
  ClientGhlDestination,
  LeadDeliveryPlan,
  LeadDeliveryPlanStep,
  PrismaClient,
} from "@prisma/client";

import { prisma } from "../../lib/db.js";
import type { GhlAdapterPlanContext } from "../ghl-delivery-adapter/ghl-delivery-adapter.types.js";
import { clientDestinationFieldMappingFromDest } from "../delivery-readiness-admin.present.js";

function trim(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractContactFields(normalizedPayloadJson: unknown) {
  const payload = asRecord(normalizedPayloadJson) ?? {};
  const contact = asRecord(payload.contact) ?? payload;
  const firstName = trim(contact.firstName ?? contact.first_name);
  const lastName = trim(contact.lastName ?? contact.last_name);
  const email = trim(contact.email ?? payload.email);
  const phone = trim(contact.phone_e164 ?? contact.phone ?? payload.phone_e164 ?? payload.phone);
  return { firstName, lastName, email, phone };
}

function buildSyntheticRoutingRule(
  clientAccountId: string,
  clientDisplayName: string | null,
  destination: ClientGhlDestination
): CampaignRoutingRule {
  const now = new Date();
  return {
    id: `lf2_rule_${clientAccountId}`,
    masterClientAccountId: clientAccountId,
    clientAccountId,
    clientDisplayName,
    destinationSubaccountIdGhl: destination.destinationSubaccountIdGhl,
    destinationWorkflowIdGhl: destination.destinationWorkflowIdGhl,
    destinationPipelineIdGhl: destination.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: destination.destinationPipelineStageIdGhl,
    defaultAssignedUserIdGhl: destination.defaultAssignedUserIdGhl,
    backupSheetEnabled: false,
    backupSheetId: null,
    ghlConnectionStatus: destination.ghlConnectionStatus,
    snapshotInstalled: destination.snapshotInstalled,
    requiredFieldsInstalled: destination.requiredFieldsInstalled,
    deliveryMode: destination.deliveryMode,
    deliveryEnabled: destination.deliveryEnabled,
    clientCutoverApproved: destination.clientCutoverApproved,
    internalApprovalStatus: destination.internalApprovalStatus,
    opportunityCreationEnabled: destination.opportunityCreationEnabled,
    active: true,
    nicheKey: null,
    productType: null,
    campaignId: null,
    campaignName: null,
    utmCampaign: null,
    matchType: "utm_campaign",
    priority: 0,
    locationName: destination.locationName,
    sourcePlatform: null,
    sourceType: null,
    adsetId: null,
    adId: null,
    formId: null,
    utmContent: null,
    masterDatasetId: null,
    keywordPattern: null,
    effectiveStart: null,
    effectiveEnd: null,
    shadowDeliveryEnabled: true,
    readinessStatus: "not_ready",
    lastReadinessCheckAt: null,
    createdAt: now,
    updatedAt: now,
  } as CampaignRoutingRule;
}

function buildSyntheticPlan(input: {
  instructionId: string;
  clientAccountId: string;
  clientDisplayName: string | null;
  destinationSubaccountIdGhl: string;
  sourceLeadUid: string;
  sourcePhoneE164: string | null;
  sourceEmail: string | null;
  normalizedPayloadJson: unknown;
}): LeadDeliveryPlan & { steps: LeadDeliveryPlanStep[] } {
  const now = new Date();
  const contact = extractContactFields(input.normalizedPayloadJson);
  const planId = `lf2_plan_${input.instructionId}`;
  const contactStep: LeadDeliveryPlanStep = {
    id: `lf2_step_contact_${input.instructionId}`,
    deliveryPlanId: planId,
    stepOrder: 1,
    stepType: "create_or_update_contact",
    status: "planned",
    title: "Create or update GHL contact",
    description: null,
    targetSystem: "ghl",
    targetId: input.destinationSubaccountIdGhl,
    requestPreviewJson: {
      contact: {
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email ?? input.sourceEmail,
        phone: contact.phone ?? input.sourcePhoneE164,
      },
    },
    resultPreviewJson: null,
    warnings: null,
    createdAt: now,
    updatedAt: now,
  };

  return {
    id: planId,
    routingDryRunDecisionId: null,
    lifecycleEventId: null,
    masterClientAccountId: input.clientAccountId,
    sourceLeadUid: input.sourceLeadUid,
    sourceContactIdGhl: null,
    sourcePhoneE164: contact.phone ?? input.sourcePhoneE164,
    sourceEmail: contact.email ?? input.sourceEmail,
    destinationClientAccountId: input.clientAccountId,
    destinationSubaccountIdGhl: input.destinationSubaccountIdGhl,
    destinationClientDisplayName: input.clientDisplayName,
    nicheKey: null,
    productType: null,
    deliveryMode: "live_canary",
    status: "planned",
    planVersion: "lf2.1",
    generatedAt: now,
    generatedBy: "lf2_fulfillment_execution",
    summary: "LF2 synthetic delivery plan for manual GHL canary",
    warnings: null,
    createdAt: now,
    updatedAt: now,
    steps: [contactStep],
  };
}

export async function loadLf2GhlInstructionBundle(
  deliveryInstructionId: string,
  db: PrismaClient = prisma
) {
  const instruction = await db.deliveryInstruction.findUnique({
    where: { id: deliveryInstructionId.trim() },
    include: {
      deliveryTarget: true,
      leadAllocation: {
        include: {
          leadOrder: true,
          sourceLeadEvent: true,
        },
      },
    },
  });
  if (!instruction) return null;

  const client = await db.clientAccount.findUnique({
    where: { clientAccountId: instruction.leadAllocation.clientAccountId },
    include: { ghlDestination: true },
  });
  if (!client?.ghlDestination) {
    return { instruction, client, destination: null, order: instruction.leadAllocation.leadOrder, sourceLeadEvent: instruction.leadAllocation.sourceLeadEvent };
  }

  return {
    instruction,
    client,
    destination: client.ghlDestination,
    order: instruction.leadAllocation.leadOrder,
    sourceLeadEvent: instruction.leadAllocation.sourceLeadEvent,
  };
}

export function buildLf2GhlAdapterContext(bundle: {
  instruction: {
    id: string;
    deliveryTarget: { configMetadataJson: unknown };
  };
  client: { clientAccountId: string; clientDisplayName: string | null };
  destination: ClientGhlDestination;
  sourceLeadEvent: {
    sourceLeadUid: string | null;
    sourceProvider: string;
    normalizedPayloadJson: unknown;
  };
  authoritativeLocationId: string;
}): GhlAdapterPlanContext {
  const locationId = bundle.authoritativeLocationId;

  const sourceLeadUid =
    trim(bundle.sourceLeadEvent.sourceLeadUid) ?? `lf2_${bundle.instruction.id}`;
  const contact = extractContactFields(bundle.sourceLeadEvent.normalizedPayloadJson);

  const plan = buildSyntheticPlan({
    instructionId: bundle.instruction.id,
    clientAccountId: bundle.client.clientAccountId,
    clientDisplayName: bundle.client.clientDisplayName,
    destinationSubaccountIdGhl: locationId,
    sourceLeadUid,
    sourcePhoneE164: contact.phone,
    sourceEmail: contact.email,
    normalizedPayloadJson: bundle.sourceLeadEvent.normalizedPayloadJson,
  });

  const rule = buildSyntheticRoutingRule(
    bundle.client.clientAccountId,
    bundle.client.clientDisplayName,
    {
      ...bundle.destination,
      destinationSubaccountIdGhl: locationId,
    }
  );

  const destinationFieldMapping = clientDestinationFieldMappingFromDest(bundle.destination);

  return {
    plan,
    rule,
    destinationFieldMapping: destinationFieldMapping
      ? {
          sa360CustomFieldIdMapJson: destinationFieldMapping.sa360CustomFieldIdMapJson,
          sa360CustomFieldOptionMapJson: destinationFieldMapping.sa360CustomFieldOptionMapJson,
          customFieldStampRequired: destinationFieldMapping.customFieldStampRequired,
          ownerAssignmentRequired: destinationFieldMapping.ownerAssignmentRequired ?? false,
          workflowStartRequired: destinationFieldMapping.workflowStartRequired ?? false,
          workflowTriggerMode: destinationFieldMapping.workflowTriggerMode,
          sourceAttributeFieldMapJson: bundle.destination.sourceAttributeFieldMapJson,
          sourceEnrichmentPolicyJson: bundle.destination.sourceEnrichmentPolicyJson,
        }
      : null,
    sourceEnrichment: null,
  };
}
