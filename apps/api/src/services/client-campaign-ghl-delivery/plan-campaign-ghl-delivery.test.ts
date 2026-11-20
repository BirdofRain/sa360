import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SHADOW_ANALYSIS_BANNER, SHADOW_EXECUTION_AUTHORIZED } from "../client-campaign-shadow/resolve-client-campaign-shadow.js";
import type { ClientCampaignShadowDecision } from "../client-campaign-shadow/resolve-client-campaign-shadow.js";
import { classifyRemoteOutcome } from "../ghl-delivery-adapter/vet-ghl-delivery-contract.js";
import { WORKFLOW_TRIGGER_TAG } from "../ghl-delivery-adapter/ghl-workflow-trigger-mode.js";
import {
  campaignGhlRunKey,
  campaignNicheTag,
  campaignOperationIdempotencyKey,
  campaignSlugTag,
  frozenSnapshotFromShadow,
  planCampaignGhlDelivery,
  type CampaignDeliverySnapshot,
  type CampaignGhlDeliveryPlan,
  type CampaignGhlPlanningFacts,
  type WorkflowValidationEvidence,
} from "./plan-campaign-ghl-delivery.js";

const LOCATION = "loc-shared";
const ON = { SA360_CLIENT_CAMPAIGN_GHL_EXECUTION_ENABLED: "true" } as NodeJS.ProcessEnv;

function snapshot(over: Partial<CampaignDeliverySnapshot> = {}): CampaignDeliverySnapshot {
  return {
    decisionVersion: 1,
    status: "MATCHED",
    clientAccountId: "client-ray",
    clientCampaignId: "camp-vet-east",
    campaignRevision: 3,
    campaignSlug: "vet-east",
    campaignDisplayName: "VET East",
    campaignStatus: "ready",
    configuredNicheKey: "VET",
    configuredProductType: "life_insurance",
    nicheClassificationStatus: "MATCH",
    reasonCodes: [],
    reviewCandidateCampaignIds: [],
    executionAuthorized: false,
    destination: {
      workflowIdGhl: "wf-vet-east",
      workflowTriggerMode: "direct_api",
      ghlLocationId: LOCATION,
    },
    ...over,
  };
}

function validation(over: Partial<WorkflowValidationEvidence> = {}): WorkflowValidationEvidence {
  return {
    checked: true,
    belongsToLocation: true,
    exists: true,
    eligibleToRun: true,
    triggerModeSupported: true,
    requiredCustomFieldsInstalled: true,
    contactIdentityValid: true,
    requiredValuesPresent: true,
    legacyAutomationWouldDoubleSend: false,
    destinationAuthorizedForCampaign: true,
    ...over,
  };
}

function facts(over: Partial<CampaignGhlPlanningFacts> = {}): CampaignGhlPlanningFacts {
  const snap = over.snapshot ?? snapshot();
  const sourceLeadEventId = over.sourceLeadEventId ?? "evt-vet-east";
  const workflowId = snap.destination?.workflowIdGhl?.trim() ?? "";
  const locationId = snap.destination?.ghlLocationId?.trim() ?? "";
  const grant =
    snap.clientCampaignId && snap.campaignRevision && workflowId && locationId
      ? {
          granted: true,
          grantKind: "explicit_operator",
          sourceLeadEventId,
          decisionVersion: snap.decisionVersion,
          clientCampaignId: snap.clientCampaignId,
          campaignRevision: snap.campaignRevision,
          workflowIdGhl: workflowId,
          ghlLocationId: locationId,
        }
      : null;
  const base: CampaignGhlPlanningFacts = {
    campaignLaneOptIn: true,
    sourceLeadEventId,
    snapshot: snap,
    routing: {
      valid: true,
      clientAccountId: snap.clientAccountId,
      duplicateBlocked: false,
      complianceBlocked: false,
      blocksDelivery: false,
    },
    grant,
    clientDestination: {
      deliveryEnabled: true,
      deliveryMode: "live",
      clientCutoverApproved: true,
      internalApprovalStatus: "approved",
      destinationSubaccountIdGhl: LOCATION,
    },
    workflowValidation: validation(),
    requiredWrites: {
      contactCompleted: true,
      requiredCustomFieldStampFailed: false,
      collisions: [],
      unresolvedDeliveryRequired: [],
    },
    runtimeGates: {
      deliveryRuntimeAllowsLiveCanary: true,
      adapterMaxModeAllowsLiveCanary: true,
      ongoingGhlDeliveryEnabled: true,
    },
    priorReceipts: [],
    existingContactTags: [],
    contactId: "contact-shared",
  };
  return { ...base, ...over, snapshot: snap, sourceLeadEventId };
}

