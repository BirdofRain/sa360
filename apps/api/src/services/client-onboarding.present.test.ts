import assert from "node:assert/strict";
import test from "node:test";
import type { ClientAccount, ClientGhlDestination } from "@prisma/client";

import { presentPortalClientContext } from "./client-portal-tenant.service.js";
import {
  hasOutstandingPortalInvite,
  presentClientAccountDetail,
  presentClientGhlDestination,
} from "./client-onboarding.present.js";

/** Same include shape `presentClientAccountDetail` requires (`ghlDestination` may be null). */
type AccountWithDestination = ClientAccount & {
  ghlDestination: ClientGhlDestination | null;
};

function account(overrides: Partial<AccountWithDestination> = {}): AccountWithDestination {
  return {
    clientAccountId: "acct_a",
    clientDisplayName: "Northwind",
    status: "onboarding",
    portalEnabled: true,
    portalDisplayName: "Northwind Portal",
    portalLoginEmail: "alex@example.com",
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["final_expense"],
    notes: "internal only",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    portalPasswordHash: null,
    portalPasswordSetAt: null,
    portalSessionEpoch: 0,
    portalInviteTokenHash: null,
    portalInviteExpiresAt: null,
    ghlDestination: null,
    ...overrides,
  };
}

test("admin detail DTO exposes hasPortalPassword without the hash", () => {
  const unset = presentClientAccountDetail(account(), [], null);
  assert.equal(unset.hasPortalPassword, false);
  assert.equal("portalPasswordHash" in unset, false);

  const set = presentClientAccountDetail(
    account({ portalPasswordHash: "scrypt$should-never-appear" }),
    [],
    null
  );
  assert.equal(set.hasPortalPassword, true);
  assert.equal("portalPasswordHash" in set, false);
  assert.equal(JSON.stringify(set).includes("scrypt$should-never-appear"), false);
});

test("admin detail DTO exposes outstanding-invite boolean without token hash", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const none = presentClientAccountDetail(account(), [], null);
  assert.equal(none.hasOutstandingPortalInvite, false);
  assert.equal("portalInviteTokenHash" in none, false);
  assert.equal("portalInviteExpiresAt" in none, false);

  const outstanding = hasOutstandingPortalInvite(
    account({
      portalInviteTokenHash: "deadbeefinvitehash",
      portalInviteExpiresAt: new Date("2026-09-02T12:00:00.000Z"),
    }),
    now
  );
  assert.equal(outstanding, true);

  const expired = hasOutstandingPortalInvite(
    account({
      portalInviteTokenHash: "deadbeefinvitehash",
      portalInviteExpiresAt: new Date("2026-08-31T12:00:00.000Z"),
    }),
    now
  );
  assert.equal(expired, false);

  const dto = presentClientAccountDetail(
    account({
      portalInviteTokenHash: "deadbeefinvitehash",
      portalInviteExpiresAt: new Date(Date.now() + 60_000),
    }),
    [],
    null
  );
  assert.equal(dto.hasOutstandingPortalInvite, true);
  assert.equal("portalInviteTokenHash" in dto, false);
  assert.equal("portalSessionEpoch" in dto, false);
  assert.equal(JSON.stringify(dto).includes("deadbeefinvitehash"), false);
});

test("destination DTO keeps the saved trigger mode beside deliveryEnabled", () => {
  const dto = presentClientGhlDestination({
    id: "dest_1",
    clientAccountId: "acct_a",
    destinationSubaccountIdGhl: "loc_sam",
    locationName: "Sam's Test",
    ghlConnectionStatus: "connected",
    snapshotInstalled: false,
    requiredFieldsInstalled: false,
    defaultAssignedUserIdGhl: null,
    destinationWorkflowIdGhl: "d4c1fa4c-a3e2-4fd8-9091-b3fad0d04edd",
    destinationPipelineIdGhl: null,
    destinationPipelineStageIdGhl: null,
    pipelineStageContactingIdGhl: null,
    pipelineStageAppointmentSetIdGhl: null,
    pipelineStageShowedIdGhl: null,
    pipelineStageSoldIdGhl: null,
    pipelineStageDeadIdGhl: null,
    opportunityCreationEnabled: true,
    backupSheetEnabled: false,
    backupSheetId: null,
    deliveryMode: "shadow",
    deliveryEnabled: false,
    clientCutoverApproved: false,
    internalApprovalStatus: "not_reviewed",
    workflowTriggerMode: "direct_api",
    sourceAttributeFieldMapJson: {},
    sourceEnrichmentPolicyJson: {},
    sourceFieldAliasOverridesJson: {},
    updatedAt: new Date("2026-10-29T14:00:00.000Z"),
  } as ClientGhlDestination);
  assert.equal(dto.workflowTriggerMode, "direct_api");
  assert.equal(dto.vetWorkflowTriggerProposal.proposedMode, "direct_api");
  assert.equal(dto.vetWorkflowTriggerProposal.storedMode, "direct_api");
  assert.equal(dto.vetWorkflowTriggerProposal.changesExistingClients, false);
  assert.equal(dto.destinationWorkflowIdGhl, "d4c1fa4c-a3e2-4fd8-9091-b3fad0d04edd");
  assert.equal(dto.locationName, "Sam's Test");
  assert.equal(dto.deliveryEnabled, false);
});

