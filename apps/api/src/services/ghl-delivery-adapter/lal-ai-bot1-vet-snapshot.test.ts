import assert from "node:assert/strict";
import test from "node:test";

import {
  LAL_AI_BOT1_VET_WEBFORM_WORKFLOW_NAME,
  ONBOARDING_DEMO_VET_WEBFORM_WORKFLOW_ID,
  discoverLalAiBot1VetWebformWorkflow,
  mergeLalAiBot1VetSourceAttributeMap,
  resolveLalAiBot1VetConfiguration,
  resolveSubaccountPrimaryUser,
  tagsWithoutLiteralVetTrigger,
} from "./lal-ai-bot1-vet-snapshot.js";

const WEBFORM = {
  id: "wf_location_webform",
  name: LAL_AI_BOT1_VET_WEBFORM_WORKFLOW_NAME,
  status: "published",
};
const LEADFORM = {
  id: "wf_location_leadform",
  name: "8. New Contact Created (Set Timezone) → VET- Leadform",
  status: "published",
};
const DEMO_WEBFORM = {
  id: ONBOARDING_DEMO_VET_WEBFORM_WORKFLOW_ID,
  name: "8. New Contact Created (Set Timezone) -> VET- Webform",
  status: "published",
};

test("webform workflow is resolved per location and the demo id is not a fallback", () => {
  assert.equal(discoverLalAiBot1VetWebformWorkflow([LEADFORM, WEBFORM])?.id, "wf_location_webform");
  assert.equal(discoverLalAiBot1VetWebformWorkflow([LEADFORM, { ...WEBFORM, status: "draft" }]), null);
  assert.equal(discoverLalAiBot1VetWebformWorkflow([WEBFORM, { ...WEBFORM, id: "wf_other" }]), null);
  assert.equal(discoverLalAiBot1VetWebformWorkflow([DEMO_WEBFORM])?.id, ONBOARDING_DEMO_VET_WEBFORM_WORKFLOW_ID);
  assert.notEqual(
    discoverLalAiBot1VetWebformWorkflow([WEBFORM])?.id,
    ONBOARDING_DEMO_VET_WEBFORM_WORKFLOW_ID
  );
});

test("a new destination uses direct API and does not change an existing Leadform destination", () => {
  const created = resolveLalAiBot1VetConfiguration({
    workflows: [LEADFORM, WEBFORM],
    users: [{ id: "user_owner_1", role: "owner", userType: "account", locationIds: ["loc_1"] }],
    locationId: "loc_1",
    discoveredFields: [
      {
        id: "reasonField01",
        name: "Vet - Primary Reason",
        key: "primary_reason",
        fieldKey: "contact.primary_reason",
        dataType: "TEXT",
      },
    ],
  });
  assert.equal(created.applied, true);
  assert.equal(created.reason, "new_destination");
  assert.equal(created.destinationWorkflowIdGhl, "wf_location_webform");
  assert.equal(created.workflowTriggerMode, "direct_api");
  assert.equal(created.opportunityCreationEnabled, false);
  assert.equal(created.defaultAssignedUserIdGhl, "user_owner_1");
  assert.equal(created.sourceEnrichmentPolicy.lalAiBot1VetWebform, true);
  assert.equal("deliveryEnabled" in created, false);
  assert.equal(created.sourceAttributeFieldMap.primary_reason?.ghlFieldKey, "reasonField01");

  const existing = resolveLalAiBot1VetConfiguration({
    existingWorkflowId: LEADFORM.id,
    existingWorkflowTriggerMode: "tag_trigger",
    workflows: [LEADFORM, WEBFORM],
  });
  assert.equal(existing.applied, false);
  assert.equal(existing.reason, "existing_destination_preserved");
  assert.equal(existing.workflowTriggerMode, null);
  assert.equal(existing.destinationWorkflowIdGhl, null);
});

test("the demo retarget is explicit and keeps a saved field override", () => {
  const retarget = resolveLalAiBot1VetConfiguration({
    applyDemoRetarget: true,
    existingWorkflowId: LEADFORM.id,
    existingWorkflowTriggerMode: "tag_trigger",
    existingAssignedUserId: "user_selected",
    workflows: [DEMO_WEBFORM, LEADFORM],
    users: [
      { id: "user_listed_first", role: "admin", userType: "account" },
      { id: "user_owner_1", role: "owner", userType: "account" },
    ],
    savedSourceAttributeMap: {
      primary_reason: { ghlFieldKey: "savedReasonField", requirement: "optional" },
    },
    discoveredFields: [
      {
        id: "reasonField01",
        name: "Vet - Primary Reason",
        key: null,
        fieldKey: null,
        dataType: "TEXT",
      },
    ],
  });
  assert.equal(retarget.applied, true);
  assert.equal(retarget.reason, "explicit_demo_retarget");
  assert.equal(retarget.destinationWorkflowIdGhl, ONBOARDING_DEMO_VET_WEBFORM_WORKFLOW_ID);
  assert.equal(retarget.workflowTriggerMode, "direct_api");
  assert.equal(retarget.defaultAssignedUserIdGhl, "user_selected");
  assert.equal(retarget.sourceAttributeFieldMap.primary_reason?.ghlFieldKey, "savedReasonField");
  assert.equal("deliveryEnabled" in retarget, false);

  const refused = resolveLalAiBot1VetConfiguration({
    applyDemoRetarget: true,
    existingWorkflowId: LEADFORM.id,
    workflows: [LEADFORM],
  });
  assert.equal(refused.applied, false);
  assert.equal(refused.reason, "webform_not_unique");
});

test("primary user is the declared owner, not the first listed user", () => {
  const users = [
    { id: "user_listed_first", role: "admin", userType: "account" },
    { id: "agency_owner", role: "owner", userType: "agency" },
    { id: "user_owner_1", role: "owner", userType: "account", locationIds: ["loc_1"] },
  ];
  assert.equal(resolveSubaccountPrimaryUser({ locationId: "loc_1", users }), "user_owner_1");
  assert.equal(
    resolveSubaccountPrimaryUser({
      locationId: "loc_1",
      users: [
        { id: "user_listed_first", role: "admin", userType: "account" },
        { id: "user_owner_1", role: "owner", userType: "account" },
        { id: "user_owner_2", role: "owner", userType: "account" },
      ],
    }),
    null
  );
  assert.equal(
    resolveSubaccountPrimaryUser({
      locationPrimaryUserId: "user_declared_primary",
      users: [{ id: "user_listed_first", role: "admin", userType: "account" }],
    }),
    "user_declared_primary"
  );
  assert.deepEqual(tagsWithoutLiteralVetTrigger(["vet", "VET", "SA360::NICHE::VET"]), ["SA360::NICHE::VET"]);
  const mapped = mergeLalAiBot1VetSourceAttributeMap({
    saved: {},
    discoveredFields: [
      { id: "botStatus01", name: "Bot Status", key: null, fieldKey: null, dataType: "TEXT" },
      { id: "ageField01", name: "Age", key: "age", fieldKey: "contact.age", dataType: "TEXT" },
    ],
  });
  assert.equal(mapped.age?.ghlFieldKey, "ageField01");
  assert.equal("bot_status" in mapped, false);
});