function lane(input: {
  eventId: string;
  campaignId: string;
  slug: string;
  displayName: string;
  niche: string;
  workflowId: string;
  contactTags?: string[];
}): CampaignGhlPlanningFacts {
  return facts({
    sourceLeadEventId: input.eventId,
    existingContactTags: input.contactTags ?? [],
    snapshot: snapshot({
      clientCampaignId: input.campaignId,
      campaignSlug: input.slug,
      campaignDisplayName: input.displayName,
      configuredNicheKey: input.niche,
      destination: {
        workflowIdGhl: input.workflowId,
        workflowTriggerMode: "direct_api",
        ghlLocationId: LOCATION,
      },
    }),
  });
}

function deliver(input: CampaignGhlPlanningFacts = facts()): CampaignGhlDeliveryPlan {
  return planCampaignGhlDelivery({ env: ON, facts: input });
}

function assertNoExternalEffect(plan: CampaignGhlDeliveryPlan): void {
  assert.equal(plan.liveExternalCallAuthorized, false);
  assert.equal(plan.externalCallPlanned, false);
  assert.equal(plan.externalCallCount, 0);
  assert.equal(plan.sheetsDisposition, "unchanged");
  assert.equal(plan.sheetsWriterInvoked, false);
  assert.equal(plan.shadowExecutionAuthorizedUsedAsGrant, false);
  assert.equal(plan.fallbackWorkflowUsed, false);
  assert.equal(plan.blindRetryAuthorized, false);
  assert.equal(plan.addOnlyTagsSufficientForEnrollment, false);
  assert.equal(plan.customFieldWritePlanned, false);
  assert.equal(plan.eventMetadataPostsPlanned, false);
  assert.equal(plan.tags.applied, false);
  assert.equal(plan.tags.postAuthorized, false);
  assert.equal(plan.tags.addOnly, true);
  assert.equal(plan.tags.replacesExistingTags, false);
  assert.equal(plan.tags.removesExistingNicheOrCampaignTags, false);
  assert.equal(plan.tags.maySelectWorkflow, false);
  assert.deepEqual(plan.tags.automationEntryTags, []);
  assert.equal(plan.tags.withheldAutomationEntryTags.includes(WORKFLOW_TRIGGER_TAG), true);
  assert.equal(plan.enrollment.sharedTriggerTagUsed, false);
  assert.equal(plan.enrollment.tagTriggerModeAccepted, false);
  assert.equal(plan.attribution.authority, "source_lead_event");
  assert.equal(plan.attribution.contactTagsUsedForSelection, false);
  assert.equal(plan.attribution.contactDecisionsMerged, false);
  assert.equal(plan.operations.every((operation) => operation.externalCallAuthorized === false), true);
}

test("niche and campaign tags use the catalog key and the stable slug", () => {
  assert.deepEqual(
    ["VET", "NURSE", "HEALTH", "TRUCKER", "MTG", "IUL", "FEX"].map((key) => campaignNicheTag(key)),
    [
      "SA360::NICHE::VET",
      "SA360::NICHE::NURSE",
      "SA360::NICHE::HEALTH",
      "SA360::NICHE::TRUCKER",
      "SA360::NICHE::MTG",
      "SA360::NICHE::IUL",
      "SA360::NICHE::FEX",
    ]
  );
  assert.equal(campaignNicheTag("Nurse"), null);
  assert.equal(campaignNicheTag("VET East"), null);
  assert.equal(campaignSlugTag("vet-east"), "SA360::CAMPAIGN::vet-east");
  assert.equal(campaignSlugTag("VET East"), null);
  assert.equal(SHADOW_EXECUTION_AUTHORIZED, false);
  const borrowed = deliver(
    facts({
      snapshot: snapshot({ campaignSlug: "VET East", campaignDisplayName: "vet-east" }),
    })
  );
  assert.equal(borrowed.reasonCodes.includes("campaign_slug_invalid"), true);
  assert.equal(borrowed.tags.proposal, null);
  assert.equal(borrowed.selectedWorkflowIdGhl, null);
  assert.equal(JSON.stringify(borrowed.tags).includes("SA360::CAMPAIGN::"), false);
});

