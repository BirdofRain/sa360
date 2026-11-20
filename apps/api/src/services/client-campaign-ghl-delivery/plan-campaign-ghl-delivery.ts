/**
 * Campaign-specific GHL delivery plan (PR E1).
 *
 * This prepares one frozen plan for one SourceLeadEvent. It does not call
 * GoHighLevel, Google Sheets, or the live executor. The existing adapter keeps
 * the client destination workflow until a later phase can pass every guard
 * below and a durable execution grant.
 *
 * The shadow row is evidence. `executionAuthorized` on that row stays false
 * and is never the grant. Registry status `ready`, an approved binding, and a
 * stored campaign id are not permission to send.
 *
 * A plan is selected only when all of the following hold:
 * 1. Authoritative client routing is valid and names this client.
 * 2. Campaign identity is one campaign, with no review candidates.
 * 3. Shadow status is MATCHED.
 * 4. Niche classification is MATCH or MISSING.
 * 5. Source-ownership conflict codes are absent.
 * 6. Frozen revision, niche, product, slug, and destination are used.
 * 7. Client-level delivery permission passes `isPersistedLiveDestination`.
 * 8. An explicit operator grant matches this event, decision version,
 *    campaign revision, workflow, and location.
 * 9. Destination evidence says this workflow is authorized for this campaign.
 * 10. Workflow evidence says it exists in that location and can run.
 * 11. Duplicate, compliance, and required-write gates pass.
 * 12. Runtime, adapter, and ongoing-delivery gates are reported open.
 *
 * Enrollment, when a later phase is allowed to send, is direct workflow API
 * only. Shared trigger tags stay off this plan. Add-only niche and campaign
 * tags are attribution and do not select a workflow. Contact tags are ignored.
 * Sheets are not selected and not written.
 */

import {
  CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION,
  SHADOW_EXECUTION_AUTHORIZED,
  type ClientCampaignShadowDecision,
} from "../client-campaign-shadow/resolve-client-campaign-shadow.js";
import { isCampaignNicheKey, isCampaignProductType } from "../client-campaign-registry/identity.js";
import { isClientCampaignGhlExecutionEnabled } from "../../lib/client-campaign-ghl-execution-env.js";
import {
  isPersistedLiveDestination,
  type LiveDestinationRecord,
} from "../ghl-destination-authorization.js";
import {
  AUTOMATION_ENTRY_EVENT_TAG,
  operationIdempotencyKey,
  retryDecision,
  workflowEnrollmentAllowed,
  type LocationFieldCollision,
  type VetOperation,
  type VetOperationOutcome,
  type VetRetryDecision,
} from "../ghl-delivery-adapter/vet-ghl-delivery-contract.js";
import {
  WORKFLOW_AI_READY_TAG,
  WORKFLOW_TRIGGER_TAG,
} from "../ghl-delivery-adapter/ghl-workflow-trigger-mode.js";

export const CAMPAIGN_GHL_PLAN_PHASE = "E1" as const;

/** Live HTTP stays off in this phase. These are the blockers a later phase must close. */
export const CAMPAIGN_GHL_LIVE_BLOCKERS = [
  "no_durable_campaign_execution_grant",
  "workflow_live_verified_constraint_stays_false",
  "campaign_plan_not_wired_to_ghl_executor",
  "tag_trigger_cannot_select_a_shared_contact",
  "production_activation_not_authorized",
] as const;

const CAMPAIGN_TAG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const OWNERSHIP_CONFLICTS = new Set([
  "no_authoritative_client",
  "provider_missing",
  "no_exact_source_evidence",
  "loose_evidence_only",
  "cross_client_identity_conflict",
  "confirmed_source_contradiction",
  "multiple_eligible_campaigns",
  "no_approved_exact_binding",
]);

const TAG_BLOCKERS = new Set([
  "decision_version_unsupported",
  "authoritative_routing_invalid",
  "routing_client_mismatch",
  "campaign_unresolved",
  "campaign_review_required",
  "campaign_identity_ambiguous",
  "source_ownership_unverified",
  "niche_classification_conflict",
  "niche_classification_unresolved",
  "frozen_niche_missing",
  "campaign_slug_invalid",
  "execution_grant_missing",
  "execution_grant_mismatch",
  "shadow_row_is_not_a_delivery_grant",
]);

