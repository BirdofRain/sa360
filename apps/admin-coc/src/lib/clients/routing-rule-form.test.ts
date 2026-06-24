import test from "node:test";
import assert from "node:assert/strict";
import type { RoutingRuleWithReadinessItem } from "@/lib/delivery-readiness/types";
import {
  DUPLICATE_ROUTING_RULE_MESSAGE,
  LEADCAPTURE_MASTER_CLIENT_ACCOUNT_ID,
  LAL_MASTER_VET_MASTER_CLIENT_ACCOUNT_ID,
  defaultAddRoutingRuleFormValues,
  findEquivalentRoutingRule,
  formAfterAddRoutingRuleApiResult,
  isAddRoutingRuleSubmitBlocked,
  masterClientAccountIdForSourceOption,
  planAddRoutingRuleSubmit,
  resolveRoutingRuleSourceDefault,
  sourceOptionForMasterClientAccountId,
} from "./routing-rule-form.js";

function sampleRule(
  overrides: Partial<RoutingRuleWithReadinessItem> = {}
): RoutingRuleWithReadinessItem {
  return {
    id: "rule_existing",
    masterClientAccountId: "leadcapture_io",
    clientAccountId: "vet_life_james_torrey",
    destinationSubaccountIdGhl: "9xSNvQCbGaPE9YNxgl4B",
    clientDisplayName: "James Torrey",
    locationName: null,
    nicheKey: "VET",
    productType: null,
    campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
    campaignName: null,
    utmCampaign: null,
    matchType: "campaign_id",
    active: true,
    priority: 900,
    deliveryMode: "shadow",
    deliveryEnabled: false,
    clientCutoverApproved: false,
    internalApprovalStatus: "not_reviewed",
    readinessStatus: "ready_for_live",
    lastReadinessCheckAt: null,
    ghlConnectionStatus: null,
    snapshotInstalled: true,
    requiredFieldsInstalled: true,
    destinationWorkflowIdGhl: null,
    destinationPipelineIdGhl: null,
    destinationPipelineStageIdGhl: null,
    backupSheetEnabled: false,
    backupSheetId: null,
    defaultAssignedUserIdGhl: null,
    opportunityCreationEnabled: true,
    readiness: {
      ruleId: "rule_existing",
      clientAccountId: "vet_life_james_torrey",
      destinationSubaccountIdGhl: "9xSNvQCbGaPE9YNxgl4B",
      clientDisplayName: "James Torrey",
      readyForShadow: true,
      readyForDirectCanary: true,
      readyForLive: true,
      canDeliverLive: true,
      readinessStatus: "ready_for_live",
      blockers: [],
      warnings: [],
      missingConfig: [],
      requiredApprovals: [],
      recommendedNextAction: "ok",
      checklist: [],
    },
    ...overrides,
  };
}

test("resolveRoutingRuleSourceDefault: LeadCapture provider/system → leadcapture_io", () => {
  assert.deepEqual(resolveRoutingRuleSourceDefault({ sourceProvider: "leadcapture_io" }), {
    sourceOption: "leadcapture_io",
    masterClientAccountId: LEADCAPTURE_MASTER_CLIENT_ACCOUNT_ID,
  });
  assert.deepEqual(resolveRoutingRuleSourceDefault({ sourcePlatform: "leadcapture_io" }), {
    sourceOption: "leadcapture_io",
    masterClientAccountId: "leadcapture_io",
  });
  assert.equal(
    resolveRoutingRuleSourceDefault({ sourceSystem: "leadcapture_io_nextgen" }).masterClientAccountId,
    "leadcapture_io"
  );
  assert.equal(
    resolveRoutingRuleSourceDefault({ sourceSystem: "leadcapture_io_legacy" }).masterClientAccountId,
    "leadcapture_io"
  );
});

test("resolveRoutingRuleSourceDefault: GHL/Master Vet lifecycle → lal_master_vet", () => {
  assert.deepEqual(resolveRoutingRuleSourceDefault({ sourceProvider: "ghl_lifecycle" }), {
    sourceOption: "lal_master_vet",
    masterClientAccountId: LAL_MASTER_VET_MASTER_CLIENT_ACCOUNT_ID,
  });
  assert.equal(
    resolveRoutingRuleSourceDefault({ sourceSystem: "m1a" }).masterClientAccountId,
    "lal_master_vet"
  );
});

