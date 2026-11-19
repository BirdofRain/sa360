import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClientCampaignInventory,
  type ClientCampaignInventoryInput,
  type InventoryGhlDestination,
  type InventoryRule,
  type InventorySheetsDestination,
  type InventorySource,
} from "./client-campaign-inventory.present.js";

const NOW = new Date("2026-11-19T15:00:00.000Z");

function source(partial: Partial<InventorySource> & Pick<InventorySource, "id">): InventorySource {
  return {
    provider: "leadcapture_io",
    providerFunnelId: null,
    parentUrlKey: `my.leadcapture.io/p/${partial.id}`,
    pageSlug: partial.id,
    observedFunnelName: null,
    nicheKey: null,
    associationStatus: "confirmed",
    originClientAccountId: "client_ray",
    suggestedClientAccountId: null,
    leadTypeKey: null,
    lastSeenAt: null,
    ...partial,
  };
}

function rule(partial: Partial<InventoryRule> & Pick<InventoryRule, "id" | "matchType">): InventoryRule {
  return {
    clientAccountId: "client_ray",
    campaignId: null,
    campaignName: null,
    adsetId: null,
    adId: null,
    formId: null,
    utmCampaign: null,
    keywordPattern: null,
    nicheKey: null,
    productType: null,
    active: true,
    priority: 100,
    deliveryEnabled: false,
    shadowDeliveryEnabled: true,
    deliveryMode: "shadow",
    destinationWorkflowIdGhl: null,
    destinationSubaccountIdGhl: "",
    ...partial,
  };
}

function ghl(partial: Partial<InventoryGhlDestination> = {}): InventoryGhlDestination {
  return {
    locationId: "loc_ray",
    locationName: "Ray",
    defaultWorkflowId: "wf_default",
    deliveryEnabled: false,
    deliveryMode: "shadow",
    workflowTriggerMode: "tag_trigger",
    ...partial,
  };
}

function sheets(partial: Partial<InventorySheetsDestination> = {}): InventorySheetsDestination {
  return {
    spreadsheetId: "sheet_ray",
    spreadsheetTitle: "Ray Leads",
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet_ray",
    worksheetId: 1,
    worksheetTitle: "Leads",
    enabled: false,
    campaignDispatchEnabled: false,
    deliveryExecution: "disabled",
    accessStatus: "readable",
    writeReadiness: "not_verified",
    tabs: [{ role: "campaign", setupState: "bound", worksheetId: 9, worksheetTitle: "Campaign" }],
    columnMaps: [
      {
        spreadsheetId: "sheet_ray",
        worksheetId: 9,
        mapVersion: 2,
        status: "published",
        publishedAt: "2026-11-01T00:00:00.000Z",
        retiredAt: null,
      },
    ],
    ...partial,
  };
}

function input(partial: Partial<ClientCampaignInventoryInput> = {}): ClientCampaignInventoryInput {
  return {
    clientAccountId: "client_ray",
    primaryNicheKeys: ["vet_fex"],
    primaryProductTypes: ["life_insurance"],
    sources: [],
    rules: [],
    otherClientRules: [],
    associationRequest: null,
    setup: null,
    ghl: ghl(),
    sheets: sheets(),
    sourceEvents: [],
    foreignSourceEvents: [],
    sourceEventLookupCapped: false,
    now: NOW,
    ...partial,
  };
}