const REASON_ORDER = [
  "campaign_ghl_execution_gate_off",
  "campaign_lane_not_opted_in",
  "planning_facts_missing",
  "decision_version_unsupported",
  "authoritative_routing_invalid",
  "routing_client_mismatch",
  "campaign_unresolved",
  "campaign_review_required",
  "campaign_identity_ambiguous",
  "source_ownership_unverified",
  "niche_classification_conflict",
  "niche_classification_unresolved",
  "campaign_lane_paused",
  "campaign_status_missing",
  "frozen_revision_missing",
  "frozen_niche_missing",
  "frozen_product_missing",
  "frozen_destination_missing",
  "campaign_slug_invalid",
  "shadow_row_is_not_a_delivery_grant",
  "execution_grant_missing",
  "execution_grant_mismatch",
  "client_delivery_not_permitted",
  "destination_not_authorized_for_campaign",
  "workflow_not_validated",
  "workflow_missing_or_ineligible",
  "workflow_location_mismatch",
  "workflow_trigger_mode_unsupported",
  "tag_trigger_cross_fire_risk",
  "required_custom_fields_missing",
  "contact_identity_invalid",
  "required_values_missing",
  "legacy_automation_conflict",
  "duplicate_blocked",
  "compliance_blocked",
  "delivery_blocked",
  "required_field_blocks_automation_entry",
  "runtime_gate_closed",
  "adapter_gate_closed",
  "ongoing_delivery_gate_closed",
  "duplicate_event_campaign_operation",
  "uncertain_outcome_hold",
  "remote_outcome_rejected_hold",
] as const;

export type CampaignGhlReasonCode = (typeof REASON_ORDER)[number];

export type CampaignScopedOperation = VetOperation | "opportunity" | "first_touch";

const SCOPED_OPERATIONS: readonly CampaignScopedOperation[] = [
  "contact",
  "custom_fields",
  "source_attributes",
  "note",
  "tags",
  "workflow",
  "opportunity",
  "first_touch",
];

const ENROLLMENT_OPERATIONS = new Set<CampaignScopedOperation>(["workflow", "opportunity", "first_touch"]);

export type CampaignDeliverySnapshot = {
  decisionVersion: number;
  status: "MATCHED" | "UNRESOLVED" | "REVIEW_REQUIRED" | string;
  clientAccountId: string | null;
  clientCampaignId: string | null;
  campaignRevision: number | null;
  campaignSlug: string | null;
  campaignDisplayName: string | null;
  campaignStatus: string | null;
  configuredNicheKey: string | null;
  configuredProductType: string | null;
  nicheClassificationStatus: "MATCH" | "MISSING" | "CONFLICT" | "UNRESOLVED" | string;
  reasonCodes: string[];
  reviewCandidateCampaignIds: string[];
  /** Copied from the shadow row. True is a contract break and blocks the plan. */
  executionAuthorized: boolean;
  destination: {
    workflowIdGhl: string | null;
    workflowTriggerMode: string | null;
    ghlLocationId: string | null;
  } | null;
};

export type CampaignExecutionGrantInput = {
  granted: boolean;
  grantKind: string;
  sourceLeadEventId: string;
  decisionVersion: number;
  clientCampaignId: string;
  campaignRevision: number;
  workflowIdGhl: string;
  ghlLocationId: string;
};

export type WorkflowValidationEvidence = {
  checked: boolean;
  belongsToLocation: boolean;
  exists: boolean;
  eligibleToRun: boolean;
  triggerModeSupported: boolean;
  requiredCustomFieldsInstalled: boolean;
  contactIdentityValid: boolean;
  requiredValuesPresent: boolean;
  legacyAutomationWouldDoubleSend: boolean;
  destinationAuthorizedForCampaign: boolean;
};

export type CampaignGhlRuntimeGates = {
  deliveryRuntimeAllowsLiveCanary: boolean;
  adapterMaxModeAllowsLiveCanary: boolean;
  ongoingGhlDeliveryEnabled: boolean;
};

export type CampaignGhlPriorReceipt = {
  operation: CampaignScopedOperation;
  outcome: VetOperationOutcome;
  /** When set, the receipt applies only if it equals this plan's operation key. */
  idempotencyKey?: string;
};