test("VET East, VET West, and NURSE select distinct workflows in one location", () => {
  const east = deliver(
    lane({
      eventId: "evt-vet-east",
      campaignId: "camp-vet-east",
      slug: "vet-east",
      displayName: "VET East Premium",
      niche: "VET",
      workflowId: "wf-a",
    })
  );
  const west = deliver(
    lane({
      eventId: "evt-vet-west",
      campaignId: "camp-vet-west",
      slug: "vet-west",
      displayName: "VET West",
      niche: "VET",
      workflowId: "wf-b",
    })
  );
  const nurse = deliver(
    lane({
      eventId: "evt-nurse",
      campaignId: "camp-nurse",
      slug: "nurse-life",
      displayName: "NURSE Life",
      niche: "NURSE",
      workflowId: "wf-c",
    })
  );

  assert.equal(east.disposition, "simulated_ready");
  assert.equal(west.disposition, "simulated_ready");
  assert.equal(nurse.disposition, "simulated_ready");
  assert.equal(east.selectedWorkflowIdGhl, "wf-a");
  assert.equal(west.selectedWorkflowIdGhl, "wf-b");
  assert.equal(nurse.selectedWorkflowIdGhl, "wf-c");
  assert.equal(east.frozen?.ghlLocationId, LOCATION);
  assert.equal(west.frozen?.ghlLocationId, LOCATION);
  assert.equal(nurse.frozen?.ghlLocationId, LOCATION);
  assert.equal(east.enrollment.method, "direct_api");
  assert.equal(west.enrollment.method, "direct_api");
  assert.equal(nurse.enrollment.method, "direct_api");
  assert.deepEqual(east.tags.proposal, {
    nicheTag: "SA360::NICHE::VET",
    campaignTag: "SA360::CAMPAIGN::vet-east",
  });
  assert.deepEqual(west.tags.proposal, {
    nicheTag: "SA360::NICHE::VET",
    campaignTag: "SA360::CAMPAIGN::vet-west",
  });
  assert.deepEqual(nurse.tags.proposal, {
    nicheTag: "SA360::NICHE::NURSE",
    campaignTag: "SA360::CAMPAIGN::nurse-life",
  });
  assert.equal(east.tags.proposal?.campaignTag.includes("Premium"), false);
  assert.equal(east.frozen?.configuredNicheKey, "VET");
  assert.equal(west.frozen?.configuredNicheKey, "VET");
  assert.notEqual(east.frozen?.clientCampaignId, west.frozen?.clientCampaignId);
  assert.notEqual(east.operations.find((item) => item.operation === "workflow")?.idempotencyKey, west.operations.find((item) => item.operation === "workflow")?.idempotencyKey);
  for (const plan of [east, west, nurse]) assertNoExternalEffect(plan);
});

test("a missing niche on the event still uses the frozen campaign niche", () => {
  const plan = deliver(facts({ snapshot: snapshot({ nicheClassificationStatus: "MISSING" }) }));
  assert.equal(plan.disposition, "simulated_ready");
  assert.equal(plan.tags.proposal?.nicheTag, "SA360::NICHE::VET");
  assert.equal(plan.selectedWorkflowIdGhl, "wf-vet-east");
  assertNoExternalEffect(plan);
});

test("a niche conflict blocks campaign execution and proposes no tags", () => {
  const plan = deliver(
    facts({
      snapshot: snapshot({
        status: "MATCHED",
        nicheClassificationStatus: "CONFLICT",
        reasonCodes: ["niche_classification_conflict"],
      }),
    })
  );
  assert.equal(plan.disposition, "blocked");
  assert.equal(plan.reasonCodes.includes("niche_classification_conflict"), true);
  assert.equal(plan.selectedWorkflowIdGhl, null);
  assert.equal(plan.tags.proposal, null);
  assertNoExternalEffect(plan);
});

test("a missing source binding blocks execution", () => {
  const plan = deliver(
    facts({
      snapshot: snapshot({
        status: "UNRESOLVED",
        clientCampaignId: null,
        campaignSlug: null,
        destination: null,
        reasonCodes: ["no_approved_exact_binding"],
      }),
    })
  );
  assert.equal(plan.disposition, "blocked");
  assert.equal(plan.reasonCodes.includes("campaign_unresolved"), true);
  assert.equal(plan.reasonCodes.includes("source_ownership_unverified"), true);
  assert.equal(plan.selectedWorkflowIdGhl, null);
  assert.equal(plan.tags.proposal, null);
  assertNoExternalEffect(plan);
});