test("multi-niche sources stay separate and do not inherit account niche", () => {
  const inventory = buildClientCampaignInventory(
    input({
      sources: [
        source({
          id: "sf_vet",
          parentUrlKey: "my.leadcapture.io/p/vet-a",
          observedFunnelName: "Ray Rodriguez",
          nicheKey: "vet_fex",
          leadTypeKey: "vet_web_form",
        }),
        source({
          id: "sf_nurse",
          parentUrlKey: "my.leadcapture.io/p/nurse-b",
          observedFunnelName: "Ray Rodriguez",
          nicheKey: "nurse",
          leadTypeKey: "nurse_web_form",
        }),
      ],
      rules: [
        rule({
          id: "rule_vet",
          matchType: "campaign_id",
          campaignId: "camp_vet",
          nicheKey: "vet_fex",
          productType: "life_insurance",
          destinationWorkflowIdGhl: "wf_vet",
        }),
        rule({
          id: "rule_nurse",
          matchType: "campaign_id",
          campaignId: "camp_nurse",
          nicheKey: "nurse",
          productType: "health_insurance",
          destinationWorkflowIdGhl: "wf_nurse",
        }),
      ],
    })
  );

  assert.equal(inventory.readOnly, true);
  assert.equal(inventory.writesPerformed, false);
  assert.equal(inventory.summary.candidateCount, 4);
  assert.deepEqual(
    inventory.candidates.map((candidate) => candidate.nicheKeys),
    [["nurse"], ["vet_fex"], ["nurse"], ["vet_fex"]]
  );
  assert.equal(inventory.candidates.some((candidate) => candidate.sources.length > 0 && candidate.rules.length > 0), false);
  assert.equal(inventory.ambiguities.some((item) => item.code === "multiple_source_candidates"), true);
  assert.deepEqual(inventory.accountClassification.primaryNicheKeys, ["vet_fex"]);
  assert.equal(
    inventory.candidates.some((candidate) => candidate.nicheKeys.includes("vet_fex") && candidate.sources[0]?.id === "sf_nurse"),
    false
  );
  const vet = inventory.candidates.find((candidate) => candidate.sources[0]?.id === "sf_vet");
  assert.equal(vet?.leadTypes[0]?.label, "Vet Web Form");
  assert.equal(vet?.routingAuthorities.includes("confirmed_source_association"), true);
  assert.equal(vet?.ghl.scope, "client_shared");
  assert.equal(vet?.ghl.clientDefaultWorkflowId, "wf_default");
  assert.equal(vet?.sheets.campaignTab?.worksheetTitle, "Campaign");
  assert.equal(vet?.sheets.publishedMap?.mapVersion, 2);
});

test("same niche and same display name do not merge two campaigns", () => {
  const inventory = buildClientCampaignInventory(
    input({
      sources: [
        source({
          id: "sf_vet_a",
          providerFunnelId: "funnel-a",
          parentUrlKey: "my.leadcapture.io/p/vet-a",
          observedFunnelName: "Veteran FEX",
          nicheKey: "vet_fex",
          leadTypeKey: "vet_web_form",
        }),
        source({
          id: "sf_vet_b",
          providerFunnelId: "funnel-b",
          parentUrlKey: "my.leadcapture.io/p/vet-b",
          observedFunnelName: "Veteran FEX",
          nicheKey: "vet_fex",
          leadTypeKey: "vet_web_form",
        }),
      ],
      rules: [
        rule({
          id: "rule_a",
          matchType: "campaign_id",
          campaignId: "my.leadcapture.io/p/vet-a",
          campaignName: "Veteran FEX",
          nicheKey: "vet_fex",
          productType: "life_insurance",
          utmCampaign: "veteran",
          destinationWorkflowIdGhl: "wf_vet",
          deliveryEnabled: false,
        }),
        rule({
          id: "rule_b",
          matchType: "campaign_id",
          campaignId: "camp_meta_vet",
          campaignName: "Veteran FEX",
          nicheKey: "vet_fex",
          productType: "life_insurance",
          utmCampaign: "veteran",
          destinationWorkflowIdGhl: "wf_vet",
        }),
      ],
    })
  );

  assert.equal(inventory.summary.candidateCount, 3);
  const joined = inventory.candidates.find((candidate) => candidate.sources.some((item) => item.id === "sf_vet_a"));
  assert.equal(joined?.rules.length, 1);
  assert.equal(joined?.rules[0]?.id, "rule_a");
  assert.equal(joined?.grouping, "exact_identifier");
  assert.equal(joined?.evidenceQuality, "high");
  assert.equal(joined?.sources[0]?.displayNameIsNotOwnership, true);
  assert.equal(joined?.observedDelivery.anyRuleDeliveryEnabled, false);
  const meta = inventory.candidates.find((candidate) => candidate.rules.some((item) => item.id === "rule_b"));
  assert.equal(meta?.sources.length, 0);
  assert.equal(meta?.conflicts.includes("missing_origin_confirmation"), true);
  const pageB = inventory.candidates.find((candidate) => candidate.sources.some((item) => item.id === "sf_vet_b"));
  assert.equal(pageB?.rules.length, 0);
  assert.equal(pageB?.conflicts.includes("absent_campaign_id"), true);
});

