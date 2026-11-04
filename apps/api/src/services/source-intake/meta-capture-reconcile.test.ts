import assert from "node:assert/strict";
import test from "node:test";

import { reconcileMetaCaptureForms } from "./meta-capture-reconcile.js";

const PAGE_A = "102720336121632";
const PAGE_B = "102720336121633";
const FORM_SHARED = "1149211490298917";
const FORM_ONLY = "1149211490298918";

test("candidate evidence does not override a confirmed association or a shared form on another Page", () => {
  const rows = reconcileMetaCaptureForms({
    evidence: [
      {
        pageId: PAGE_A,
        formId: FORM_SHARED,
        formName: "Registry name",
        campaignId: "cmp_1",
        origins: ["candidate", "graph"],
      },
      {
        pageId: PAGE_A,
        formId: FORM_SHARED,
        campaignId: "cmp_2",
        origins: ["graph"],
      },
      {
        pageId: PAGE_B,
        formId: FORM_SHARED,
        formName: "Other page form",
        origins: ["candidate"],
      },
      {
        pageId: PAGE_A,
        formId: FORM_ONLY,
        origins: ["graph"],
      },
    ],
    funnels: [
      {
        id: "funnel_confirmed",
        providerFunnelId: `fbpage:${PAGE_A}:fbform:${FORM_SHARED}`,
        originClientAccountId: "client_danielle",
        suggestedClientAccountId: "client_other",
        observedFunnelName: "Confirmed form",
      },
      {
        id: "funnel_suggested",
        providerFunnelId: `fbpage:${PAGE_A}:fbform:${FORM_ONLY}`,
        originClientAccountId: null,
        suggestedClientAccountId: "client_suggested",
        observedFunnelName: null,
      },
    ],
    clients: [
      { clientAccountId: "client_danielle", clientDisplayName: "Danielle" },
      { clientAccountId: "client_suggested", clientDisplayName: "Suggested" },
    ],
    routingRules: [
      {
        id: "rule_1",
        formId: FORM_SHARED,
        campaignId: "cmp_1",
        clientAccountId: "client_routing",
        active: true,
      },
    ],
  });

  const confirmed = rows.find((row) => row.pageId === PAGE_A && row.formId === FORM_SHARED);
  assert.ok(confirmed);
  assert.equal(confirmed.association, "confirmed");
  assert.equal(confirmed.clientAccountId, "client_danielle");
  assert.equal(confirmed.clientDisplayName, "Danielle");
  assert.equal(confirmed.ownershipAuthority, "source_funnel_origin");
  assert.equal(confirmed.routingNote, "routing_rule_present_not_ownership");
  assert.deepEqual(confirmed.routingRuleIds, ["rule_1"]);
  assert.equal(confirmed.createsClient, false);
  assert.equal(confirmed.overwritesConfirmedAssociation, false);
  assert.equal(confirmed.candidateEvidence, true);
  assert.equal(confirmed.pageFormIdentifiesOneClient, false);
  assert.equal(confirmed.sharedAcrossCampaigns, true);
  assert.deepEqual(confirmed.campaignIds, ["cmp_1", "cmp_2"]);

  const shared = rows.find((row) => row.pageId === PAGE_B && row.formId === FORM_SHARED);
  assert.ok(shared);
  assert.equal(shared.association, "unassociated");
  assert.equal(shared.clientAccountId, null);
  assert.equal(shared.ownershipAuthority, "none");

  const suggested = rows.find((row) => row.formId === FORM_ONLY);
  assert.ok(suggested);
  assert.equal(suggested.association, "suggested_not_authority");
  assert.equal(suggested.clientAccountId, null);
  assert.equal(rows.length, 3);
});