test("REVIEW_REQUIRED never selects a workflow", () => {
  const plan = deliver(
    facts({
      snapshot: snapshot({
        status: "REVIEW_REQUIRED",
        reviewCandidateCampaignIds: ["camp-vet-east", "camp-vet-west"],
        reasonCodes: ["multiple_eligible_campaigns"],
      }),
    })
  );
  assert.equal(plan.disposition, "blocked");
  assert.equal(plan.reasonCodes.includes("campaign_review_required"), true);
  assert.equal(plan.reasonCodes.includes("source_ownership_unverified"), true);
  assert.equal(plan.selectedWorkflowIdGhl, null);
  assert.equal(plan.tags.proposal, null);
  assert.equal(plan.fallbackWorkflowUsed, false);
  assertNoExternalEffect(plan);
});

test("registry ready and a shadow execution flag are not a delivery grant", () => {
  const readyWithoutGrant = deliver(
    facts({
      grant: null,
      snapshot: snapshot({ campaignStatus: "ready", executionAuthorized: false }),
    })
  );
  assert.equal(readyWithoutGrant.reasonCodes.includes("execution_grant_missing"), true);
  assert.equal(readyWithoutGrant.selectedWorkflowIdGhl, null);
  assert.equal(readyWithoutGrant.tags.proposal, null);

  const registryKind = deliver(
    facts({
      grant: {
        granted: true,
        grantKind: "registry_ready",
        sourceLeadEventId: "evt-vet-east",
        decisionVersion: 1,
        clientCampaignId: "camp-vet-east",
        campaignRevision: 3,
        workflowIdGhl: "wf-vet-east",
        ghlLocationId: LOCATION,
      },
    })
  );
  assert.equal(registryKind.reasonCodes.includes("execution_grant_mismatch"), true);
  assert.equal(registryKind.selectedWorkflowIdGhl, null);

  const shadowFlag = deliver(facts({ snapshot: snapshot({ executionAuthorized: true }) }));
  assert.equal(shadowFlag.reasonCodes.includes("shadow_row_is_not_a_delivery_grant"), true);
  assert.equal(shadowFlag.shadowExecutionAuthorizedUsedAsGrant, false);
  assert.equal(shadowFlag.selectedWorkflowIdGhl, null);
  assert.equal(shadowFlag.tags.proposal, null);
  assertNoExternalEffect(shadowFlag);
});

test("a grant for another workflow cannot replace a missing workflow", () => {
  const nurse = deliver(
    facts({
      sourceLeadEventId: "evt-nurse",
      snapshot: snapshot({
        clientCampaignId: "camp-nurse",
        campaignSlug: "nurse-life",
        campaignDisplayName: "NURSE Life",
        configuredNicheKey: "NURSE",
        destination: {
          workflowIdGhl: null,
          workflowTriggerMode: "direct_api",
          ghlLocationId: LOCATION,
        },
      }),
      grant: {
        granted: true,
        grantKind: "explicit_operator",
        sourceLeadEventId: "evt-nurse",
        decisionVersion: 1,
        clientCampaignId: "camp-nurse",
        campaignRevision: 3,
        workflowIdGhl: "wf-a",
        ghlLocationId: LOCATION,
      },
      workflowValidation: validation({ exists: false, eligibleToRun: false }),
    })
  );
  const east = deliver(
    lane({
      eventId: "evt-vet-east",
      campaignId: "camp-vet-east",
      slug: "vet-east",
      displayName: "VET East",
      niche: "VET",
      workflowId: "wf-a",
    })
  );
  assert.equal(nurse.disposition, "blocked");
  assert.equal(nurse.reasonCodes.includes("workflow_missing_or_ineligible"), true);
  assert.equal(nurse.selectedWorkflowIdGhl, null);
  assert.equal(nurse.frozen?.workflowIdGhl, null);
  assert.equal(east.disposition, "simulated_ready");
  assert.equal(east.selectedWorkflowIdGhl, "wf-a");
  assert.equal(east.frozen?.ghlLocationId, nurse.frozen?.ghlLocationId);
  assertNoExternalEffect(nurse);
  assertNoExternalEffect(east);
});

test("a paused campaign blocks only that lane", () => {
  const paused = deliver(facts({ snapshot: snapshot({ campaignStatus: "paused" }) }));
  const activeLane = deliver(
    lane({
      eventId: "evt-nurse",
      campaignId: "camp-nurse",
      slug: "nurse-life",
      displayName: "NURSE Life",
      niche: "NURSE",
      workflowId: "wf-c",
    })
  );
  assert.equal(paused.reasonCodes.includes("campaign_lane_paused"), true);
  assert.equal(paused.selectedWorkflowIdGhl, null);
  assert.equal(activeLane.selectedWorkflowIdGhl, "wf-c");
  assertNoExternalEffect(paused);
});