test("overlapping exact campaign ids join despite different niches and flag the other client", () => {
  const inventory = buildClientCampaignInventory(
    input({
      sources: [
        source({
          id: "sf_form",
          providerFunnelId: "form-shared",
          parentUrlKey: "my.leadcapture.io/p/shared",
          nicheKey: "vet_fex",
          leadTypeKey: "vet_web_form",
        }),
      ],
      rules: [
        rule({
          id: "rule_vet",
          matchType: "campaign_id",
          campaignId: "camp_shared",
          nicheKey: "vet_fex",
          productType: "life_insurance",
        }),
        rule({
          id: "rule_nurse",
          matchType: "campaign_id",
          campaignId: "camp_shared",
          nicheKey: "nurse",
          productType: "health_insurance",
          destinationWorkflowIdGhl: "wf_nurse",
        }),
        rule({
          id: "rule_form",
          matchType: "form_id_utm_campaign",
          formId: "form-shared",
          utmCampaign: "not-used-for-grouping",
          nicheKey: "vet_fex",
          productType: "life_insurance",
        }),
      ],
      otherClientRules: [
        {
          id: "rule_other",
          clientAccountId: "client_other",
          matchType: "campaign_id",
          campaignId: "camp_shared",
          adsetId: null,
          adId: null,
          formId: null,
        },
      ],
      foreignSourceEvents: [
        {
          id: "evt_other",
          receivedAt: "2026-11-18T00:00:00.000Z",
          status: "routed",
          sourceCampaignId: "camp_shared",
          sourceRouteKey: null,
          routingRuleIdResolved: "rule_other",
          clientAccountIdResolved: "client_other",
        },
      ],
      sourceEvents: [
        {
          id: "evt_old",
          receivedAt: "2026-11-01T00:00:00.000Z",
          status: "routed",
          sourceCampaignId: "camp_shared",
          sourceRouteKey: null,
          routingRuleIdResolved: "rule_vet",
          clientAccountIdResolved: "client_ray",
        },
        {
          id: "evt_new",
          receivedAt: "2026-11-18T12:00:00.000Z",
          status: "routed",
          sourceCampaignId: "form-shared",
          sourceRouteKey: "my.leadcapture.io/p/shared",
          routingRuleIdResolved: null,
          clientAccountIdResolved: "client_ray",
        },
      ],
    })
  );

  assert.equal(inventory.summary.candidateCount, 2);
  const shared = inventory.candidates.find((candidate) => candidate.rules.some((item) => item.id === "rule_vet"));
  const form = inventory.candidates.find((candidate) => candidate.rules.some((item) => item.id === "rule_form"));
  assert.deepEqual(shared?.rules.map((item) => item.id).sort(), ["rule_nurse", "rule_vet"]);
  assert.equal(shared?.sources.length, 0);
  assert.equal(shared?.evidenceQuality, "conflicting");
  assert.equal(shared?.conflicts.includes("overlapping_exact_identifiers"), true);
  assert.equal(shared?.conflicts.includes("exact_identifier_on_other_client"), true);
  assert.equal(shared?.conflicts.includes("classification_disagreement"), true);
  assert.equal(shared?.conflicts.includes("source_event_resolved_to_other_client"), true);
  assert.equal(shared?.lastSourceEvent?.id, "evt_old");
  assert.equal(shared?.nicheKeys.includes("vet_fex"), true);
  assert.equal(shared?.nicheKeys.includes("nurse"), true);
  assert.equal(form?.sources[0]?.id, "sf_form");
  assert.equal(form?.rules.length, 1);
  assert.equal(form?.conflicts.includes("overlapping_exact_identifiers"), false);
  assert.equal(form?.lastSourceEvent?.id, "evt_new");
  assert.equal(form?.rules[0]?.utmCampaign, "not-used-for-grouping");
});

