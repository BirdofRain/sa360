import assert from "node:assert/strict";
import test from "node:test";

import {
  applyListedCampaign,
  applyListedSource,
  draftFromModel,
  guideBlockers,
  guideFacts,
  guideProgress,
  guideSaveRecovery,
  guidedOnboardingFromReads,
  sanitizeSetupData,
  setupDataFromDraft,
  validateDraft,
  validateNewClient,
  type GuidedOnboardingModel,
} from "./onboarding-guide.ts";

function model(overrides: Partial<GuidedOnboardingModel> = {}): GuidedOnboardingModel {
  return {
    clientAccountId: "alex_gross",
    setupWritable: true,
    setupUnavailableReason: null,
    setupStale: false,
    account: {
      clientDisplayName: "Alex Gross",
      status: "onboarding",
      primaryNicheKeys: [],
      primaryProductTypes: [],
    },
    setup: {
      status: "draft",
      revision: 2,
      repairRequired: false,
      missingRequiredFields: [],
      data: { clientEmail: "alex@example.com" },
    },
    recordedSetup: { present: true, status: "draft", revision: 2, destinationChoice: "undecided" },
    sources: { availability: "ready", items: [] },
    campaigns: { availability: "ready", rules: [] },
    destinations: {
      ghl: { configured: false, deliveryEnabled: false },
      companySheets: { configured: false, campaignDispatchEnabled: false, agedDispatchEnabled: false },
    },
    verification: { availability: "ready", blockers: [] },
    operational: false,
    ...overrides,
  };
}

test("a partial setup is saved without becoming configured, verified, or active", () => {
  const facts = guideFacts(model());
  assert.equal(facts.find((fact) => fact.id === "setup_request")?.state, "saved");
  assert.equal(facts.find((fact) => fact.id === "destination_choice")?.state, "pending");
  assert.equal(facts.find((fact) => fact.id === "ghl_destination")?.state, "pending");
  assert.equal(facts.find((fact) => fact.id === "sheets_destination")?.state, "pending");
  assert.equal(facts.find((fact) => fact.id === "setup_review")?.state, "pending");
  assert.equal(facts.find((fact) => fact.id === "activation")?.state, "pending");
  assert.equal(facts.find((fact) => fact.id === "verification")?.state, "pending");
  assert.equal(guideProgress(model()).savedCount >= 1, true);
});

test("a destination choice is saved and does not mark delivery active or configured", () => {
  const facts = guideFacts(
    model({
      setup: {
        status: "draft",
        revision: 3,
        repairRequired: false,
        missingRequiredFields: [],
        data: { destinationChoice: "both" },
      },
    })
  );
  assert.equal(facts.find((fact) => fact.id === "destination_choice")?.state, "saved");
  assert.equal(facts.find((fact) => fact.id === "ghl_destination")?.state, "pending");
  assert.equal(facts.find((fact) => fact.id === "activation")?.state, "pending");
  assert.match(facts.find((fact) => fact.id === "destination_choice")?.detail ?? "", /not configured and not active/);
});

test("configured, verified, and active stay distinct", () => {
  const configured = guideFacts(
    model({
      destinations: {
        ghl: { configured: true, deliveryEnabled: false },
        companySheets: { configured: true, campaignDispatchEnabled: false, agedDispatchEnabled: false },
      },
      campaigns: { availability: "ready", rules: [{ label: "Spring", campaignId: "c1", ruleOn: true, deliveryEnabled: false }] },
      sources: {
        availability: "ready",
        items: [{ id: "src_1", label: "Veteran form", provider: "other", providerFunnelId: "f1", associationStatus: "confirmed" }],
      },
    })
  );
  assert.equal(configured.find((fact) => fact.id === "ghl_destination")?.state, "configured");
  assert.equal(configured.find((fact) => fact.id === "campaign_rules")?.state, "configured");
  assert.equal(configured.find((fact) => fact.id === "linked_sources")?.state, "configured");
  assert.equal(configured.find((fact) => fact.id === "activation")?.state, "pending");

  const verified = guideFacts(
    model({
      setup: {
        status: "setup_reviewed",
        revision: 4,
        repairRequired: false,
        missingRequiredFields: [],
        data: { destinationChoice: "ghl" },
      },
    })
  );
  assert.equal(verified.find((fact) => fact.id === "setup_review")?.state, "verified");
  assert.match(verified.find((fact) => fact.id === "setup_review")?.detail ?? "", /not delivery activation/);
  assert.equal(verified.find((fact) => fact.id === "activation")?.state, "pending");

  const active = guideFacts(
    model({
      destinations: {
        ghl: { configured: true, deliveryEnabled: true },
        companySheets: { configured: true, campaignDispatchEnabled: true, agedDispatchEnabled: false },
      },
    })
  );
  assert.equal(active.find((fact) => fact.id === "ghl_destination")?.state, "active");
  assert.equal(active.find((fact) => fact.id === "sheets_destination")?.state, "active");
  assert.equal(active.find((fact) => fact.id === "activation")?.state, "active");
  assert.match(active.find((fact) => fact.id === "activation")?.detail ?? "", /cannot change that/);
});