test("the same contact keeps separate event attribution and ignores stored tags", () => {
  const vet = deliver(
    lane({
      eventId: "evt-vet-east",
      campaignId: "camp-vet-east",
      slug: "vet-east",
      displayName: "VET East",
      niche: "VET",
      workflowId: "wf-a",
      contactTags: ["SA360::NICHE::NURSE", "SA360::CAMPAIGN::nurse-life", WORKFLOW_TRIGGER_TAG],
    })
  );
  const nurse = deliver(
    lane({
      eventId: "evt-nurse",
      campaignId: "camp-nurse",
      slug: "nurse-life",
      displayName: "NURSE Life",
      niche: "NURSE",
      workflowId: "wf-c",
      contactTags: ["SA360::NICHE::VET", "SA360::CAMPAIGN::vet-east"],
    })
  );
  assert.equal(vet.selectedWorkflowIdGhl, "wf-a");
  assert.equal(nurse.selectedWorkflowIdGhl, "wf-c");
  assert.equal(vet.attribution.contactId, "contact-shared");
  assert.equal(nurse.attribution.contactId, "contact-shared");
  assert.notEqual(vet.attribution.sourceLeadEventId, nurse.attribution.sourceLeadEventId);
  assert.deepEqual(vet.tags.preservedExistingTags, [
    "SA360::NICHE::NURSE",
    "SA360::CAMPAIGN::nurse-life",
    WORKFLOW_TRIGGER_TAG,
  ]);
  assert.equal(vet.tags.removesExistingNicheOrCampaignTags, false);
  assert.equal(vet.tags.proposal?.campaignTag, "SA360::CAMPAIGN::vet-east");
  assert.equal(vet.tags.proposal?.nicheTag === "SA360::NICHE::NURSE", false);
  const vetKey = vet.operations.find((item) => item.operation === "workflow")?.idempotencyKey ?? "";
  const nurseKey = nurse.operations.find((item) => item.operation === "workflow")?.idempotencyKey ?? "";
  assert.notEqual(vetKey, nurseKey);
  assert.equal(vetKey.includes("contact-shared"), false);
  assert.equal(nurseKey.includes("contact-shared"), false);
  assertNoExternalEffect(vet);
  assertNoExternalEffect(nurse);
});

test("add-only tags do not enroll a tag-triggered workflow", () => {
  const plan = deliver(
    facts({
      snapshot: snapshot({
        destination: {
          workflowIdGhl: "wf-vet-east",
          workflowTriggerMode: "tag_trigger",
          ghlLocationId: LOCATION,
        },
      }),
      existingContactTags: ["SA360::NICHE::NURSE", "SA360::CAMPAIGN::nurse-life"],
      workflowValidation: validation({ triggerModeSupported: true }),
    })
  );
  assert.equal(plan.reasonCodes.includes("tag_trigger_cross_fire_risk"), true);
  assert.equal(plan.selectedWorkflowIdGhl, null);
  assert.equal(plan.enrollment.method, null);
  assert.equal(plan.enrollment.tagTriggerModeAccepted, false);
  assert.equal(plan.tags.proposal, null);
  assert.equal(plan.tags.maySelectWorkflow, false);
  assert.equal(plan.addOnlyTagsSufficientForEnrollment, false);
  assert.equal(plan.tags.withheldAutomationEntryTags.includes(WORKFLOW_TRIGGER_TAG), true);
  assert.equal(plan.tags.preservedExistingTags.includes("SA360::CAMPAIGN::nurse-life"), true);
  assertNoExternalEffect(plan);
});

test("a repeated webhook does not enroll the workflow, opportunity, or first touch again", () => {
  const first = deliver();
  const workflowKey = first.operations.find((item) => item.operation === "workflow")?.idempotencyKey;
  assert.ok(workflowKey);
  const replay = deliver(
    facts({
      priorReceipts: [
        { operation: "workflow", outcome: "completed", idempotencyKey: workflowKey },
        { operation: "opportunity", outcome: "completed" },
        { operation: "first_touch", outcome: "completed" },
      ],
    })
  );
  assert.equal(replay.disposition, "duplicate_suppressed");
  assert.equal(replay.reasonCodes.includes("duplicate_event_campaign_operation"), true);
  assert.equal(replay.selectedWorkflowIdGhl, null);
  assert.equal(replay.enrollment.selectedForFutureEnrollment, false);
  assert.equal(replay.operations.find((item) => item.operation === "workflow")?.existingPolicy, "skip_completed");
  assert.equal(replay.operations.find((item) => item.operation === "opportunity")?.existingPolicy, "skip_completed");
  assert.equal(replay.operations.find((item) => item.operation === "first_touch")?.existingPolicy, "skip_completed");
  assert.equal(replay.tags.proposal, null);
  assertNoExternalEffect(replay);

  const westFacts = lane({
    eventId: "evt-vet-west",
    campaignId: "camp-vet-west",
    slug: "vet-west",
    displayName: "VET West",
    niche: "VET",
    workflowId: "wf-b",
  });
  const westReplay = deliver({
    ...westFacts,
    priorReceipts: [{ operation: "workflow", outcome: "completed", idempotencyKey: workflowKey }],
  });
  assert.equal(westReplay.disposition, "simulated_ready");
  assert.equal(westReplay.selectedWorkflowIdGhl, "wf-b");
});