test("UTM and keyword rules are not grouped by text, niche, or display name", () => {
  const inventory = buildClientCampaignInventory(
    input({
      primaryNicheKeys: ["vet_fex", "nurse"],
      sources: [
        source({
          id: "sf_vet",
          observedFunnelName: "veteran leads",
          nicheKey: "vet_fex",
          leadTypeKey: "vet_web_form",
        }),
      ],
      rules: [
        rule({
          id: "rule_utm",
          matchType: "utm_campaign",
          utmCampaign: "veteran",
          campaignName: "veteran leads",
          nicheKey: "vet_fex",
          productType: "life_insurance",
          deliveryEnabled: true,
          deliveryMode: "live",
        }),
        rule({
          id: "rule_keyword",
          matchType: "keyword_fallback",
          keywordPattern: "nurse",
          nicheKey: "nurse",
          productType: "health_insurance",
        }),
      ],
    })
  );

  assert.equal(inventory.summary.candidateCount, 3);
  assert.equal(inventory.summary.looseRuleCount, 2);
  assert.equal(inventory.candidates.filter((candidate) => candidate.grouping === "loose_rule").length, 2);
  for (const candidate of inventory.candidates.filter((item) => item.grouping === "loose_rule")) {
    assert.equal(candidate.sources.length, 0);
    assert.equal(candidate.evidenceQuality, "low");
    assert.equal(candidate.conflicts.includes("loose_rule_not_grouped"), true);
    assert.equal(candidate.routingAuthorities.includes("confirmed_source_association"), false);
  }
  const keyword = inventory.candidates.find((candidate) => candidate.rules[0]?.id === "rule_keyword");
  assert.equal(keyword?.observedDelivery.anyRuleDeliveryEnabled, false);
  const utm = inventory.candidates.find((candidate) => candidate.rules[0]?.id === "rule_utm");
  assert.equal(utm?.observedDelivery.anyRuleDeliveryEnabled, true);
  assert.equal(utm?.observedDelivery.clientGhlDeliveryEnabled, false);
});

test("missing metadata, unknown lead type, and a legacy rule-only client stay explicit", () => {
  const missing = buildClientCampaignInventory(
    input({
      primaryNicheKeys: [],
      primaryProductTypes: [],
      ghl: null,
      sheets: null,
      sources: [
        source({
          id: "sf_blank",
          nicheKey: null,
          leadTypeKey: "not_a_catalog_key",
          observedFunnelName: "Untitled",
        }),
      ],
    })
  );
  const blank = missing.candidates[0]!;
  assert.equal(blank.evidenceQuality, "conflicting");
  assert.equal(blank.conflicts.includes("absent_campaign_id"), true);
  assert.equal(blank.conflicts.includes("missing_niche"), true);
  assert.equal(blank.conflicts.includes("missing_lead_type"), true);
  assert.equal(blank.conflicts.includes("unknown_lead_type"), true);
  assert.equal(blank.conflicts.includes("missing_ghl_destination"), true);
  assert.equal(blank.conflicts.includes("missing_sheets_destination"), true);
  assert.equal(blank.leadTypes[0]?.label, null);
  assert.equal(blank.ghl.locationId, null);
  assert.equal(blank.sheets.configured, false);

  const legacy = buildClientCampaignInventory(
    input({
      ghl: null,
      sheets: null,
      sources: [],
      rules: [
        rule({
          id: "rule_legacy",
          matchType: "campaign_id",
          campaignId: "LCIO_LEGACY_VET",
          campaignName: "Legacy Vet",
          nicheKey: "vet_fex",
          active: true,
          deliveryEnabled: false,
        }),
      ],
    })
  );
  assert.equal(legacy.summary.confirmedSourceCount, 0);
  assert.equal(legacy.summary.candidateCount, 1);
  assert.equal(legacy.candidates[0]?.grouping, "exact_rule");
  assert.equal(legacy.candidates[0]?.evidenceQuality, "partial");
  assert.equal(legacy.candidates[0]?.conflicts.includes("missing_origin_confirmation"), true);
  assert.equal(legacy.candidates[0]?.conflicts.includes("missing_lead_type"), true);
  assert.equal(legacy.candidates[0]?.conflicts.includes("absent_campaign_id"), false);
  assert.equal(legacy.ambiguities.some((item) => item.code === "multiple_source_candidates"), false);
});

