import assert from "node:assert/strict";
import test from "node:test";

import {
  readCampaignLeadTypeDecision,
  readTrustedCampaignLeadType,
  resolveCampaignLeadType,
  type CampaignLeadTypeDecision,
} from "./campaign-lead-type.js";

const RAY = { id: "sf_ray", leadTypeKey: "vet_web_form" };

test("a confirmed source with no trusted type resolves to Vet Web Form", () => {
  const decision = resolveCampaignLeadType({
    routingAuthority: "confirmed_source_association",
    matched: true,
    sourceAssociation: RAY,
    trusted: null,
  });
  assert.equal(decision.status, "resolved");
  assert.equal(decision.leadTypeKey, "vet_web_form");
  assert.equal(decision.leadTypeLabel, "Vet Web Form");
  assert.equal(decision.binding.kind, "confirmed_source_association");
  assert.equal(decision.binding.id, "sf_ray");
});

test("trusted evidence that matches the binding is agreement", () => {
  const decision = resolveCampaignLeadType({
    routingAuthority: "confirmed_source_association",
    matched: true,
    sourceAssociation: RAY,
    trusted: { key: "vet_web_form", adapter: "campaign_lead_type_catalog" },
  });
  assert.equal(decision.status, "agreement");
  assert.equal(decision.leadTypeKey, "vet_web_form");
  assert.equal(decision.leadTypeLabel, "Vet Web Form");
});

test("trusted evidence that disagrees records a conflict and no label", () => {
  const decision = resolveCampaignLeadType({
    routingAuthority: "confirmed_source_association",
    matched: true,
    sourceAssociation: RAY,
    trusted: { key: "nurse_web_form", adapter: "campaign_lead_type_catalog" },
  });
  assert.equal(decision.status, "conflict");
  assert.equal(decision.leadTypeKey, null);
  assert.equal(decision.leadTypeLabel, null);
  assert.equal(decision.evidence.trustedKey, "nurse_web_form");
  assert.equal(decision.evidence.bindingKey, "vet_web_form");
});

test("a binding with no type stays unresolved and does not adopt trusted input", () => {
  const decision = resolveCampaignLeadType({
    routingAuthority: "confirmed_source_association",
    matched: true,
    sourceAssociation: { id: "sf_bare", leadTypeKey: null },
    trusted: { key: "vet_web_form", adapter: "campaign_lead_type_catalog" },
  });
  assert.equal(decision.status, "unresolved");
  assert.equal(decision.leadTypeKey, null);
  assert.equal(decision.leadTypeLabel, null);
  assert.equal(decision.evidence.trustedKey, "vet_web_form");
});

test("an exact routing rule does not inherit a bypassed source label", () => {
  const decision = resolveCampaignLeadType({
    routingAuthority: "campaign_routing_rule",
    matched: true,
    matchedRuleId: "rule_exact",
    matchType: "campaign_id",
    sourceAssociation: RAY,
    observedSource: RAY,
    trusted: null,
  });
  assert.equal(decision.status, "unresolved");
  assert.equal(decision.leadTypeLabel, null);
  assert.equal(decision.binding.kind, "campaign_routing_rule");
  assert.equal(decision.binding.id, "rule_exact");
  assert.equal(decision.binding.leadTypeKey, null);
  assert.equal(decision.evidence.bypassedSourceLeadTypeKey, "vet_web_form");
});

test("URL text, niche, product, and sheet headers are not trusted", () => {
  const payload = {
    parent_url: "https://go.lifeinsuranceforvets.com/learn-ray-rodriguez",
    funnel_name: "Nurse Web Form",
    niche_key: "VET",
    lead_type: "VET",
    product_type: "Final Expense",
    routing: { niche_key: "NURSE", product_type: "Final Expense" },
    "Lead Type": "Vet Web Form",
  };
  assert.equal(readTrustedCampaignLeadType(payload), null);
  const decision = resolveCampaignLeadType({
    routingAuthority: "confirmed_source_association",
    matched: true,
    sourceAssociation: RAY,
    trusted: readTrustedCampaignLeadType(payload),
  });
  assert.equal(decision.status, "resolved");
  assert.equal(decision.leadTypeLabel, "Vet Web Form");
});

test("an explicit catalog value is trusted and a niche code in that field is not", () => {
  assert.deepEqual(readTrustedCampaignLeadType({ campaign_lead_type: "Nurse Web Form" }), {
    key: "nurse_web_form",
    adapter: "campaign_lead_type_catalog",
  });
  assert.equal(readTrustedCampaignLeadType({ campaign_lead_type: "NURSE" }), null);
  assert.equal(readTrustedCampaignLeadType({ campaign_lead_type: "vet web form" }), null);
});

test("a label change does not rewrite a decision that was already saved", () => {
  const saved = resolveCampaignLeadType({
    routingAuthority: "confirmed_source_association",
    matched: true,
    sourceAssociation: RAY,
    trusted: null,
  });
  const reread = readCampaignLeadTypeDecision({ campaignLeadType: saved });
  const renamed = resolveCampaignLeadType({
    routingAuthority: "confirmed_source_association",
    matched: true,
    sourceAssociation: RAY,
    trusted: null,
    labels: { vet_web_form: "Veteran Webform" },
  });
  assert.equal(saved.leadTypeLabel, "Vet Web Form");
  assert.equal(reread?.leadTypeLabel, "Vet Web Form");
  assert.equal(renamed.leadTypeLabel, "Veteran Webform");
  assert.notEqual(saved, renamed);
});

test("a stored decision round-trips without taking today's label", () => {
  const saved: CampaignLeadTypeDecision = {
    version: 1,
    status: "resolved",
    leadTypeKey: "vet_web_form",
    leadTypeLabel: "Vet Web Form",
    binding: {
      kind: "confirmed_source_association",
      id: "sf_ray",
      leadTypeKey: "vet_web_form",
    },
    evidence: {
      trustedKey: null,
      trustedAdapter: null,
      bindingKey: "vet_web_form",
      bypassedSourceLeadTypeKey: null,
    },
  };
  assert.deepEqual(readCampaignLeadTypeDecision({ campaignLeadType: saved }), saved);
  assert.equal(readCampaignLeadTypeDecision({ matched: true }), null);
});