test("resolveRoutingRuleSourceDefault: unknown context → blank, no silent lal_master_vet", () => {
  const resolved = resolveRoutingRuleSourceDefault({});
  assert.equal(resolved.sourceOption, "custom");
  assert.equal(resolved.masterClientAccountId, "");
});

test("resolveRoutingRuleSourceDefault: infers from a single existing-rule master", () => {
  assert.equal(
    resolveRoutingRuleSourceDefault({
      existingMasterClientAccountIds: ["leadcapture_io", "leadcapture_io"],
    }).masterClientAccountId,
    "leadcapture_io"
  );
  // Mixed masters → unknown → blank.
  assert.equal(
    resolveRoutingRuleSourceDefault({
      existingMasterClientAccountIds: ["leadcapture_io", "lal_master_vet"],
    }).masterClientAccountId,
    ""
  );
});

test("source option <-> master id mapping is consistent", () => {
  assert.equal(masterClientAccountIdForSourceOption("leadcapture_io"), "leadcapture_io");
  assert.equal(masterClientAccountIdForSourceOption("lal_master_vet"), "lal_master_vet");
  assert.equal(masterClientAccountIdForSourceOption("custom"), "");
  assert.equal(sourceOptionForMasterClientAccountId("leadcapture_io"), "leadcapture_io");
  assert.equal(sourceOptionForMasterClientAccountId("lal_master_vet"), "lal_master_vet");
  assert.equal(sourceOptionForMasterClientAccountId("madison_pimentel"), "custom");
  assert.equal(sourceOptionForMasterClientAccountId(""), "custom");
});

test("defaultAddRoutingRuleFormValues derives sourceOption from master id", () => {
  assert.equal(
    defaultAddRoutingRuleFormValues({ defaultMasterClientAccountId: "leadcapture_io" }).sourceOption,
    "leadcapture_io"
  );
  assert.equal(
    defaultAddRoutingRuleFormValues({ defaultMasterClientAccountId: "" }).sourceOption,
    "custom"
  );
});

test("Madison NextGen routing rule persists leadcapture_io as masterClientAccountId", () => {
  const form = {
    ...defaultAddRoutingRuleFormValues({ defaultMasterClientAccountId: LEADCAPTURE_MASTER_CLIENT_ACCOUNT_ID }),
    matchType: "campaign_id" as const,
    priority: "100",
    nicheKey: "VET",
    productType: "Final Expense",
    campaignId: "LCIO_NEXTGEN_VET_LIFE_MADISON_PIMENTEL_V2_VET_FEX",
    campaignName: "Madison Pimentel - Vet FEX - LeadCapture NextGen",
    utmCampaign: "Life Insurance For Veterans - Madison Pimentel V2",
  };
  const result = planAddRoutingRuleSubmit({
    form,
    existingRules: [],
    clientAccountId: "madison_pimentel",
    clientDisplayName: "Madison Pimentel",
    destinationSubaccountIdGhl: "wYv6itSb0Ih7i1EwetRC",
    defaultMasterClientAccountId: LEADCAPTURE_MASTER_CLIENT_ACCOUNT_ID,
  });
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.equal(result.createBody.masterClientAccountId, "leadcapture_io");
    assert.equal(result.createBody.clientAccountId, "madison_pimentel");
    assert.equal(result.createBody.destinationSubaccountIdGhl, "wYv6itSb0Ih7i1EwetRC");
    assert.equal(result.createBody.campaignId, "LCIO_NEXTGEN_VET_LIFE_MADISON_PIMENTEL_V2_VET_FEX");
    assert.equal(result.createBody.priority, 100);
  }
});

test("planAddRoutingRuleSubmit preserves priority 900 in create body", () => {
  const form = {
    ...defaultAddRoutingRuleFormValues({ defaultMasterClientAccountId: "leadcapture_io" }),
    campaignId: "NEW_CAMPAIGN",
    priority: "900",
  };
  const result = planAddRoutingRuleSubmit({
    form,
    existingRules: [],
    clientAccountId: "vet_life_james_torrey",
    clientDisplayName: "James Torrey",
    destinationSubaccountIdGhl: "9xSNvQCbGaPE9YNxgl4B",
    defaultMasterClientAccountId: "leadcapture_io",
  });
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.equal(result.createBody.priority, 900);
  }
});