export type CampaignGhlPlanningFacts = {
  campaignLaneOptIn: true;
  sourceLeadEventId: string;
  snapshot: CampaignDeliverySnapshot;
  routing: {
    valid: boolean;
    clientAccountId: string | null;
    duplicateBlocked: boolean;
    complianceBlocked: boolean;
    blocksDelivery: boolean;
  };
  grant: CampaignExecutionGrantInput | null;
  clientDestination: LiveDestinationRecord;
  workflowValidation: WorkflowValidationEvidence | null;
  requiredWrites: {
    contactCompleted: boolean;
    requiredCustomFieldStampFailed: boolean;
    collisions: readonly LocationFieldCollision[];
    unresolvedDeliveryRequired: readonly string[];
  };
  runtimeGates: CampaignGhlRuntimeGates;
  priorReceipts: readonly CampaignGhlPriorReceipt[];
  existingContactTags: readonly string[];
  contactId: string | null;
};

export type CampaignGhlOptOut = {
  campaignLaneOptIn: false;
};

export type CampaignGhlFactsInput = CampaignGhlPlanningFacts | CampaignGhlOptOut;

export type CampaignGhlTagPlan = {
  proposal: { nicheTag: string; campaignTag: string } | null;
  addOnly: true;
  replacesExistingTags: false;
  removesExistingNicheOrCampaignTags: false;
  maySelectWorkflow: false;
  /** This phase never posts. A proposal is not a write. */
  postAuthorized: false;
  applied: false;
  automationEntryTags: readonly [];
  withheldAutomationEntryTags: readonly [
    typeof AUTOMATION_ENTRY_EVENT_TAG,
    typeof WORKFLOW_TRIGGER_TAG,
    typeof WORKFLOW_AI_READY_TAG,
  ];
  preservedExistingTags: readonly string[];
};

export type CampaignGhlOperationPlan = {
  operation: CampaignScopedOperation;
  idempotencyKey: string;
  existingPolicy: VetRetryDecision;
  externalCallAuthorized: false;
};

export type CampaignGhlDeliveryPlan = {
  phase: typeof CAMPAIGN_GHL_PLAN_PHASE;
  disposition: "legacy_unchanged" | "blocked" | "simulated_ready" | "duplicate_suppressed" | "hold_uncertain";
  reasonCodes: CampaignGhlReasonCode[];
  liveExternalCallAuthorized: false;
  externalCallPlanned: false;
  externalCallCount: 0;
  sheetsDisposition: "unchanged";
  sheetsWriterInvoked: false;
  shadowExecutionAuthorizedUsedAsGrant: false;
  fallbackWorkflowUsed: false;
  addOnlyTagsSufficientForEnrollment: false;
  customFieldWritePlanned: false;
  eventMetadataPostsPlanned: false;
  blindRetryAuthorized: false;
  liveBlockers: typeof CAMPAIGN_GHL_LIVE_BLOCKERS;
  sourceLeadEventId: string | null;
  selectedWorkflowIdGhl: string | null;
  enrollment: {
    method: "direct_api" | null;
    selectedForFutureEnrollment: boolean;
    sharedTriggerTagUsed: false;
    tagTriggerModeAccepted: false;
  };
  frozen: {
    clientCampaignId: string | null;
    campaignRevision: number | null;
    campaignSlug: string | null;
    campaignDisplayName: string | null;
    configuredNicheKey: string | null;
    configuredProductType: string | null;
    ghlLocationId: string | null;
    workflowIdGhl: string | null;
    workflowTriggerMode: string | null;
  } | null;
  tags: CampaignGhlTagPlan;
  operations: CampaignGhlOperationPlan[];
  automationEntryBlockReason: string | null;
  attribution: {
    authority: "source_lead_event";
    sourceLeadEventId: string | null;
    clientCampaignId: string | null;
    contactId: string | null;
    contactTagsUsedForSelection: false;
    contactDecisionsMerged: false;
  };
};

export function campaignNicheTag(nicheKey: string): string | null {
  if (!isCampaignNicheKey(nicheKey)) return null;
  return `SA360::NICHE::${nicheKey}`;
}

export function campaignSlugTag(slug: string): string | null {
  if (!CAMPAIGN_TAG_SLUG.test(slug)) return null;
  return `SA360::CAMPAIGN::${slug}`;
}