test("an uncertain GHL outcome holds and a pre-send failure does not", () => {
  assert.equal(
    classifyRemoteOutcome({
      attempted: true,
      httpStatus: 503,
      ok: false,
      externalId: null,
      requiresExternalId: false,
    }),
    "ambiguous"
  );
  assert.equal(
    classifyRemoteOutcome({
      attempted: true,
      httpStatus: 0,
      ok: false,
      externalId: null,
      requiresExternalId: true,
    }),
    "ambiguous"
  );
  const uncertain = deliver(facts({ priorReceipts: [{ operation: "workflow", outcome: "ambiguous" }] }));
  assert.equal(uncertain.disposition, "hold_uncertain");
  assert.equal(uncertain.reasonCodes.includes("uncertain_outcome_hold"), true);
  assert.equal(uncertain.operations.find((item) => item.operation === "workflow")?.existingPolicy, "hold_ambiguous");
  assert.notEqual(uncertain.operations.find((item) => item.operation === "workflow")?.existingPolicy, "execute");
  assert.equal(uncertain.selectedWorkflowIdGhl, null);
  assert.equal(uncertain.blindRetryAuthorized, false);
  assertNoExternalEffect(uncertain);

  const rejected = deliver(facts({ priorReceipts: [{ operation: "opportunity", outcome: "rejected" }] }));
  assert.equal(rejected.disposition, "blocked");
  assert.equal(rejected.reasonCodes.includes("remote_outcome_rejected_hold"), true);
  assert.equal(rejected.operations.find((item) => item.operation === "opportunity")?.existingPolicy, "hold_rejected");
  assert.equal(rejected.selectedWorkflowIdGhl, null);

  const beforeSend = deliver(
    facts({ priorReceipts: [{ operation: "workflow", outcome: "failed_before_send" }] })
  );
  assert.equal(beforeSend.disposition, "simulated_ready");
  assert.equal(beforeSend.operations.find((item) => item.operation === "workflow")?.existingPolicy, "execute");
  assert.equal(beforeSend.externalCallCount, 0);
});

test("a required-field failure blocks automation entry", () => {
  const plan = deliver(
    facts({
      requiredWrites: {
        contactCompleted: true,
        requiredCustomFieldStampFailed: false,
        collisions: [],
        unresolvedDeliveryRequired: ["phone"],
      },
    })
  );
  assert.equal(plan.reasonCodes.includes("required_field_blocks_automation_entry"), true);
  assert.match(plan.automationEntryBlockReason ?? "", /phone/);
  assert.deepEqual(plan.tags.automationEntryTags, []);
  assert.equal(plan.tags.proposal, null);
  assert.equal(plan.selectedWorkflowIdGhl, null);
  assert.equal(plan.tags.withheldAutomationEntryTags.includes("SA360::EVENT::LEAD_CREATED"), true);
  assert.equal(plan.tags.withheldAutomationEntryTags.includes(WORKFLOW_TRIGGER_TAG), true);
  assertNoExternalEffect(plan);
});

test("an opted-out client keeps the legacy plan", () => {
  const plan = planCampaignGhlDelivery({
    env: ON,
    facts: { campaignLaneOptIn: false },
  });
  assert.equal(plan.disposition, "legacy_unchanged");
  assert.deepEqual(plan.reasonCodes, ["campaign_lane_not_opted_in"]);
  assert.equal(plan.selectedWorkflowIdGhl, null);
  assert.equal(plan.frozen, null);
  assert.equal(plan.tags.proposal, null);
  assert.equal(plan.operations.length, 0);
  assertNoExternalEffect(plan);
});

