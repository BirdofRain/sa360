import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { signStaffAssertion, STAFF_ASSERTION_HEADER } from "@sa360/shared/staff-assertion";

import { resolveCampaignGhlGrantActor } from "../../lib/campaign-ghl-grant-actor.js";
import { SA360_REQUIRED_GHL_CUSTOM_FIELD_KEYS } from "../ghl-config-discovery/ghl-config-discovery.types.js";
import { auditCampaignTagTriggers } from "./campaign-ghl-tag-trigger-audit.js";
import { verifyCampaignWorkflow } from "./campaign-ghl-workflow-verification.js";
import { campaignGrantBlockReason } from "./campaign-ghl-execution-grant.js";
import {
  planCampaignGhlDelivery,
  type CampaignGhlPlanningFacts,
} from "./plan-campaign-ghl-delivery.js";

const ON = { SA360_CLIENT_CAMPAIGN_GHL_EXECUTION_ENABLED: "true" } as NodeJS.ProcessEnv;
const SECRET = "campaign-ghl-staff-assertion-secret";
const STAFF = "c0123456789abcdefghijklmn";

test("unknown workflow status and missing custom fields block, and direct API does not clear tag risk", () => {
  const unknown = verifyCampaignWorkflow({
    clientOwnsLocation: true,
    locationId: "loc-shared",
    workflowId: "wf-a",
    triggerMode: "direct_api",
    contact: { name: true, phone: true, email: true },
    attributionTags: ["SA360::NICHE::VET", "SA360::CAMPAIGN::vet-east"],
    evidence: {
      snapshotVerification: "live",
      triggerInspectionComplete: false,
      workflows: [{ id: "wf-a", status: null, locationId: "loc-shared", triggers: null }],
      customFieldKeys: [],
      readError: false,
    },
  });
  assert.equal(unknown.workflowEligible, "unknown");
  assert.equal(unknown.requiredCustomFieldsInstalled, "false");
  assert.equal(unknown.directApiEnrollment, "unknown");
  assert.equal(unknown.tagTriggerCollision, "UNKNOWN");
  assert.equal(unknown.directApiEnrollmentEliminatesCollisions, false);
  assert.equal(unknown.callerBooleanIgnored, true);

  const installed = verifyCampaignWorkflow({
    clientOwnsLocation: true,
    locationId: "loc-shared",
    workflowId: "wf-a",
    triggerMode: "direct_api",
    contact: { name: true, phone: true, email: true },
    attributionTags: ["SA360::NICHE::VET"],
    evidence: {
      snapshotVerification: "live",
      triggerInspectionComplete: true,
      workflows: [
        {
          id: "wf-a",
          status: "published",
          locationId: "loc-shared",
          triggers: [{ type: "contact_tag", filters: ["SA360::NICHE::VET"] }],
        },
      ],
      customFieldKeys: [...SA360_REQUIRED_GHL_CUSTOM_FIELD_KEYS],
      readError: false,
    },
  });
  assert.equal(installed.workflowEligible, "eligible");
  assert.equal(installed.requiredCustomFieldsInstalled, "true");
  assert.equal(installed.tagTriggerCollision, "CONFLICT");
  assert.equal(installed.directApiEnrollment, "unknown");
  assert.equal(installed.directApiEnrollmentEliminatesCollisions, false);
});

test("tag audit is SAFE only when every trigger list is present and clean", () => {
  const unknown = auditCampaignTagTriggers({
    triggerInspectionComplete: false,
    workflows: [{ id: "wf-a", triggers: null }],
    attributionTags: ["SA360::CAMPAIGN::vet-east"],
  });
  assert.equal(unknown.outcome, "UNKNOWN");
  assert.equal(unknown.directApiEnrollmentEliminatesCollisions, false);
  assert.equal(unknown.removesExistingTags, false);

  const conflict = auditCampaignTagTriggers({
    triggerInspectionComplete: true,
    workflows: [
      {
        id: "wf-a",
        triggers: [{ type: "contact_tag", filters: ["SA360::CAMPAIGN::nurse-life"] }],
      },
    ],
    attributionTags: ["SA360::CAMPAIGN::vet-east"],
  });
  assert.equal(conflict.outcome, "CONFLICT");

  const safe = auditCampaignTagTriggers({
    triggerInspectionComplete: true,
    workflows: [{ id: "wf-a", triggers: [{ type: "contact_tag", filters: ["operator-local"] }] }],
    attributionTags: ["SA360::NICHE::VET", "SA360::CAMPAIGN::vet-east"],
  });
  assert.equal(safe.outcome, "SAFE");
  assert.equal(safe.legacyEntryListener, false);
  assert.equal(safe.directApiEnrollmentEliminatesCollisions, false);
});