export function campaignGhlRunKey(input: {
  sourceLeadEventId: string;
  clientCampaignId: string;
  decisionVersion: number;
  ghlLocationId: string;
  workflowIdGhl: string;
}): string {
  return [
    "campaign-ghl",
    input.sourceLeadEventId.trim(),
    input.clientCampaignId.trim(),
    String(input.decisionVersion),
    input.ghlLocationId.trim(),
    input.workflowIdGhl.trim(),
  ].join(":");
}

export function campaignOperationIdempotencyKey(runKey: string, operation: CampaignScopedOperation): string {
  if (isVetOperation(operation)) return operationIdempotencyKey(runKey, operation);
  return `${runKey}:${operation}`;
}

/**
 * Copy the frozen shadow decision into the planning snapshot.
 * Spreadsheet fields are dropped. The shadow execution flag lives on the
 * proposed tags and stays false. A true value fails closed. It is not a grant.
 */
export function frozenSnapshotFromShadow(decision: ClientCampaignShadowDecision): CampaignDeliverySnapshot {
  return {
    decisionVersion: decision.version,
    status: decision.status,
    clientAccountId: decision.clientAccountId,
    clientCampaignId: decision.clientCampaignId,
    campaignRevision: decision.campaignRevision,
    campaignSlug: decision.campaignSlug,
    campaignDisplayName: decision.campaignDisplayName,
    campaignStatus: decision.campaignStatus,
    configuredNicheKey: decision.configuredNicheKey,
    configuredProductType: decision.configuredProductType,
    nicheClassificationStatus: decision.nicheClassificationStatus,
    reasonCodes: [...decision.reasonCodes],
    reviewCandidateCampaignIds: [...decision.reviewCandidateCampaignIds],
    executionAuthorized: decision.proposedTags.executionAuthorized,
    destination: decision.destinationSelection
      ? {
          workflowIdGhl: decision.destinationSelection.workflowIdGhl,
          workflowTriggerMode: decision.destinationSelection.workflowTriggerMode,
          ghlLocationId: decision.destinationSelection.ghlLocationId,
        }
      : null,
  };
}

export function planCampaignGhlDelivery(input: {
  env?: NodeJS.ProcessEnv;
  loadFacts?: () => CampaignGhlFactsInput;
  facts?: CampaignGhlFactsInput;
}): CampaignGhlDeliveryPlan {
  const env = input.env ?? process.env;
  if (!isClientCampaignGhlExecutionEnabled(env)) {
    return planShell({
      disposition: "legacy_unchanged",
      reasonCodes: ["campaign_ghl_execution_gate_off"],
    });
  }

  const facts = input.facts ?? input.loadFacts?.();
  if (!facts) {
    return planShell({
      disposition: "blocked",
      reasonCodes: ["planning_facts_missing"],
    });
  }
  if (facts.campaignLaneOptIn !== true) {
    return planShell({
      disposition: "legacy_unchanged",
      reasonCodes: ["campaign_lane_not_opted_in"],
    });
  }
  return planOptedIn(facts);
}