test("closed client, runtime, duplicate, and workflow gates block without a fallback", () => {
  const runtime = deliver(
    facts({
      runtimeGates: {
        deliveryRuntimeAllowsLiveCanary: false,
        adapterMaxModeAllowsLiveCanary: false,
        ongoingGhlDeliveryEnabled: false,
      },
    })
  );
  assert.equal(runtime.reasonCodes.includes("runtime_gate_closed"), true);
  assert.equal(runtime.reasonCodes.includes("adapter_gate_closed"), true);
  assert.equal(runtime.reasonCodes.includes("ongoing_delivery_gate_closed"), true);
  assert.equal(runtime.selectedWorkflowIdGhl, null);

  const client = deliver(
    facts({
      clientDestination: {
        deliveryEnabled: true,
        deliveryMode: "shadow",
        clientCutoverApproved: true,
        internalApprovalStatus: "approved",
        destinationSubaccountIdGhl: LOCATION,
      },
    })
  );
  assert.equal(client.reasonCodes.includes("client_delivery_not_permitted"), true);
  assert.equal(client.selectedWorkflowIdGhl, null);

  const duplicate = deliver(facts({ routing: { ...facts().routing, duplicateBlocked: true } }));
  assert.equal(duplicate.reasonCodes.includes("duplicate_blocked"), true);
  const compliance = deliver(facts({ routing: { ...facts().routing, complianceBlocked: true, blocksDelivery: true } }));
  assert.equal(compliance.reasonCodes.includes("compliance_blocked"), true);
  assert.equal(compliance.reasonCodes.includes("delivery_blocked"), true);

  const wrongLocation = deliver(
    facts({ workflowValidation: validation({ belongsToLocation: false, destinationAuthorizedForCampaign: false }) })
  );
  assert.equal(wrongLocation.reasonCodes.includes("workflow_location_mismatch"), true);
  assert.equal(wrongLocation.reasonCodes.includes("destination_not_authorized_for_campaign"), true);
  assert.equal(wrongLocation.selectedWorkflowIdGhl, null);

  const legacyAutomation = deliver(
    facts({ workflowValidation: validation({ legacyAutomationWouldDoubleSend: true }) })
  );
  assert.equal(legacyAutomation.reasonCodes.includes("legacy_automation_conflict"), true);
  assert.equal(legacyAutomation.selectedWorkflowIdGhl, null);

  const unchecked = deliver(facts({ workflowValidation: null }));
  assert.equal(unchecked.reasonCodes.includes("workflow_not_validated"), true);
  assert.equal(unchecked.selectedWorkflowIdGhl, null);

  const mismatchedGrant = deliver(
    facts({
      grant: {
        granted: true,
        grantKind: "explicit_operator",
        sourceLeadEventId: "evt-vet-east",
        decisionVersion: 1,
        clientCampaignId: "camp-vet-east",
        campaignRevision: 9,
        workflowIdGhl: "wf-b",
        ghlLocationId: LOCATION,
      },
    })
  );
  assert.equal(mismatchedGrant.reasonCodes.includes("execution_grant_mismatch"), true);
  assert.equal(mismatchedGrant.selectedWorkflowIdGhl, null);
  assert.equal(mismatchedGrant.frozen?.workflowIdGhl, "wf-vet-east");
  for (const plan of [runtime, client, duplicate, compliance, wrongLocation, legacyAutomation, unchecked, mismatchedGrant]) {
    assertNoExternalEffect(plan);
  }
});

test("idempotency keys are scoped to the event, campaign, location, workflow, and operation", () => {
  const plan = deliver();
  const runKey = campaignGhlRunKey({
    sourceLeadEventId: "evt-vet-east",
    clientCampaignId: "camp-vet-east",
    decisionVersion: 1,
    ghlLocationId: LOCATION,
    workflowIdGhl: "wf-vet-east",
  });
  const workflow = plan.operations.find((item) => item.operation === "workflow");
  const contact = plan.operations.find((item) => item.operation === "contact");
  assert.equal(workflow?.idempotencyKey, campaignOperationIdempotencyKey(runKey, "workflow"));
  assert.notEqual(workflow?.idempotencyKey, contact?.idempotencyKey);
  assert.equal(workflow?.idempotencyKey.includes("evt-vet-east"), true);
  assert.equal(workflow?.idempotencyKey.includes("camp-vet-east"), true);
  assert.equal(workflow?.idempotencyKey.includes(LOCATION), true);
  assert.equal(workflow?.idempotencyKey.includes("wf-vet-east"), true);
  assert.equal(workflow?.idempotencyKey.includes("contact-shared"), false);
  const again = deliver();
  assert.equal(
    again.operations.find((item) => item.operation === "workflow")?.idempotencyKey,
    workflow?.idempotencyKey
  );
});