test("a retained campaign id does not make an unresolved shadow grantable", () => {
  const base = facts().snapshot;
  assert.equal(campaignGrantBlockReason(base), null);
  assert.equal(
    campaignGrantBlockReason({
      ...base,
      nicheClassificationStatus: "MISSING",
      reasonCodes: ["incoming_niche_missing"],
    }),
    null
  );
  assert.equal(campaignGrantBlockReason({ ...base, status: "REVIEW_REQUIRED" }), "shadow_review_required");
  assert.equal(
    campaignGrantBlockReason({
      ...base,
      status: "REVIEW_REQUIRED",
      nicheClassificationStatus: "CONFLICT",
      reasonCodes: ["niche_classification_conflict"],
    }),
    "niche_conflict"
  );
  assert.equal(
    campaignGrantBlockReason({ ...base, status: "UNRESOLVED", nicheClassificationStatus: "UNRESOLVED" }),
    "shadow_unresolved"
  );
  assert.equal(
    campaignGrantBlockReason({
      ...base,
      status: "REVIEW_REQUIRED",
      reasonCodes: ["cross_client_identity_conflict"],
    }),
    "source_ownership_conflict"
  );
  assert.equal(
    campaignGrantBlockReason({ ...base, reviewCandidateCampaignIds: ["camp-other"] }),
    "competing_campaigns"
  );
});

test("planner withholds tags on collision and fails closed on unknown workflow evidence", () => {
  const blocked = planCampaignGhlDelivery({
    env: ON,
    facts: facts({
      workflowEligibility: "unknown",
      directApiEnrollment: "unknown",
      legacyAutomation: "unknown",
      tagTriggerCollision: "UNKNOWN",
    }),
  });
  assert.equal(blocked.disposition, "blocked");
  assert.equal(blocked.reasonCodes.includes("workflow_status_unknown"), true);
  assert.equal(blocked.reasonCodes.includes("direct_api_enrollment_unverified"), true);
  assert.equal(blocked.reasonCodes.includes("tag_trigger_collision"), true);
  assert.equal(blocked.selectedWorkflowIdGhl, null);
  assert.equal(blocked.tags.proposal, null);
  assert.equal(blocked.tags.posting, "withheld_unknown");
  assert.equal(blocked.tags.postAuthorized, false);
  assert.equal(blocked.tags.directApiEnrollmentEliminatesCollisions, false);
  assert.equal(blocked.liveExternalCallAuthorized, false);
  assert.equal(blocked.externalCallCount, 0);

  const conflict = planCampaignGhlDelivery({
    env: ON,
    facts: facts({
      workflowEligibility: "eligible",
      directApiEnrollment: "supported",
      legacyAutomation: "safe",
      tagTriggerCollision: "CONFLICT",
    }),
  });
  assert.equal(conflict.disposition, "simulated_ready");
  assert.equal(conflict.tags.proposal, null);
  assert.equal(conflict.tags.posting, "withheld_conflict");
  assert.equal(conflict.tags.postAuthorized, false);
  assert.equal(conflict.liveExternalCallAuthorized, false);
  assert.equal(conflict.operations.every((operation) => operation.externalCallAuthorized === false), true);

  const revoked = planCampaignGhlDelivery({
    env: ON,
    facts: facts({
      grant: { ...facts().grant!, status: "revoked", granted: false },
    }),
  });
  assert.equal(revoked.reasonCodes.includes("execution_grant_revoked"), true);
  assert.equal(revoked.selectedWorkflowIdGhl, null);
});