function planOptedIn(facts: CampaignGhlPlanningFacts): CampaignGhlDeliveryPlan {
  const snapshot = facts.snapshot;
  const reasons: CampaignGhlReasonCode[] = [];
  const destination = snapshot.destination;
  const workflowId = destination?.workflowIdGhl?.trim() ?? "";
  const locationId = destination?.ghlLocationId?.trim() ?? "";
  const triggerMode = destination?.workflowTriggerMode?.trim() ?? "";
  const nicheTag = snapshot.configuredNicheKey ? campaignNicheTag(snapshot.configuredNicheKey) : null;
  const slugTag = snapshot.campaignSlug ? campaignSlugTag(snapshot.campaignSlug) : null;

  if (snapshot.decisionVersion !== CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION) {
    reasons.push("decision_version_unsupported");
  }
  if (!facts.routing.valid || !facts.routing.clientAccountId?.trim()) {
    reasons.push("authoritative_routing_invalid");
  } else if (facts.routing.clientAccountId.trim() !== snapshot.clientAccountId) {
    reasons.push("routing_client_mismatch");
  }
  if (snapshot.status === "REVIEW_REQUIRED") reasons.push("campaign_review_required");
  else if (snapshot.status === "UNRESOLVED") reasons.push("campaign_unresolved");
  else if (snapshot.status !== "MATCHED") reasons.push("campaign_identity_ambiguous");
  if (!snapshot.clientCampaignId?.trim() || snapshot.reviewCandidateCampaignIds.length > 0) {
    reasons.push("campaign_identity_ambiguous");
  }
  if (snapshot.reasonCodes.some((code) => OWNERSHIP_CONFLICTS.has(code))) {
    reasons.push("source_ownership_unverified");
  }
  if (snapshot.nicheClassificationStatus === "CONFLICT") reasons.push("niche_classification_conflict");
  else if (snapshot.nicheClassificationStatus !== "MATCH" && snapshot.nicheClassificationStatus !== "MISSING") {
    reasons.push("niche_classification_unresolved");
  }
  if (snapshot.campaignStatus === "paused" || snapshot.campaignStatus === "retired") {
    reasons.push("campaign_lane_paused");
  }
  if (!snapshot.campaignStatus?.trim()) reasons.push("campaign_status_missing");
  if (typeof snapshot.campaignRevision !== "number" || snapshot.campaignRevision < 1) {
    reasons.push("frozen_revision_missing");
  }
  if (!nicheTag) reasons.push("frozen_niche_missing");
  if (!snapshot.configuredProductType || !isCampaignProductType(snapshot.configuredProductType)) {
    reasons.push("frozen_product_missing");
  }
  if (!destination) reasons.push("frozen_destination_missing");
  if (!snapshot.campaignSlug || !slugTag) reasons.push("campaign_slug_invalid");
  if (snapshot.executionAuthorized !== false || SHADOW_EXECUTION_AUTHORIZED !== false) {
    reasons.push("shadow_row_is_not_a_delivery_grant");
  }
  if (!facts.grant) reasons.push("execution_grant_missing");
  else if (!grantMatches(facts, workflowId, locationId)) reasons.push("execution_grant_mismatch");
  if (!isPersistedLiveDestination(facts.clientDestination, locationId)) {
    reasons.push("client_delivery_not_permitted");
  }

  const validation = facts.workflowValidation;
  if (!validation || validation.checked !== true) reasons.push("workflow_not_validated");
  else {
    if (!validation.exists || !validation.eligibleToRun || !workflowId) {
      reasons.push("workflow_missing_or_ineligible");
    }
    if (!validation.belongsToLocation) reasons.push("workflow_location_mismatch");
    if (!validation.triggerModeSupported) reasons.push("workflow_trigger_mode_unsupported");
    if (!validation.requiredCustomFieldsInstalled) reasons.push("required_custom_fields_missing");
    if (!validation.contactIdentityValid) reasons.push("contact_identity_invalid");
    if (!validation.requiredValuesPresent) reasons.push("required_values_missing");
    if (validation.legacyAutomationWouldDoubleSend) reasons.push("legacy_automation_conflict");
    if (!validation.destinationAuthorizedForCampaign) reasons.push("destination_not_authorized_for_campaign");
  }
  if (!workflowId) reasons.push("workflow_missing_or_ineligible");
  if (triggerMode === "tag_trigger") reasons.push("tag_trigger_cross_fire_risk");
  else if (triggerMode !== "direct_api") reasons.push("workflow_trigger_mode_unsupported");

  if (facts.routing.duplicateBlocked) reasons.push("duplicate_blocked");
  if (facts.routing.complianceBlocked) reasons.push("compliance_blocked");
  if (facts.routing.blocksDelivery) reasons.push("delivery_blocked");

  const enrollmentGate = workflowEnrollmentAllowed(facts.requiredWrites);
  if (!enrollmentGate.allowed) reasons.push("required_field_blocks_automation_entry");
  if (!facts.runtimeGates.deliveryRuntimeAllowsLiveCanary) reasons.push("runtime_gate_closed");
  if (!facts.runtimeGates.adapterMaxModeAllowsLiveCanary) reasons.push("adapter_gate_closed");
  if (!facts.runtimeGates.ongoingGhlDeliveryEnabled) reasons.push("ongoing_delivery_gate_closed");

  const ordered = orderReasons(reasons);
  const blocking = ordered.filter((code) => code !== "uncertain_outcome_hold");
  const identityReady = blocking.every((code) => !TAG_BLOCKERS.has(code));
  const withReceipts: CampaignGhlReasonCode[] = [...blocking];

  const canScope =
    Boolean(snapshot.clientCampaignId?.trim()) &&
    Boolean(facts.sourceLeadEventId.trim()) &&
    Boolean(locationId) &&
    Boolean(workflowId) &&
    snapshot.decisionVersion === CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION;
  const runKey = canScope
    ? campaignGhlRunKey({
        sourceLeadEventId: facts.sourceLeadEventId,
        clientCampaignId: snapshot.clientCampaignId!.trim(),
        decisionVersion: snapshot.decisionVersion,
        ghlLocationId: locationId,
        workflowIdGhl: workflowId,
      })
    : null;
  const operations = runKey ? operationPlans(runKey, facts.priorReceipts) : [];

  let disposition: CampaignGhlDeliveryPlan["disposition"] = "blocked";
  if (blocking.length === 0) {
    if (operations.some((item) => item.existingPolicy === "hold_ambiguous")) {
      disposition = "hold_uncertain";
      withReceipts.push("uncertain_outcome_hold");
    } else if (operations.some((item) => item.existingPolicy === "hold_rejected")) {
      disposition = "blocked";
      withReceipts.push("remote_outcome_rejected_hold");
    } else if (operations.some((item) => ENROLLMENT_OPERATIONS.has(item.operation) && item.existingPolicy === "skip_completed")) {
      disposition = "duplicate_suppressed";
      withReceipts.push("duplicate_event_campaign_operation");
    } else {
      disposition = "simulated_ready";
    }
  }

  const selected = disposition === "simulated_ready";
  const proposal =
    selected && identityReady && nicheTag && slugTag && !isAutomationEntryTag(nicheTag) && !isAutomationEntryTag(slugTag)
      ? { nicheTag, campaignTag: slugTag }
      : null;
  return planShell({
    disposition,
    reasonCodes: orderReasons(withReceipts),
    sourceLeadEventId: facts.sourceLeadEventId,
    selectedWorkflowIdGhl: selected ? workflowId : null,
    enrollment: {
      method: selected ? "direct_api" : null,
      selectedForFutureEnrollment: selected,
      sharedTriggerTagUsed: false,
      tagTriggerModeAccepted: false,
    },
    frozen: {
      clientCampaignId: snapshot.clientCampaignId,
      campaignRevision: snapshot.campaignRevision,
      campaignSlug: snapshot.campaignSlug,
      campaignDisplayName: snapshot.campaignDisplayName,
      configuredNicheKey: snapshot.configuredNicheKey,
      configuredProductType: snapshot.configuredProductType,
      ghlLocationId: locationId || null,
      workflowIdGhl: workflowId || null,
      workflowTriggerMode: triggerMode || null,
    },
    tags: tagPlan(proposal, facts.existingContactTags),
    operations,
    automationEntryBlockReason: enrollmentGate.allowed ? null : enrollmentGate.reason,
    contactId: facts.contactId,
  });
}