test("missing reads stay unavailable and do not invent a destination", () => {
  const facts = guideFacts(
    model({
      setupWritable: false,
      setup: null,
      setupUnavailableReason: "Saving a setup request is unavailable. Native client setup is turned off.",
      sources: { availability: "unavailable", items: [] },
      campaigns: { availability: "unavailable", rules: [] },
      destinations: null,
      verification: { availability: "unavailable" },
    })
  );
  assert.equal(facts.find((fact) => fact.id === "setup_request")?.state, "unavailable");
  assert.equal(facts.find((fact) => fact.id === "linked_sources")?.state, "unavailable");
  assert.equal(facts.find((fact) => fact.id === "ghl_destination")?.state, "unavailable");
  assert.equal(facts.find((fact) => fact.id === "verification")?.state, "unavailable");
  assert.equal(facts.find((fact) => fact.id === "activation")?.state, "pending");
  const blockers = guideBlockers(
    model({
      setupWritable: false,
      setup: null,
      setupUnavailableReason: "Saving a setup request is unavailable. Native client setup is turned off.",
      destinations: null,
      verification: { availability: "unavailable" },
    })
  );
  assert.equal(blockers.some((item) => item.includes("routing rule")), true);
  assert.equal(blockers.some((item) => item.includes("does not turn delivery on")), true);
});

test("validation rejects a bad email and an unsafe new client id", () => {
  const errors = validateDraft(
    {
      ...draftFromModel(model()),
      clientEmail: "not-an-email",
      clientDisplayName: "",
    },
    "account"
  );
  assert.equal(errors.some((error) => error.field === "clientEmail"), true);
  assert.equal(errors.some((error) => error.field === "clientDisplayName"), true);
  assert.equal(validateNewClient({ clientAccountId: "Alex Gross", clientDisplayName: "Alex" }).length > 0, true);
  assert.equal(validateNewClient({ clientAccountId: "alex_gross", clientDisplayName: "Alex Gross" }).length, 0);
});

test("a setup save keeps unrelated request fields and drops operational keys", () => {
  const draft = draftFromModel(model());
  draft.destinationChoice = "both";
  draft.trafficSourceName = "Veteran ads";
  const data = setupDataFromDraft(draft, {
    testLeadUuid: "11111111-1111-4111-8111-111111111111",
    nextgenFunnelUrl: "https://example.com/funnel",
    destinationChoice: "undecided",
  });
  assert.equal(data.destinationChoice, "both");
  assert.equal(data.trafficSourceName, "Veteran ads");
  assert.equal(data.testLeadUuid, "11111111-1111-4111-8111-111111111111");
  assert.equal(data.nextgenFunnelUrl, "https://example.com/funnel");
  const sanitized = sanitizeSetupData({ ...data, deliveryEnabled: true, campaignDispatchEnabled: true, portalLoginEmail: "nope@example.com" });
  assert.equal("deliveryEnabled" in sanitized, false);
  assert.equal("campaignDispatchEnabled" in sanitized, false);
  assert.equal("portalLoginEmail" in sanitized, false);
});

test("choosing a listed source or campaign changes only the setup draft", () => {
  const draft = draftFromModel(model());
  const withSource = applyListedSource(draft, {
    id: "src_1",
    label: "Veteran form",
    provider: "nextgen",
    providerFunnelId: "funnel_1",
    associationStatus: "confirmed",
  });
  assert.equal(withSource.sourceProvider, "nextgen");
  assert.equal(withSource.providerFunnelId, "funnel_1");
  assert.equal("routingRuleId" in withSource, false);
  const withCampaign = applyListedCampaign(withSource, {
    label: "Spring",
    campaignId: "camp_1",
    ruleOn: true,
    deliveryEnabled: true,
  });
  assert.equal(withCampaign.providerCampaignId, "camp_1");
  assert.equal(withCampaign.trafficSourceName, "Veteran form");
});

