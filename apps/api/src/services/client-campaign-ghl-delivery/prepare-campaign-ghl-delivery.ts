/**
 * Server-only preparation for one campaign GHL plan.
 *
 * Facts come from the frozen shadow row, the source event's routing record,
 * the durable grant, the campaign receipt ledger, the saved client location,
 * and read-only workflow discovery. Browser authorization booleans are not
 * accepted. The returned plan never authorizes an external HTTP call.
 *
 * When SA360_CLIENT_CAMPAIGN_GHL_EXECUTION_ENABLED is not the exact string
 * true, this returns legacy_unchanged and does not read campaign facts.
 */

import type { PrismaClient } from "@prisma/client";

import { isClientCampaignGhlExecutionEnabled } from "../../lib/client-campaign-ghl-execution-env.js";
import { getGhlDeliveryAdapterMaxMode, isMaxModeLiveCanaryCapable } from "../../lib/ghl-delivery-adapter-mode.js";
import { isOngoingGhlServiceEnabled } from "../../lib/ghl-ongoing-delivery-scope.js";
import { CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION } from "../client-campaign-shadow/resolve-client-campaign-shadow.js";
import { resolveDeliveryRuntimeMode } from "../delivery-runtime-mode.service.js";
import type { LiveDestinationRecord } from "../ghl-destination-authorization.js";
import { validateLocationCustomFieldTargets } from "../ghl-delivery-adapter/vet-ghl-delivery-contract.js";
import { campaignGrantBlockReason, loadEffectiveCampaignGhlGrant } from "./campaign-ghl-execution-grant.js";
import {
  ensurePlannedCampaignReceipts,
  listCampaignReceipts,
  receiptToPlanner,
  type ReceiptScope,
} from "./campaign-ghl-execution-receipt.js";
import { snapshotFromShadowRow, type FrozenCampaignScope } from "./campaign-ghl-frozen-shadow.js";
import {
  planCampaignGhlDelivery,
  type CampaignDeliverySnapshot,
  type CampaignExecutionGrantInput,
  type CampaignGhlDeliveryPlan,
  type CampaignGhlPlanningFacts,
  type WorkflowValidationEvidence,
} from "./plan-campaign-ghl-delivery.js";
import {
  readCampaignWorkflowEvidence,
  verifyCampaignWorkflow,
  type CampaignWorkflowVerification,
  type WorkflowDiscoveryEvidence,
} from "./campaign-ghl-workflow-verification.js";

const CLOSED_DESTINATION: LiveDestinationRecord = {
  deliveryEnabled: false,
  deliveryMode: "shadow",
  clientCutoverApproved: false,
  internalApprovalStatus: "not_reviewed",
  destinationSubaccountIdGhl: "",
};

export type PreparedCampaignGhlDelivery = {
  plan: CampaignGhlDeliveryPlan;
  grantId: string | null;
  grantState: string | null;
  verification: CampaignWorkflowVerification | null;
  missingShadow: boolean | null;
  externalHttpAttempted: false;
  sheetsWriterInvoked: false;
  legacyDeliveryChanged: false;
  contactTagsUsedForSelection: false;
};