function grantMatches(facts: CampaignGhlPlanningFacts, workflowId: string, locationId: string): boolean {
  const grant = facts.grant;
  const snapshot = facts.snapshot;
  if (!grant || grant.granted !== true || grant.grantKind !== "explicit_operator") return false;
  if (!workflowId || !locationId || !snapshot.clientCampaignId) return false;
  return (
    grant.sourceLeadEventId.trim() === facts.sourceLeadEventId.trim() &&
    grant.decisionVersion === snapshot.decisionVersion &&
    grant.clientCampaignId.trim() === snapshot.clientCampaignId.trim() &&
    grant.campaignRevision === snapshot.campaignRevision &&
    grant.workflowIdGhl.trim() === workflowId &&
    grant.ghlLocationId.trim() === locationId
  );
}

function operationPlans(
  runKey: string,
  receipts: readonly CampaignGhlPriorReceipt[]
): CampaignGhlOperationPlan[] {
  return SCOPED_OPERATIONS.map((operation) => {
    const idempotencyKey = campaignOperationIdempotencyKey(runKey, operation);
    const receipt = receiptFor(operation, idempotencyKey, receipts);
    const existingPolicy = receipt
      ? retryDecision({
          operation: isVetOperation(operation) ? operation : "workflow",
          idempotencyKey,
          outcome: receipt.outcome,
          externalId: null,
          httpStatus: null,
        })
      : "execute";
    return {
      operation,
      idempotencyKey,
      existingPolicy,
      externalCallAuthorized: false,
    };
  });
}