test("a browser actor label is not a grant principal, and a staff assertion without admin_coc fails closed", async () => {
  const shared = await resolveCampaignGhlGrantActor(
    { "x-sa360-admin-actor": "Browser Admin", "x-sa360-staff-principal": STAFF },
    fakeDb([]),
    {}
  );
  assert.deepEqual(shared, { ok: true, actor: "ADMIN" });

  const token = signStaffAssertion({ staffPrincipalId: STAFF, secret: SECRET }).token;
  const denied = await resolveCampaignGhlGrantActor({ [STAFF_ASSERTION_HEADER]: token }, fakeDb([]), {
    SA360_STAFF_ASSERTION_SECRET: SECRET,
  });
  assert.deepEqual(denied, { ok: false, statusCode: 403, error: "forbidden" });

  const allowed = await resolveCampaignGhlGrantActor({ [STAFF_ASSERTION_HEADER]: token }, fakeDb([{ id: STAFF }]), {
    SA360_STAFF_ASSERTION_SECRET: SECRET,
  });
  assert.deepEqual(allowed, { ok: true, actor: STAFF });

  const source = readFileSync(new URL("../../lib/campaign-ghl-grant-actor.ts", import.meta.url), "utf8");
  assert.equal(source.includes("permission = 'admin_coc'"), true);
  assert.equal(source.includes("'team_manager'::\"StaffPermissionKey\""), false);
  assert.equal(source.includes("x-sa360-admin-actor"), true);
});

test("campaign preparation does not enter live writers and legacy delivery does not import it", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const apiSrc = path.resolve(here, "../..");
  for (const name of [
    "prepare-campaign-ghl-delivery.ts",
    "campaign-ghl-execution-grant.ts",
    "campaign-ghl-execution-receipt.ts",
    "campaign-ghl-workflow-verification.ts",
    "campaign-ghl-tag-trigger-audit.ts",
  ]) {
    const source = readFileSync(path.join(here, name), "utf8");
    for (const forbidden of ["ghlDeliveryWrite", "googleapis", "company-sheets-dispatch", "executeLiveCanary"]) {
      assert.equal(source.includes(forbidden), false, `${name} ${forbidden}`);
    }
  }
  const verification = readFileSync(path.join(here, "campaign-ghl-workflow-verification.ts"), "utf8");
  assert.equal(verification.includes('method: "POST"'), false);
  assert.equal(verification.includes("ghlReadOnlyGet"), true);
  for (const relative of [
    "services/ghl-delivery-adapter/ghl-live-canary-executor.service.ts",
    "services/lead-delivery-plan.service.ts",
    "services/company-sheets-dispatch/company-sheets-dispatch.service.ts",
    "services/association-ongoing-delivery.ts",
    "services/routing-matcher.service.ts",
  ]) {
    const source = readFileSync(path.join(apiSrc, relative), "utf8");
    assert.equal(source.includes("prepareCampaignGhlDelivery"), false, relative);
    assert.equal(source.includes("campaign-ghl-execution-grant"), false, relative);
  }
});

function facts(over: Partial<CampaignGhlPlanningFacts> = {}): CampaignGhlPlanningFacts {
  const base: CampaignGhlPlanningFacts = {
    campaignLaneOptIn: true,
    sourceLeadEventId: "evt-vet-east",
    snapshot: {
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
        workflowIdGhl: "wf-a",
        workflowTriggerMode: "direct_api",
        ghlLocationId: "loc-shared",
      },
    },
    routing: {
      valid: true,
      clientAccountId: "client-ray",
      duplicateBlocked: false,
      complianceBlocked: false,
      blocksDelivery: false,
    },
    grant: {
      granted: true,
      grantKind: "explicit_operator",
      status: "active",
      sourceLeadEventId: "evt-vet-east",
      clientAccountId: "client-ray",
      decisionVersion: 1,
      clientCampaignId: "camp-vet-east",
      campaignRevision: 3,
      workflowIdGhl: "wf-a",
      ghlLocationId: "loc-shared",
    },
    clientDestination: {
      deliveryEnabled: true,
      deliveryMode: "live",
      clientCutoverApproved: true,
      internalApprovalStatus: "approved",
      destinationSubaccountIdGhl: "loc-shared",
    },
    workflowValidation: {
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
    },
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
    existingContactTags: ["SA360::NICHE::NURSE", "SA360::CAMPAIGN::nurse-life"],
    contactId: "contact-shared",
  };
  return {
    ...base,
    ...over,
    snapshot: over.snapshot ?? base.snapshot,
    grant: over.grant === undefined ? base.grant : over.grant,
    workflowValidation: over.workflowValidation ?? base.workflowValidation,
  };
}

function fakeDb(result: Array<{ id: string }>) {
  return {
    $queryRaw: async () => result,
  } as unknown as Parameters<typeof resolveCampaignGhlGrantActor>[1];
}