export async function prepareCampaignGhlDelivery(
  db: PrismaClient,
  input: {
    clientAccountId: string;
    sourceLeadEventId: string;
    env?: NodeJS.ProcessEnv;
    now?: Date;
    readEvidence?: (locationId: string) => Promise<WorkflowDiscoveryEvidence>;
  }
): Promise<PreparedCampaignGhlDelivery> {
  const env = input.env ?? process.env;
  if (!isClientCampaignGhlExecutionEnabled(env)) {
    return {
      plan: planCampaignGhlDelivery({ env }),
      grantId: null,
      grantState: null,
      verification: null,
      missingShadow: null,
      externalHttpAttempted: false,
      sheetsWriterInvoked: false,
      legacyDeliveryChanged: false,
      contactTagsUsedForSelection: false,
    };
  }

  const now = input.now ?? new Date();
  const event = await db.sourceLeadEvent.findUnique({ where: { id: input.sourceLeadEventId } });
  const shadow = event
    ? await db.clientCampaignShadowDecision.findUnique({
        where: {
          sourceLeadEventId_decisionVersion: {
            sourceLeadEventId: event.id,
            decisionVersion: CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION,
          },
        },
      })
    : null;
  const routingClient = event?.clientAccountIdResolved ?? null;
  const owned = Boolean(
    event &&
      shadow &&
      routingClient === input.clientAccountId &&
      shadow.clientAccountId === input.clientAccountId
  );
  const snapshot = owned && shadow ? snapshotFromShadowRow(shadow) : emptySnapshot(owned ? input.clientAccountId : null);
  const sameClient = owned;
  const destination = sameClient
    ? await db.clientGhlDestination.findUnique({ where: { clientAccountId: input.clientAccountId } })
    : null;
  const locationId = snapshot.destination?.ghlLocationId?.trim() ?? "";
  const clientOwnsLocation = Boolean(
    destination && locationId && destination.destinationSubaccountIdGhl.trim() === locationId
  );
  const contact = owned
    ? contactPresence(event?.normalizedPayloadJson, event?.rawPayloadJson)
    : { name: false, phone: false, email: false };
  const existingContactTags = owned ? contactTags(event?.normalizedPayloadJson, event?.rawPayloadJson) : [];
  const routing = asRecord(event?.routingResultJson);
  const mayInspect =
    owned && routing?.matched === true && campaignGrantBlockReason(snapshot) === null && Boolean(locationId);
  const evidence = mayInspect
    ? await (input.readEvidence ?? readCampaignWorkflowEvidence)(locationId)
    : unavailableEvidence();
  const nicheTag = snapshot.configuredNicheKey ? `SA360::NICHE::${snapshot.configuredNicheKey}` : "";
  const campaignTag = snapshot.campaignSlug ? `SA360::CAMPAIGN::${snapshot.campaignSlug}` : "";
  const verification = verifyCampaignWorkflow({
    clientOwnsLocation,
    locationId,
    workflowId: snapshot.destination?.workflowIdGhl?.trim() ?? "",
    triggerMode: snapshot.destination?.workflowTriggerMode ?? null,
    contact,
    attributionTags: [nicheTag, campaignTag].filter(Boolean),
    evidence,
  });
  const effective = await loadEffectiveCampaignGhlGrant(
    db,
    {
      sourceLeadEventId: input.sourceLeadEventId,
      clientAccountId: input.clientAccountId,
      clientCampaignId: sameClient ? snapshot.clientCampaignId : null,
    },
    now
  );
  const scope = receiptScope(input.clientAccountId, input.sourceLeadEventId, snapshot);
  if (scope && effective.state === "active") await ensurePlannedCampaignReceipts(db, scope);
  const receipts = scope ? await listCampaignReceipts(db, scope) : [];
  const runtime = await resolveDeliveryRuntimeMode();
  const duplicate = asRecord(event?.duplicateRiskJson);
  const fieldMap = fieldMapFrom(destination?.sa360CustomFieldIdMapJson);
  const fieldValues = stringRecord(asRecord(event?.normalizedPayloadJson)?.customFields);
  const fieldCheck = validateLocationCustomFieldTargets({
    fieldMap,
    discoveredFields: [],
    values: fieldValues,
  });
  const contactReceipt = receipts.find((row) => row.operation === "contact");
  const fieldReceipt = receipts.find((row) => row.operation === "custom_fields");
  const facts: CampaignGhlPlanningFacts = {
    campaignLaneOptIn: true,
    sourceLeadEventId: input.sourceLeadEventId,
    snapshot,
    routing: {
      valid: Boolean(event) && routing?.matched === true && sameClient,
      clientAccountId: sameClient ? routingClient : routingClient,
      duplicateBlocked: duplicate?.blocksDelivery === true || duplicate?.blocksLiveDelivery === true,
      complianceBlocked: routing?.complianceBlocked === true,
      blocksDelivery: routing?.blocksDelivery === true || duplicate?.blocksDelivery === true,
    },
    grant: grantInput(effective.state, effective.scope),
    clientDestination: destination
      ? {
          deliveryEnabled: destination.deliveryEnabled,
          deliveryMode: destination.deliveryMode,
          clientCutoverApproved: destination.clientCutoverApproved,
          internalApprovalStatus: destination.internalApprovalStatus,
          destinationSubaccountIdGhl: destination.destinationSubaccountIdGhl,
        }
      : CLOSED_DESTINATION,
    workflowValidation: validationFrom(verification),
    workflowEligibility: verification.workflowEligible,
    directApiEnrollment: verification.directApiEnrollment,
    legacyAutomation: verification.legacyAutomation,
    tagTriggerCollision: verification.tagTriggerCollision,
    requiredWrites: {
      contactCompleted: Boolean(contactReceipt && contactReceipt.status === "completed" && contactReceipt.externalAttempted && !contactReceipt.simulated),
      requiredCustomFieldStampFailed: fieldReceipt?.status === "rejected",
      collisions: fieldCheck.collisions,
      unresolvedDeliveryRequired: fieldCheck.unresolvedDeliveryRequired,
    },
    runtimeGates: {
      deliveryRuntimeAllowsLiveCanary: runtime.canRunLiveCanary === true,
      adapterMaxModeAllowsLiveCanary: isMaxModeLiveCanaryCapable(getGhlDeliveryAdapterMaxMode()),
      ongoingGhlDeliveryEnabled: isOngoingGhlServiceEnabled(env),
    },
    priorReceipts: receipts.flatMap((row) => {
      const mapped = receiptToPlanner(row);
      return mapped ? [mapped] : [];
    }),
    existingContactTags,
    contactId: text(asRecord(event?.normalizedPayloadJson)?.ghlContactId),
  };
  if (!sameClient && facts.routing.clientAccountId) {
    facts.routing = { ...facts.routing, valid: false };
  }
  return {
    plan: planCampaignGhlDelivery({ env, facts }),
    grantId: effective.grantId,
    grantState: effective.state,
    verification,
    missingShadow: !owned,
    externalHttpAttempted: false,
    sheetsWriterInvoked: false,
    legacyDeliveryChanged: false,
    contactTagsUsedForSelection: false,
  };
}