test("stale revisions reload, and a conflicting save id starts over", () => {
  const stale = guideSaveRecovery("STALE_WRITE", "This setup changed after it was loaded.");
  assert.equal(stale.action, "reload");
  const conflict = guideSaveRecovery(null, 'Admin API error (409): {"ok":false,"code":"REQUEST_ID_CONFLICT","error":"used"}');
  assert.equal(conflict.action, "new_request");
  const retry = guideSaveRecovery(null, "The admin API could not be reached.");
  assert.equal(retry.action, "retry");
  const uncertain = guideSaveRecovery("UNCERTAIN", "The setup save did not finish.");
  assert.equal(uncertain.action, "retry");
  const taken = guideSaveRecovery("CONFLICT", "That client account ID is already in use. Choose a different ID.");
  assert.equal(taken.action, "none");
});

test("a disagreed setup revision is blocked and portal email is not copied into the guide", () => {
  const read = guidedOnboardingFromReads({
    clientAccountId: "alex_gross",
    setupEnabled: true,
    account: {
      clientDisplayName: "Alex Gross",
      status: "onboarding",
      portalLoginEmail: "portal-secret@example.com",
      primaryNicheKeys: ["VET"],
      primaryProductTypes: [],
      routingRules: [{ campaignName: "Spring", campaignId: "camp_1", active: true, deliveryEnabled: false, destinationSubaccountIdGhl: "loc_secret" }],
    },
    setupItem: {
      status: "draft",
      revision: 2,
      repairRequired: false,
      missingRequiredFields: [],
      data: { clientEmail: "alex@example.com", destinationChoice: "ghl" },
      operationalEffects: false,
    },
    setupError: null,
    sourceBody: {
      ok: true,
      items: [{ id: "src_1", provider: "other", providerFunnelId: "f1", observedFunnelName: "https://secret.example/form", associationStatus: "confirmed" }],
    },
    sourceError: null,
    destinations: { ghl: { configured: true, deliveryEnabled: false }, companySheets: { configured: false, campaignDispatchEnabled: false, agedDispatchEnabled: false } },
    recordedSetup: { present: true, status: "draft", revision: 4, destinationChoice: "undecided" },
    verification: { availability: "ready", blockers: ["sheets_destination_saved"] },
  });
  assert.equal(read.setupStale, true);
  assert.equal(read.setupWritable, false);
  const serialized = JSON.stringify(read);
  assert.equal(serialized.includes("portal-secret@example.com"), false);
  assert.equal(serialized.includes("loc_secret"), false);
  assert.equal(serialized.includes("https://secret.example"), false);
  assert.equal(read.campaigns.rules[0]?.label, "Spring");
  assert.equal(read.operational, false);
});

test("reload uses the saved setup document, including a blank destination", () => {
  const read = guidedOnboardingFromReads({
    clientAccountId: "alex_gross",
    setupEnabled: true,
    account: { clientDisplayName: "Alex Gross", status: "active", primaryNicheKeys: ["VET"], primaryProductTypes: ["final_expense"] },
    setupItem: {
      status: "draft",
      revision: 5,
      repairRequired: false,
      missingRequiredFields: ["destinationChoice"],
      data: { clientEmail: "alex@example.com", clientPhone: "555-0100" },
      operationalEffects: false,
    },
    setupError: null,
    sourceBody: { ok: true, items: [] },
    sourceError: null,
    destinations: { ghl: { configured: false, deliveryEnabled: false }, companySheets: { configured: false } },
    recordedSetup: { present: true, status: "draft", revision: 5, destinationChoice: "undecided" },
    verification: { availability: "error" },
  });
  const draft = draftFromModel(read);
  assert.equal(draft.clientEmail, "alex@example.com");
  assert.equal(draft.clientPhone, "555-0100");
  assert.equal(draft.accountStatus, "active");
  assert.equal(draft.destinationChoice, "");
  assert.equal(read.setupWritable, true);
  assert.equal(guideFacts(read).find((fact) => fact.id === "client_account")?.detail.includes("not lead delivery"), true);
});