function receiptFor(
  operation: CampaignScopedOperation,
  idempotencyKey: string,
  receipts: readonly CampaignGhlPriorReceipt[]
): CampaignGhlPriorReceipt | null {
  const sameOperation = receipts.filter((receipt) => receipt.operation === operation);
  const exact = sameOperation.find((receipt) => receipt.idempotencyKey === idempotencyKey);
  if (exact) return exact;
  return sameOperation.find((receipt) => receipt.idempotencyKey === undefined) ?? null;
}

function isVetOperation(operation: CampaignScopedOperation): operation is VetOperation {
  return (
    operation === "contact" ||
    operation === "custom_fields" ||
    operation === "source_attributes" ||
    operation === "note" ||
    operation === "tags" ||
    operation === "workflow"
  );
}

function orderReasons(codes: CampaignGhlReasonCode[]): CampaignGhlReasonCode[] {
  const present = new Set(codes);
  return REASON_ORDER.filter((code) => present.has(code));
}

const WITHHELD_AUTOMATION_ENTRY_TAGS = [
  AUTOMATION_ENTRY_EVENT_TAG,
  WORKFLOW_TRIGGER_TAG,
  WORKFLOW_AI_READY_TAG,
] as const;

function isAutomationEntryTag(tag: string): boolean {
  return WITHHELD_AUTOMATION_ENTRY_TAGS.some((entry) => entry === tag);
}

function tagPlan(
  proposal: { nicheTag: string; campaignTag: string } | null,
  preservedExistingTags: readonly string[]
): CampaignGhlTagPlan {
  return {
    proposal,
    addOnly: true,
    replacesExistingTags: false,
    removesExistingNicheOrCampaignTags: false,
    maySelectWorkflow: false,
    postAuthorized: false,
    applied: false,
    automationEntryTags: [],
    withheldAutomationEntryTags: WITHHELD_AUTOMATION_ENTRY_TAGS,
    preservedExistingTags: [...preservedExistingTags],
  };
}

function emptyTags(): CampaignGhlTagPlan {
  return tagPlan(null, []);
}

function planShell(input: {
  disposition: CampaignGhlDeliveryPlan["disposition"];
  reasonCodes: CampaignGhlReasonCode[];
  sourceLeadEventId?: string | null;
  selectedWorkflowIdGhl?: string | null;
  enrollment?: CampaignGhlDeliveryPlan["enrollment"];
  frozen?: CampaignGhlDeliveryPlan["frozen"];
  tags?: CampaignGhlTagPlan;
  operations?: CampaignGhlOperationPlan[];
  automationEntryBlockReason?: string | null;
  contactId?: string | null;
}): CampaignGhlDeliveryPlan {
  const sourceLeadEventId = input.sourceLeadEventId ?? null;
  const frozen = input.frozen ?? null;
  return {
    phase: CAMPAIGN_GHL_PLAN_PHASE,
    disposition: input.disposition,
    reasonCodes: input.reasonCodes,
    liveExternalCallAuthorized: false,
    externalCallPlanned: false,
    externalCallCount: 0,
    sheetsDisposition: "unchanged",
    sheetsWriterInvoked: false,
    shadowExecutionAuthorizedUsedAsGrant: false,
    fallbackWorkflowUsed: false,
    addOnlyTagsSufficientForEnrollment: false,
    customFieldWritePlanned: false,
    eventMetadataPostsPlanned: false,
    blindRetryAuthorized: false,
    liveBlockers: CAMPAIGN_GHL_LIVE_BLOCKERS,
    sourceLeadEventId,
    selectedWorkflowIdGhl: input.selectedWorkflowIdGhl ?? null,
    enrollment: input.enrollment ?? {
      method: null,
      selectedForFutureEnrollment: false,
      sharedTriggerTagUsed: false,
      tagTriggerModeAccepted: false,
    },
    frozen,
    tags: input.tags ?? emptyTags(),
    operations: input.operations ?? [],
    automationEntryBlockReason: input.automationEntryBlockReason ?? null,
    attribution: {
      authority: "source_lead_event",
      sourceLeadEventId,
      clientCampaignId: frozen?.clientCampaignId ?? null,
      contactId: input.contactId ?? null,
      contactTagsUsedForSelection: false,
      contactDecisionsMerged: false,
    },
  };
}