test("direct API proposal does not rewrite a stored tag trigger", () => {
  const dto = presentClientGhlDestination({
    id: "dest_tag",
    clientAccountId: "acct_a",
    destinationSubaccountIdGhl: "loc_sam",
    locationName: null,
    ghlConnectionStatus: null,
    snapshotInstalled: false,
    requiredFieldsInstalled: false,
    defaultAssignedUserIdGhl: null,
    destinationWorkflowIdGhl: null,
    destinationPipelineIdGhl: null,
    destinationPipelineStageIdGhl: null,
    pipelineStageContactingIdGhl: null,
    pipelineStageAppointmentSetIdGhl: null,
    pipelineStageShowedIdGhl: null,
    pipelineStageSoldIdGhl: null,
    pipelineStageDeadIdGhl: null,
    opportunityCreationEnabled: false,
    backupSheetEnabled: false,
    backupSheetId: null,
    deliveryMode: "shadow",
    deliveryEnabled: false,
    clientCutoverApproved: false,
    internalApprovalStatus: "not_reviewed",
    workflowTriggerMode: "tag_trigger",
    sourceAttributeFieldMapJson: {},
    sourceEnrichmentPolicyJson: {},
    sourceFieldAliasOverridesJson: {},
    updatedAt: new Date("2026-10-29T14:00:00.000Z"),
  } as ClientGhlDestination);
  assert.equal(dto.workflowTriggerMode, "tag_trigger");
  assert.equal(dto.deliveryEnabled, false);
  assert.equal(dto.vetWorkflowTriggerProposal.proposedMode, "direct_api");
  assert.equal(dto.vetWorkflowTriggerProposal.storedMode, "tag_trigger");
  assert.equal(dto.vetWorkflowTriggerProposal.changesExistingClients, false);
});

const harborFieldMap = {
  desired_coverage: "harbor_keep_coverage",
  branch_of_service: "harbor_keep_branch",
  primary_reason: "harbor_keep_reason",
};

function destinationWithMap(map: unknown): ClientGhlDestination {
  return {
    id: "dest_harbor",
    clientAccountId: "harbor_benefits",
    destinationSubaccountIdGhl: "loc_harbor_local",
    locationName: "Harbor location",
    ghlConnectionStatus: "connected",
    snapshotInstalled: false,
    requiredFieldsInstalled: false,
    defaultAssignedUserIdGhl: null,
    destinationWorkflowIdGhl: "wf_harbor_saved",
    destinationPipelineIdGhl: null,
    destinationPipelineStageIdGhl: null,
    pipelineStageContactingIdGhl: null,
    pipelineStageAppointmentSetIdGhl: null,
    pipelineStageShowedIdGhl: null,
    pipelineStageSoldIdGhl: null,
    pipelineStageDeadIdGhl: null,
    opportunityCreationEnabled: true,
    backupSheetEnabled: false,
    backupSheetId: null,
    deliveryMode: "shadow",
    deliveryEnabled: false,
    clientCutoverApproved: false,
    internalApprovalStatus: "not_reviewed",
    workflowTriggerMode: "tag_trigger",
    sourceAttributeFieldMapJson: {},
    sourceEnrichmentPolicyJson: {},
    sourceFieldAliasOverridesJson: {},
    sa360CustomFieldIdMapJson: map,
    updatedAt: new Date("2026-11-11T23:10:37.772Z"),
  } as ClientGhlDestination;
}

test("admin destination DTO returns the stored custom-field id map unchanged", () => {
  const nested = { desired_coverage: { ghlFieldKey: "legacy_coverage" } };
  const cases = [harborFieldMap, null, "not-a-map", [], nested] as const;
  for (const map of cases) {
    const dto = presentClientGhlDestination(destinationWithMap(map));
    assert.equal(dto.sa360CustomFieldIdMapJson, map);
    assert.equal(dto.deliveryEnabled, false);
    assert.equal(dto.destinationWorkflowIdGhl, "wf_harbor_saved");
  }

  const detail = presentClientAccountDetail(
    account({
      clientAccountId: "harbor_benefits",
      clientDisplayName: "Harbor Benefits",
      ghlDestination: destinationWithMap(harborFieldMap),
    }),
    [],
    null
  );
  assert.equal(detail.ghlDestination?.sa360CustomFieldIdMapJson, harborFieldMap);
  assert.equal(detail.ghlDestination?.deliveryEnabled, false);
});

test("customer portal context does not include the saved custom-field id map", () => {
  const presented = presentPortalClientContext({
    clientAccountId: "harbor_benefits",
    clientDisplayName: "Harbor Benefits",
    portalDisplayName: null,
    portalLoginEmail: "harbor@example.test",
    portalEnabled: true,
    primaryNicheKeys: [],
    primaryProductTypes: [],
    ghlDestination: {
      locationName: "Harbor location",
      destinationSubaccountIdGhl: "loc_harbor_local",
    },
  });
  assert.equal(presented.subaccountIdGhl, "loc_harbor_local");
  assert.equal(JSON.stringify(presented).includes("harbor_keep_coverage"), false);
  assert.equal(JSON.stringify(presented).includes("sa360CustomFieldIdMapJson"), false);
});