test("planAddRoutingRuleSubmit clears form only on success", () => {
  const form = {
    ...defaultAddRoutingRuleFormValues({ defaultMasterClientAccountId: "leadcapture_io" }),
    campaignId: "NEW_CAMPAIGN",
    priority: "900",
  };
  const result = planAddRoutingRuleSubmit({
    form,
    existingRules: [],
    clientAccountId: "vet_life_james_torrey",
    clientDisplayName: "James Torrey",
    destinationSubaccountIdGhl: "9xSNvQCbGaPE9YNxgl4B",
    defaultMasterClientAccountId: "leadcapture_io",
  });
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.equal(result.createBody.priority, 900);
    assert.equal(result.clearedForm.campaignId, "");
    assert.equal(result.clearedForm.priority, "100");
    assert.notEqual(result.clearedForm.campaignId, form.campaignId);
  }
});

test("planAddRoutingRuleSubmit detects equivalent existing rule", () => {
  const form = {
    ...defaultAddRoutingRuleFormValues({ defaultMasterClientAccountId: "leadcapture_io" }),
    campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
    priority: "900",
  };
  const result = planAddRoutingRuleSubmit({
    form,
    existingRules: [sampleRule()],
    clientAccountId: "vet_life_james_torrey",
    clientDisplayName: "James Torrey",
    destinationSubaccountIdGhl: "9xSNvQCbGaPE9YNxgl4B",
    defaultMasterClientAccountId: "leadcapture_io",
  });
  assert.equal(result.status, "duplicate");
  assert.equal(DUPLICATE_ROUTING_RULE_MESSAGE, "A matching routing rule already exists.");
});

test("findEquivalentRoutingRule ignores rules for different destination location", () => {
  const form = {
    ...defaultAddRoutingRuleFormValues({ defaultMasterClientAccountId: "leadcapture_io" }),
    campaignId: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
  };
  const duplicate = findEquivalentRoutingRule([sampleRule()], {
    masterClientAccountId: "leadcapture_io",
    clientAccountId: "vet_life_james_torrey",
    destinationSubaccountIdGhl: "OTHER_LOCATION",
    matchType: "campaign_id",
    form,
  });
  assert.equal(duplicate, null);
});

test("invalid master account preserves form — plan returns invalid without cleared form", () => {
  const form = {
    ...defaultAddRoutingRuleFormValues({ defaultMasterClientAccountId: "" }),
    masterClientAccountId: "",
    campaignId: "X",
  };
  const result = planAddRoutingRuleSubmit({
    form,
    existingRules: [],
    clientAccountId: "vet_life_james_torrey",
    clientDisplayName: "James Torrey",
    destinationSubaccountIdGhl: "9xSNvQCbGaPE9YNxgl4B",
    defaultMasterClientAccountId: "",
  });
  assert.equal(result.status, "invalid");
  if (result.status === "invalid") {
    assert.match(result.error, /masterClientAccountId/i);
  }
});

test("isAddRoutingRuleSubmitBlocked prevents duplicate submission while pending", () => {
  assert.equal(isAddRoutingRuleSubmitBlocked(true), true);
  assert.equal(isAddRoutingRuleSubmitBlocked(false), false);
});

test("formAfterAddRoutingRuleApiResult preserves values on API failure", () => {
  const current = {
    ...defaultAddRoutingRuleFormValues({ defaultMasterClientAccountId: "leadcapture_io" }),
    campaignId: "KEEP_ME",
    priority: "900",
  };
  const cleared = defaultAddRoutingRuleFormValues({ defaultMasterClientAccountId: "leadcapture_io" });
  assert.deepEqual(
    formAfterAddRoutingRuleApiResult({ currentForm: current, clearedForm: cleared, apiOk: false }),
    current
  );
  assert.deepEqual(
    formAfterAddRoutingRuleApiResult({ currentForm: current, clearedForm: cleared, apiOk: true }),
    cleared
  );
});

test("successful creation plan does not call form reset — uses cleared state object", () => {
  const defaults = defaultAddRoutingRuleFormValues({
    defaultMasterClientAccountId: "leadcapture_io",
    primaryNicheKey: "VET",
  });
  const dirty = { ...defaults, campaignId: "NEW", priority: "900" };
  const result = planAddRoutingRuleSubmit({
    form: dirty,
    existingRules: [],
    clientAccountId: "c1",
    clientDisplayName: "Client",
    destinationSubaccountIdGhl: "loc1",
    defaultMasterClientAccountId: "leadcapture_io",
    primaryNicheKey: "VET",
  });
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.deepEqual(result.clearedForm, defaults);
  }
});