test("a saved request and one setup row do not join or represent multiple candidates", () => {
  const inventory = buildClientCampaignInventory(
    input({
      sources: [
        source({
          id: "sf_vet",
          providerFunnelId: "funnel-vet",
          parentUrlKey: "my.leadcapture.io/p/vet",
          nicheKey: "vet_fex",
          leadTypeKey: "vet_web_form",
          associationStatus: "suggested",
          originClientAccountId: null,
          suggestedClientAccountId: "client_ray",
        }),
        source({
          id: "sf_nurse",
          providerFunnelId: "funnel-nurse",
          parentUrlKey: "my.leadcapture.io/p/nurse",
          nicheKey: "nurse",
          leadTypeKey: "nurse_web_form",
        }),
      ],
      rules: [
        rule({
          id: "rule_nurse",
          matchType: "campaign_id",
          campaignId: "camp_nurse",
          nicheKey: "nurse",
          productType: "health_insurance",
        }),
      ],
      associationRequest: {
        id: "req_1",
        revision: 3,
        status: "requested",
        providerFunnelId: "funnel-vet",
        parentUrlKey: "my.leadcapture.io/p/vet",
        providerCampaignId: "camp_nurse",
      },
      setup: {
        readable: true,
        revision: 4,
        status: "draft",
        providerFunnelId: "funnel-vet",
        parentUrlKey: null,
        providerCampaignId: "camp_nurse",
      },
    })
  );

  assert.equal(inventory.associationRequest?.operational, false);
  assert.equal(inventory.setupRequest?.operational, false);
  assert.equal(inventory.summary.candidateCount, 3);
  const vet = inventory.candidates.find((candidate) => candidate.sources[0]?.id === "sf_vet");
  const nurseRule = inventory.candidates.find((candidate) => candidate.rules[0]?.id === "rule_nurse");
  assert.equal(vet?.conflicts.includes("association_request_not_a_join"), true);
  assert.equal(nurseRule?.conflicts.includes("association_request_not_a_join"), true);
  assert.equal(vet?.sources[0]?.originConfirmed, false);
  assert.equal(vet?.evidenceQuality, "conflicting");
  assert.equal(nurseRule?.setupRequestMatchesCampaignId, true);
  assert.equal(vet?.setupRequestMatchesCampaignId, false);
  assert.equal(inventory.ambiguities.some((item) => item.code === "single_setup_request_for_many_candidates"), true);
  assert.equal(inventory.ambiguities.some((item) => item.code === "multiple_source_candidates"), true);
});

test("an empty client reports missing destinations without inventing a campaign", () => {
  const inventory = buildClientCampaignInventory(
    input({
      ghl: null,
      sheets: null,
      primaryNicheKeys: ["vet_fex"],
    })
  );
  assert.equal(inventory.summary.candidateCount, 0);
  assert.deepEqual(
    inventory.conflicts.map((item) => item.code).sort(),
    ["missing_ghl_destination", "missing_ghl_workflow", "missing_sheets_destination"]
  );
  assert.deepEqual(inventory.accountClassification.primaryNicheKeys, ["vet_fex"]);
  assert.equal(inventory.candidates.length, 0);
});

test("a form id joins its source and a matching UTM string does not", () => {
  const inventory = buildClientCampaignInventory(
    input({
      sources: [
        source({
          id: "sf_form",
          providerFunnelId: "form-9",
          parentUrlKey: "my.leadcapture.io/p/form-9",
          nicheKey: "vet_fex",
          leadTypeKey: "vet_web_form",
        }),
      ],
      rules: [
        rule({
          id: "rule_form",
          matchType: "form_id_utm_campaign",
          formId: "form-9",
          utmCampaign: "my.leadcapture.io/p/someone-else",
          nicheKey: "vet_fex",
          productType: "life_insurance",
          destinationWorkflowIdGhl: "wf_vet",
        }),
        rule({
          id: "rule_utm",
          matchType: "utm_campaign",
          utmCampaign: "my.leadcapture.io/p/form-9",
          nicheKey: "vet_fex",
          productType: "life_insurance",
        }),
      ],
    })
  );

  const form = inventory.candidates.find((candidate) => candidate.rules.some((item) => item.id === "rule_form"));
  assert.equal(form?.sources[0]?.id, "sf_form");
  assert.equal(form?.conflicts.includes("absent_campaign_id"), true);
  assert.equal(form?.evidenceQuality, "partial");
  const utm = inventory.candidates.find((candidate) => candidate.rules.some((item) => item.id === "rule_utm"));
  assert.equal(utm?.sources.length, 0);
  assert.equal(utm?.grouping, "loose_rule");
});