test("a shadow decision copies frozen destination fields and drops the sheet selection", () => {
  const decision: ClientCampaignShadowDecision = {
    version: 1,
    status: "MATCHED",
    banner: SHADOW_ANALYSIS_BANNER,
    deliveryExecuted: false,
    clientAccountId: "client-ray",
    clientCampaignId: "camp-nurse",
    campaignRevision: 4,
    campaignSlug: "nurse-life",
    campaignDisplayName: "NURSE Life",
    campaignStatus: "ready",
    configuredNicheKey: "NURSE",
    configuredProductType: "health_insurance",
    winningRoutingAuthority: "confirmed_source_association",
    matchType: null,
    matchedBindingIds: ["binding-1"],
    reviewCandidateCampaignIds: [],
    reasonCodes: [],
    provider: "leadcapture",
    sourceEvidence: [],
    looseEvidenceIgnored: false,
    nicheClassificationStatus: "MATCH",
    incomingNiche: {
      trustedProvenance: "none",
      trustedRawValue: null,
      trustedNormalizedKey: null,
      unrecognized: false,
      untrustedObservations: [],
      ignoredConsumerAnswer: false,
    },
    leadTypeDecision: null,
    proposedTags: {
      authorized: true,
      nicheTag: "SA360::NICHE::NURSE",
      campaignTag: "SA360::CAMPAIGN::nurse-life",
      reason: null,
      existingTagPlansPreserved: true,
      contactTagRemovalSafe: false,
      deliveryExecuted: false,
      executionAuthorized: SHADOW_EXECUTION_AUTHORIZED,
    },
    destinationSelection: {
      informationalOnly: true,
      deliveryExecuted: false,
      workflowIdGhl: "wf-c",
      workflowTriggerMode: "direct_api",
      ghlLocationId: LOCATION,
      spreadsheetId: "sheet-nurse",
      worksheetId: 9,
      worksheetTitle: "Nurse",
      workflowLiveVerified: false,
      mapPublished: false,
    },
  };
  const frozen = frozenSnapshotFromShadow(decision);
  assert.equal(frozen.executionAuthorized, false);
  assert.equal(frozen.destination?.workflowIdGhl, "wf-c");
  assert.equal(frozen.destination?.ghlLocationId, LOCATION);
  assert.equal("spreadsheetId" in (frozen.destination ?? {}), false);
  assert.equal("worksheetId" in (frozen.destination ?? {}), false);
  const plan = deliver(
    facts({
      sourceLeadEventId: "evt-nurse",
      snapshot: frozen,
    })
  );
  assert.equal(plan.selectedWorkflowIdGhl, "wf-c");
  assert.equal(plan.sheetsWriterInvoked, false);
  assert.equal(JSON.stringify(plan).includes("sheet-nurse"), false);
  assertNoExternalEffect(plan);
});

test("campaign planning does not enter the live delivery or sheets writers", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const apiSrc = path.resolve(here, "../..");
  for (const name of ["plan-campaign-ghl-delivery.ts"]) {
    const source = readFileSync(path.join(here, name), "utf8");
    for (const forbidden of [
      "fetch(",
      "googleapis",
      "leadconnectorhq",
      "confirmSourceFunnelOrigin",
      "reassignSourceFunnelOrigin",
      "createRoutingRuleAdmin",
      "SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED",
    ]) {
      assert.equal(source.includes(forbidden), false, `${name} ${forbidden}`);
    }
    assert.equal(source.includes("liveExternalCallAuthorized: false"), true);
  }
  const envSource = readFileSync(path.join(apiSrc, "lib/client-campaign-ghl-execution-env.ts"), "utf8");
  assert.equal(envSource.includes("fetch("), false);
  for (const relative of [
    "services/routing-matcher.service.ts",
    "services/routing-dry-run.service.ts",
    "services/ghl-delivery-adapter/ghl-delivery-request-builders.ts",
    "services/ghl-delivery-adapter/ghl-live-canary-executor.service.ts",
    "services/lead-delivery-plan.service.ts",
    "services/company-sheets-dispatch/company-sheets-dispatch.service.ts",
    "services/association-ongoing-delivery.ts",
    "services/association-ghl-delivery-source.ts",
    "services/source-intake/source-intake-routing-persist.ts",
  ]) {
    const source = readFileSync(path.join(apiSrc, relative), "utf8");
    assert.equal(source.includes("client-campaign-ghl"), false, relative);
    assert.equal(source.includes("SA360_CLIENT_CAMPAIGN_GHL_EXECUTION_ENABLED"), false, relative);
    assert.equal(source.includes("planCampaignGhlDelivery"), false, relative);
  }
});
