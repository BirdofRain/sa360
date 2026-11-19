import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { parseClientCampaignInventory, type CampaignInventoryView } from "@/lib/clients/campaign-inventory.ts";

import { ClientCampaignInventorySection } from "./client-campaign-inventory-section.tsx";

test.afterEach(() => cleanup());

function view(overrides: Partial<CampaignInventoryView> = {}): CampaignInventoryView {
  return {
    candidateCount: 2,
    confirmedSourceCount: 2,
    suggestedSourceCount: 0,
    routingRuleCount: 2,
    ambiguities: [
      {
        code: "multiple_source_candidates",
        message: "This client has more than one source-backed candidate. They were not merged by niche, product, display name, or UTM.",
      },
    ],
    conflicts: [{ code: "absent_campaign_id", message: "No exact campaign id is stored for this candidate." }],
    accountNiches: ["vet_fex", "nurse"],
    ghlLocationId: "loc_ray",
    ghlDeliveryEnabled: false,
    sheetsTitle: "Ray Leads",
    sheetsCampaignTabBound: false,
    candidates: [
      {
        inventoryKey: "source:sf_vet",
        evidenceQuality: "partial",
        grouping: "confirmed_source",
        authorityNote: "Confirmed source association is the routing authority for this candidate.",
        nicheKeys: ["vet_fex"],
        productTypes: [],
        leadTypes: [{ key: "vet_web_form", label: "Vet Web Form" }],
        routingAuthorities: ["confirmed_source_association"],
        exactIdentifiers: [{ kind: "parent_url_key", value: "my.leadcapture.io/p/vet-a" }],
        sources: [
          {
            id: "sf_vet",
            provider: "leadcapture_io",
            providerFunnelId: null,
            parentUrlKey: "my.leadcapture.io/p/vet-a",
            associationStatus: "confirmed",
            originConfirmed: true,
            observedFunnelName: "Ray Rodriguez",
          },
        ],
        rules: [],
        ghlDefaultWorkflowId: "wf_default",
        ghlWorkflows: [],
        sheetsTabTitle: null,
        publishedMapVersion: null,
        lastSourceEventId: "evt_vet",
        lastSourceEventAt: "2026-11-18T12:00:00.000Z",
        observedDelivery: {
          anyRuleDeliveryEnabled: false,
          anyRuleActive: false,
          clientGhlDeliveryEnabled: false,
          sheetsEnabled: false,
          sheetsCampaignDispatchEnabled: false,
        },
        conflicts: ["absent_campaign_id"],
      },
      {
        inventoryKey: "source:sf_nurse",
        evidenceQuality: "high",
        grouping: "exact_identifier",
        authorityNote: "An exact routing rule outranks confirmed source association. This inventory does not change that order.",
        nicheKeys: ["nurse"],
        productTypes: ["health_insurance"],
        leadTypes: [{ key: "nurse_web_form", label: "Nurse Web Form" }],
        routingAuthorities: ["exact_routing_rule", "confirmed_source_association"],
        exactIdentifiers: [{ kind: "campaign_id", value: "camp_nurse" }],
        sources: [
          {
            id: "sf_nurse",
            provider: "leadcapture_io",
            providerFunnelId: "funnel-nurse",
            parentUrlKey: "my.leadcapture.io/p/nurse-b",
            associationStatus: "confirmed",
            originConfirmed: true,
            observedFunnelName: "Ray Rodriguez",
          },
        ],
        rules: [
          {
            id: "rule_nurse",
            matchType: "campaign_id",
            exact: true,
            campaignId: "camp_nurse",
            active: true,
            deliveryEnabled: false,
            deliveryMode: "shadow",
            destinationWorkflowIdGhl: "wf_nurse",
          },
        ],
        ghlDefaultWorkflowId: "wf_default",
        ghlWorkflows: ["wf_nurse"],
        sheetsTabTitle: null,
        publishedMapVersion: null,
        lastSourceEventId: null,
        lastSourceEventAt: null,
        observedDelivery: {
          anyRuleDeliveryEnabled: false,
          anyRuleActive: true,
          clientGhlDeliveryEnabled: false,
          sheetsEnabled: null,
          sheetsCampaignDispatchEnabled: null,
        },
        conflicts: [],
      },
    ],
    ...overrides,
  };
}

test("campaign inventory shows separate niche candidates and has no write controls", () => {
  render(<ClientCampaignInventorySection inventory={view()} loadError={null} />);
  const section = screen.getByTestId("client-campaign-inventory");
  assert.equal(section.querySelector("button"), null);
  assert.equal(section.querySelector("form"), null);
  assert.ok(screen.getByRole("heading", { name: "Campaigns" }));
  assert.ok(screen.getByText(/2 candidates, 2 confirmed sources, 0 suggested, 2 routing rules/));
  assert.ok(screen.getByText("Vet Web Form"));
  assert.ok(screen.getByText("Nurse Web Form"));
  assert.ok(screen.getAllByText("my.leadcapture.io/p/vet-a").length >= 1);
  assert.ok(screen.getAllByText(/camp_nurse/).length >= 1);
  assert.ok(screen.getAllByText(/display name is not ownership/).length >= 1);
  assert.ok(screen.getByText(/They were not merged by niche/));
  assert.ok(screen.getAllByText(/Ray Rodriguez/).length >= 2);
});

test("a failed inventory read is not shown as an empty campaign list", () => {
  render(<ClientCampaignInventorySection inventory={null} loadError="Campaign inventory is unavailable." />);
  assert.ok(screen.getByText("Campaign inventory is unavailable."));
  assert.equal(screen.queryByText(/No campaign candidates/), null);
});

test("an empty inventory stays empty and still describes missing records", () => {
  render(
    <ClientCampaignInventorySection
      inventory={view({
        candidateCount: 0,
        confirmedSourceCount: 0,
        routingRuleCount: 0,
        ambiguities: [],
        conflicts: [],
        candidates: [],
        ghlLocationId: null,
        sheetsTitle: null,
      })}
      loadError={null}
    />
  );
  assert.ok(screen.getByText(/No campaign candidates/));
  assert.ok(screen.getAllByText("Not stored").length >= 1);
});

test("parser rejects a payload that is not a read-only inventory", () => {
  assert.equal(parseClientCampaignInventory({ ok: true, candidates: [] }), null);
  const parsed = parseClientCampaignInventory({
    ok: true,
    readOnly: true,
    summary: { candidateCount: 0, confirmedSourceCount: 0, suggestedSourceCount: 0, routingRuleCount: 0 },
    ambiguities: [],
    conflicts: [],
    accountClassification: { primaryNicheKeys: ["vet_fex"] },
    ghlDestination: null,
    sheetsDestination: null,
    candidates: [],
  });
  assert.equal(parsed?.candidateCount, 0);
  assert.deepEqual(parsed?.accountNiches, ["vet_fex"]);
});