function grantInput(state: string, scope: FrozenCampaignScope | null): CampaignExecutionGrantInput | null {
  if (state === "absent" || !scope) return null;
  if (state !== "active" && state !== "revoked" && state !== "expired" && state !== "stale") return null;
  return {
    granted: state === "active",
    grantKind: "explicit_operator",
    status: state,
    sourceLeadEventId: scope.sourceLeadEventId,
    clientAccountId: scope.clientAccountId,
    decisionVersion: scope.decisionVersion,
    clientCampaignId: scope.clientCampaignId,
    campaignRevision: scope.campaignRevision,
    workflowIdGhl: scope.workflowIdGhl,
    ghlLocationId: scope.ghlLocationId,
  };
}

function validationFrom(verification: CampaignWorkflowVerification): WorkflowValidationEvidence {
  const eligible = verification.workflowEligible === "eligible";
  return {
    checked: true,
    belongsToLocation: verification.workflowInLocation === "true" && verification.locationOwnedByClient === "true",
    exists: verification.workflowExists === "true",
    eligibleToRun: eligible,
    triggerModeSupported: verification.triggerModeCompatible === "true",
    requiredCustomFieldsInstalled: verification.requiredCustomFieldsInstalled === "true",
    contactIdentityValid: verification.requiredContactValues === "true",
    requiredValuesPresent: verification.requiredContactValues === "true",
    legacyAutomationWouldDoubleSend: verification.legacyAutomation === "conflict",
    destinationAuthorizedForCampaign:
      verification.locationOwnedByClient === "true" &&
      verification.workflowInLocation === "true" &&
      verification.workflowExists === "true",
  };
}

function receiptScope(
  clientAccountId: string,
  sourceLeadEventId: string,
  snapshot: CampaignDeliverySnapshot
): ReceiptScope | null {
  const locationId = snapshot.destination?.ghlLocationId?.trim() ?? "";
  const workflowId = snapshot.destination?.workflowIdGhl?.trim() ?? "";
  if (!snapshot.clientCampaignId || !locationId || !workflowId) return null;
  if (snapshot.clientAccountId !== clientAccountId) return null;
  return {
    sourceLeadEventId,
    clientAccountId,
    clientCampaignId: snapshot.clientCampaignId,
    decisionVersion: snapshot.decisionVersion,
    ghlLocationId: locationId,
    workflowIdGhl: workflowId,
  };
}

function emptySnapshot(clientAccountId: string | null): CampaignDeliverySnapshot {
  return {
    decisionVersion: CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION,
    status: "UNRESOLVED",
    clientAccountId,
    clientCampaignId: null,
    campaignRevision: null,
    campaignSlug: null,
    campaignDisplayName: null,
    campaignStatus: null,
    configuredNicheKey: null,
    configuredProductType: null,
    nicheClassificationStatus: "UNRESOLVED",
    reasonCodes: ["no_approved_exact_binding"],
    reviewCandidateCampaignIds: [],
    executionAuthorized: false,
    destination: null,
  };
}

function unavailableEvidence(): WorkflowDiscoveryEvidence {
  return {
    snapshotVerification: "unavailable",
    triggerInspectionComplete: false,
    workflows: [],
    customFieldKeys: null,
    readError: true,
  };
}

function contactPresence(normalized: unknown, raw: unknown): { name: boolean; phone: boolean; email: boolean } {
  const sources = [asRecord(normalized), asRecord(asRecord(normalized)?.contact), asRecord(raw), asRecord(asRecord(raw)?.contact)];
  const has = (keys: string[]) => sources.some((source) => keys.some((key) => Boolean(text(source?.[key]))));
  return {
    name: has(["fullName", "name", "firstName", "first_name"]),
    phone: has(["phone", "phoneE164", "phone_number"]),
    email: has(["email", "emailAddress"]),
  };
}

function contactTags(normalized: unknown, raw: unknown): string[] {
  const tags = [asRecord(normalized)?.tags, asRecord(raw)?.tags];
  return tags.flatMap((value) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []));
}

function fieldMapFrom(value: unknown): Record<string, { ghlFieldKey: string }> {
  const record = asRecord(value);
  if (!record) return {};
  const map: Record<string, { ghlFieldKey: string }> = {};
  for (const [key, fieldId] of Object.entries(record)) {
    if (typeof fieldId === "string" && fieldId.trim()) map[key] = { ghlFieldKey: fieldId.trim() };
  }
  return map;
}

function stringRecord(value: unknown): Record<string, string | null> {
  const record = asRecord(value);
  if (!record) return {};
  const out: Record<string, string | null> = {};
  for (const [key, item] of Object.entries(record)) {
    out[key] = typeof item === "string" ? item : null;
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
