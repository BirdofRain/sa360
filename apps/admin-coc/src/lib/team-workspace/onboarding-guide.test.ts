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
    ghlConfigurationRequest: { availability: "unreadable", message: "The GoHighLevel configuration request was not loaded. It is not treated as saved." },
    companySheetsConfigurationRequest: { availability: "unreadable", message: "The Company Sheets configuration request was not loaded. It is not treated as saved." },
    operational: false,
    ...overrides,
  };
}

function absentRequest(operational: { configured: boolean; deliveryActive: boolean } = { configured: false, deliveryActive: false }) {
  return { availability: "ready" as const, request: null, operational };
}

function storedRequest(requestId: string, revision: number, operational: { configured: boolean; deliveryActive: boolean } = { configured: false, deliveryActive: false }) {
  return { availability: "ready" as const, request: { requestId, revision }, operational };
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
  assert.equal(guideProgress(model()).summary.includes("5 of 5"), false);
  assert.equal(guideProgress(model()).steps.some((step) => step.badge === "Saved"), true);
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
  assert.match(facts.find((fact) => fact.id === "destination_choice")?.detail ?? "", /not a configuration request/);
  assert.match(facts.find((fact) => fact.id === "destination_choice")?.detail ?? "", /not delivery/);
  assert.equal(guideProgress(model({
    setup: {
      status: "draft",
      revision: 3,
      repairRequired: false,
      missingRequiredFields: [],
      data: { destinationChoice: "both" },
    },
    ghlConfigurationRequest: absentRequest(),
    companySheetsConfigurationRequest: absentRequest(),
    verification: { availability: "unavailable" },
  })).steps.find((step) => step.id === "destination")?.badge, "Pending");
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
  assert.match(active.find((fact) => fact.id === "activation")?.detail ?? "", /cannot change it/);
  assert.equal(active.find((fact) => fact.id === "ghl_configuration_request")?.awaitingApplication, undefined);
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

const GHL_REQUEST_ID = "0addf0ce-1111-4111-8111-111111111111";
const SHEETS_REQUEST_ID = "018ffb0a-2222-4222-8222-222222222222";

function openSourceRequest(revision = 2) {
  return {
    availability: "ready" as const,
    revision,
    openRequest: {
      requestId: "11111111-1111-4111-8111-111111111111",
      status: "requested" as const,
      revision,
      setupRevision: revision,
      providerFunnelId: "funnel-north",
      parentUrlKey: null,
      providerCampaignId: "campaign-north",
      requestedAssociation: true as const,
      createdAt: "2026-11-11T17:20:00.000Z",
    },
  };
}

function assertNoFalseCompletion(summary: string) {
  assert.equal(/\d+ of 5/.test(summary), false);
  assert.equal(/steps saved/i.test(summary), false);
  assert.equal(/\bcomplete\b/i.test(summary), false);
  assert.equal(/\bready\b/i.test(summary), false);
}

test("Northshore is not 5 of 5 when only a draft and destination choice are saved", () => {
  const fresh = model({
    clientAccountId: "northshore_mutual",
    account: { clientDisplayName: "Northshore Mutual", status: "onboarding", primaryNicheKeys: ["VET"], primaryProductTypes: [] },
    setup: {
      status: "draft",
      revision: 1,
      repairRequired: false,
      missingRequiredFields: ["primaryProductTypes"],
      data: { destinationChoice: "both", clientEmail: "ops@northshore.example" },
    },
    recordedSetup: { present: true, status: "draft", revision: 1, destinationChoice: "both" },
    sourceCampaignRequest: { availability: "ready", revision: 0, openRequest: null },
    ghlConfigurationRequest: absentRequest(),
    companySheetsConfigurationRequest: absentRequest(),
    verification: { availability: "unavailable" },
  });
  const progress = guideProgress(fresh);
  assertNoFalseCompletion(progress.summary);
  assert.match(progress.summary, /Client information is pending/);
  assert.match(progress.summary, /niche or a product/i);
  assert.match(progress.summary, /Verification is unavailable/);
  assert.equal(progress.steps.find((step) => step.id === "information")?.state, "pending");
  assert.equal(progress.steps.find((step) => step.id === "destination")?.badge, "Pending");
  assert.equal(progress.steps.find((step) => step.id === "summary")?.badge, "Verification unavailable");
  assert.equal(guideFacts(fresh).find((fact) => fact.id === "ghl_configuration_request")?.state, "pending");
  assert.equal(guideFacts(fresh).some((fact) => fact.state === "active" || fact.state === "verified"), false);
});

test("Northshore can store both destination requests without showing delivery active", () => {
  const stored = model({
    clientAccountId: "northshore_mutual",
    account: { clientDisplayName: "Northshore Mutual", status: "onboarding", primaryNicheKeys: ["VET"], primaryProductTypes: ["final_expense"] },
    setup: {
      status: "draft",
      revision: 4,
      repairRequired: false,
      missingRequiredFields: [],
      data: {
        destinationChoice: "both",
        clientEmail: "ops@northshore.example",
        clientPhone: "555-0101",
        geography: "Florida",
        sourceProvider: "other",
        trafficSourceName: "North page",
        providerFunnelId: "funnel-north",
        providerCampaignId: "campaign-north",
      },
    },
    recordedSetup: { present: true, status: "draft", revision: 4, destinationChoice: "both" },
    sourceCampaignRequest: openSourceRequest(2),
    ghlConfigurationRequest: storedRequest(GHL_REQUEST_ID, 1),
    companySheetsConfigurationRequest: storedRequest(SHEETS_REQUEST_ID, 1),
    verification: { availability: "unavailable" },
  });
  const facts = guideFacts(stored);
  const progress = guideProgress(stored);
  assertNoFalseCompletion(progress.summary);
  assert.equal(facts.find((fact) => fact.id === "client_information")?.state, "saved");
  for (const id of ["source_campaign_request", "ghl_configuration_request", "sheets_configuration_request"]) {
    const fact = facts.find((item) => item.id === id);
    assert.equal(fact?.state, "saved");
    assert.equal(fact?.awaitingApplication, true);
    assert.match(fact?.detail ?? "", /Request saved — awaiting application/);
    assert.equal(fact?.detail.includes("Active"), false);
    assert.equal(fact?.detail.includes("Verified"), false);
  }
  assert.equal(facts.find((fact) => fact.id === "ghl_destination")?.state, "pending");
  assert.equal(facts.find((fact) => fact.id === "sheets_destination")?.state, "pending");
  assert.equal(facts.find((fact) => fact.id === "activation")?.state, "pending");
  assert.equal(progress.steps.find((step) => step.id === "destination")?.badge, "Request saved — awaiting application");
  assert.equal(JSON.stringify(guideProgress(stored)), JSON.stringify(guideProgress(JSON.parse(JSON.stringify(stored)) as GuidedOnboardingModel)));
  const blockers = guideBlockers(stored);
  assert.equal(blockers.some((item) => /saving a gohighlevel location or a company sheets spreadsheet is not available/i.test(item)), false);
  assert.equal(blockers.some((item) => /applying a request to the operational destination is a separate step/i.test(item)), true);
  assert.equal(blockers.some((item) => /does not prove GoHighLevel survey-field mapping/i.test(item)), true);
});

test("Harbor keeps an inactive destination distinct from an active one without a new request", () => {
  const harbor = model({
    clientAccountId: "harbor_benefits",
    account: { clientDisplayName: "Harbor Benefits", status: "paused", primaryNicheKeys: ["VET"], primaryProductTypes: ["final_expense"] },
    setup: {
      status: "draft",
      revision: 2,
      repairRequired: false,
      missingRequiredFields: [],
      data: { clientEmail: "harbor@example.com", clientPhone: "555-0140", geography: "Georgia" },
    },
    ghlConfigurationRequest: absentRequest({ configured: true, deliveryActive: false }),
    companySheetsConfigurationRequest: absentRequest({ configured: true, deliveryActive: false }),
    destinations: {
      ghl: { configured: true, deliveryEnabled: false },
      companySheets: { configured: true, campaignDispatchEnabled: false, agedDispatchEnabled: false },
    },
    verification: { availability: "ready", blockers: ["sheets_column_schema_not_bound"] },
  });
  const facts = guideFacts(harbor);
  assert.equal(facts.find((fact) => fact.id === "ghl_destination")?.state, "configured");
  assert.equal(facts.find((fact) => fact.id === "sheets_destination")?.state, "configured");
  assert.equal(facts.find((fact) => fact.id === "activation")?.state, "pending");
  assert.match(facts.find((fact) => fact.id === "ghl_configuration_request")?.detail ?? "", /not required to call it configured/);
  assert.equal(facts.find((fact) => fact.id === "ghl_configuration_request")?.awaitingApplication, undefined);
  assert.equal(facts.find((fact) => fact.id === "verification")?.state, "blocked");
  assert.equal(guideProgress(harbor).steps.find((step) => step.id === "destination")?.badge, "Configured");
  assertNoFalseCompletion(guideProgress(harbor).summary);
});

test("Summit active delivery is not relabeled as a new request", () => {
  const summit = model({
    clientAccountId: "summit_agency",
    account: { clientDisplayName: "Summit Agency", status: "active", primaryNicheKeys: ["VET"], primaryProductTypes: ["final_expense"] },
    setup: {
      status: "draft",
      revision: 8,
      repairRequired: false,
      missingRequiredFields: [],
      data: { destinationChoice: "both", clientEmail: "summit@example.com" },
    },
    recordedSetup: { present: true, status: "draft", revision: 8, destinationChoice: "both" },
    ghlConfigurationRequest: absentRequest({ configured: true, deliveryActive: true }),
    companySheetsConfigurationRequest: absentRequest({ configured: true, deliveryActive: true }),
    destinations: {
      ghl: { configured: true, deliveryEnabled: true },
      companySheets: { configured: true, campaignDispatchEnabled: true, agedDispatchEnabled: false },
    },
    verification: { availability: "ready", blockers: [] },
  });
  const facts = guideFacts(summit);
  assert.equal(facts.find((fact) => fact.id === "ghl_destination")?.state, "active");
  assert.equal(facts.find((fact) => fact.id === "sheets_destination")?.state, "active");
  assert.equal(facts.find((fact) => fact.id === "activation")?.state, "active");
  assert.match(facts.find((fact) => fact.id === "ghl_configuration_request")?.detail ?? "", /not relabeled as a new request/);
  assert.equal(facts.find((fact) => fact.id === "ghl_configuration_request")?.state, "pending");
  assert.equal(facts.find((fact) => fact.id === "sheets_configuration_request")?.awaitingApplication, undefined);
  assert.equal(guideProgress(summit).steps.find((step) => step.id === "destination")?.badge, "Active");
  assert.equal(/Request saved — awaiting application/.test(guideProgress(summit).summary), false);
});

test("disabled, unauthorized, and unreadable request endpoints do not count as saved", () => {
  const disabled = model({
    setup: {
      status: "draft",
      revision: 2,
      repairRequired: false,
      missingRequiredFields: [],
      data: { destinationChoice: "both" },
    },
    ghlConfigurationRequest: { availability: "disabled", message: "GoHighLevel configuration requests are turned off. Nothing was stored, and delivery was not turned on." },
    companySheetsConfigurationRequest: { availability: "unauthorized", message: "The Company Sheets configuration request could not be read because this session is not allowed to read it. It is not treated as saved." },
    verification: { availability: "unavailable" },
  });
  const facts = guideFacts(disabled);
  assert.equal(facts.find((fact) => fact.id === "ghl_configuration_request")?.state, "unavailable");
  assert.equal(facts.find((fact) => fact.id === "sheets_configuration_request")?.state, "unavailable");
  assert.match(facts.find((fact) => fact.id === "ghl_configuration_request")?.detail ?? "", /turned off/);
  assert.match(facts.find((fact) => fact.id === "sheets_configuration_request")?.detail ?? "", /not allowed/);
  assert.equal(facts.find((fact) => fact.id === "activation")?.state, "pending");
  assert.equal(guideProgress(disabled).steps.find((step) => step.id === "destination")?.badge, "Unavailable");
  assertNoFalseCompletion(guideProgress(disabled).summary);

  const unreadable = model({
    setup: {
      status: "draft",
      revision: 2,
      repairRequired: false,
      missingRequiredFields: [],
      data: { destinationChoice: "ghl" },
    },
    ghlConfigurationRequest: { availability: "unreadable", message: "The GoHighLevel configuration request could not be read. It is not treated as saved." },
    companySheetsConfigurationRequest: absentRequest(),
    verification: { availability: "error" },
  });
  assert.equal(guideFacts(unreadable).find((fact) => fact.id === "ghl_configuration_request")?.state, "unavailable");
  assert.equal(guideFacts(unreadable).find((fact) => fact.id === "sheets_configuration_request")?.state, "not_applicable");
  assert.equal(guideProgress(unreadable).steps.find((step) => step.id === "destination")?.badge, "Unavailable");
});

test("intake only does not imply that delivery is ready", () => {
  const intake = model({
    setup: {
      status: "draft",
      revision: 2,
      repairRequired: false,
      missingRequiredFields: [],
      data: { destinationChoice: "intake_only" },
    },
    recordedSetup: { present: true, status: "draft", revision: 2, destinationChoice: "intake_only" },
    ghlConfigurationRequest: absentRequest(),
    companySheetsConfigurationRequest: absentRequest(),
    verification: { availability: "unavailable" },
  });
  const facts = guideFacts(intake);
  assert.equal(facts.find((fact) => fact.id === "ghl_configuration_request")?.state, "not_applicable");
  assert.equal(facts.find((fact) => fact.id === "sheets_configuration_request")?.state, "not_applicable");
  assert.equal(facts.find((fact) => fact.id === "activation")?.state, "pending");
  assert.match(guideProgress(intake).summary, /delivery is not ready/i);
  assert.equal(guideProgress(intake).steps.find((step) => step.id === "destination")?.badge, "Not applicable");
  assert.equal(/\bcomplete\b/i.test(guideProgress(intake).summary), false);
});

test("a source proposal stays distinct from a confirmed link and active routing", () => {
  const mixed = model({
    sourceCampaignRequest: openSourceRequest(2),
    sources: {
      availability: "ready",
      items: [{ id: "src_1", label: "North page", provider: "other", providerFunnelId: "funnel-north", associationStatus: "confirmed" }],
    },
    campaigns: { availability: "ready", rules: [{ label: "North", campaignId: "campaign-north", ruleOn: true, deliveryEnabled: true }] },
    setup: {
      status: "draft",
      revision: 3,
      repairRequired: false,
      missingRequiredFields: [],
      data: { sourceProvider: "other", trafficSourceName: "Draft only", providerCampaignId: "draft-campaign" },
    },
  });
  const facts = guideFacts(mixed);
  const request = facts.find((fact) => fact.id === "source_campaign_request");
  assert.equal(request?.awaitingApplication, true);
  assert.match(request?.detail ?? "", /not a confirmed source link and not an active routing rule/);
  assert.equal(facts.find((fact) => fact.id === "linked_sources")?.state, "configured");
  assert.equal(facts.find((fact) => fact.id === "campaign_rules")?.state, "active");
  assert.equal(guideProgress(mixed).steps.find((step) => step.id === "sources")?.badge, "Request saved — awaiting application");
  assert.equal(guideProgress(mixed).steps.find((step) => step.id === "sources")?.state, "saved");
});

test("a niche alone does not finish client information, and contact details follow the stored checklist", () => {
  const nicheOnly = model({
    account: { clientDisplayName: "Northshore Mutual", status: "onboarding", primaryNicheKeys: ["VET"], primaryProductTypes: [] },
    setup: {
      status: "draft",
      revision: 1,
      repairRequired: false,
      missingRequiredFields: ["primaryProductTypes"],
      data: {},
    },
  });
  assert.equal(guideFacts(nicheOnly).find((fact) => fact.id === "client_information")?.state, "pending");
  const both = model({
    account: { clientDisplayName: "Northshore Mutual", status: "onboarding", primaryNicheKeys: ["VET"], primaryProductTypes: ["final_expense"] },
    setup: {
      status: "draft",
      revision: 2,
      repairRequired: false,
      missingRequiredFields: [],
      data: { clientEmail: "ops@northshore.example", clientPhone: "555-0101", geography: "Florida" },
    },
  });
  const saved = guideFacts(both).find((fact) => fact.id === "client_information");
  assert.equal(saved?.state, "saved");
  assert.match(saved?.detail ?? "", /ops@northshore.example/);
  const unread = model({ setup: null, setupWritable: false, account: { clientDisplayName: "Northshore Mutual", status: "onboarding", primaryNicheKeys: ["VET"], primaryProductTypes: ["final_expense"] } });
  assert.equal(guideFacts(unread).find((fact) => fact.id === "client_information")?.state, "pending");
});
