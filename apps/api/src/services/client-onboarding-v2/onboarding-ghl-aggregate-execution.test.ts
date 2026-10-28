/**
 * The mounted GHL path calls the aggregate adapter once.
 * A production host is refused before fetch, even when the mock flags are true.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3, companySheetsCampaignHeader } from "../../lib/company-google-sheets-env.js";
import {
  CONFIRM_DELIVER,
  CONFIRM_REPEAT,
  runCapturedTestDelivery,
  type CapturedTestRequest,
  type CapturedTestWorld,
} from "./captured-test-delivery.js";
import { createFakeGhlLocation, createFakeSheetsAppend, createMemoryCapturedTestStore } from "./captured-test-delivery.fakes.js";
import { capturedTestNoteBuilder } from "./onboarding-note-bridge.js";
import {
  ONBOARDING_GHL_TEST_ADAPTER_APPROVED_FLAG,
  ONBOARDING_GHL_TEST_GLOBAL_FLAG,
  createOnboardingGhlTestAdapter,
} from "./onboarding-ghl-test-adapter.js";

const CLIENT = "client_mock";
const header = [...(companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) ?? [])];

function leadPayload() {
  return {
    contact: {
      first_name: "Alex",
      last_name: "Mock",
      email: "alex.mock@example.invalid",
      phone_e164: "+15555550123",
      state: "VA",
    },
    answerFields: [
      { key: "Primary Reason", value: "Family", canonicalKey: "primary_reason" },
      { key: "Beneficiary", value: "Child", canonicalKey: "beneficiary" },
    ],
  };
}

function world(): CapturedTestWorld {
  const payload = leadPayload();
  return {
    clientFound: true,
    event: {
      id: "evt_mock",
      clientAccountIdResolved: CLIENT,
      status: "routing_matched",
      sourceRouteKey: "leadcapture_form",
      enrichmentMetadataJson: {},
      normalizedPayloadJson: payload,
      receivedAt: "2026-10-26T15:00:00.000Z",
      sourceLeadId: null,
      deliveryResultJson: { receipt: "keep" },
    },
    identities: [{ email: "alex.mock@example.invalid", phoneE164: "+15555550123" }],
    sheets: {
      spreadsheetId: "sheet_mock",
      spreadsheetTitle: "Mock",
      canaryApproved: false,
      campaignDispatchEnabled: false,
      agedDispatchEnabled: false,
      campaign: {
        worksheetId: 4,
        worksheetTitle: "Campaign Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
        header,
      },
      canary: null,
      campaignRisk: { uncertain: false, appendStartedAtHeld: false },
      canaryRisk: { uncertain: false, appendStartedAtHeld: false },
      campaignControl: { establishControl: "drive_owner_verified", checkedAt: "2026-10-26T18:00:00.000Z" },
      destinationRevision: 2,
    },
    ghl: {
      locationId: "locmock",
      isolatedLocationId: null,
      workflowId: "wfselecttz",
      workflowName: "Select Time Zone",
      workflowTriggerMode: "direct_api",
      notesEnabled: true,
      discoveredWorkflows: [{ id: "wfselecttz", name: "Select Time Zone", status: "published" }],
    },
    storedLead: {
      sourceLeadEventId: "evt_mock",
      clientAccountId: CLIENT,
      generatedAt: "2026-10-26T15:00:00.000Z",
      firstName: "Alex",
      lastName: "Mock",
      email: "alex.mock@example.invalid",
      phone: "+15555550123",
      state: "VA",
      answerFields: payload.answerFields,
    },
    production: {
      sourceLeadEventCount: 1,
      inventoryCount: 0,
      billingRowCount: 0,
      dispatchIntentCount: 0,
      eventStatus: "routing_matched",
      eventDeliveryResult: { receipt: "keep" },
      campaignDispatchEnabled: false,
      agedDispatchEnabled: false,
    },
  };
}

function request(overrides: Partial<CapturedTestRequest> = {}): CapturedTestRequest {
  return {
    requestId: "11111111-1111-4111-8111-111111111111",
    kind: "captured_event_delivery",
    clientAccountId: CLIENT,
    sourceLeadEventId: "evt_mock",
    destinations: ["google_sheets", "ghl_location_api"],
    execute: true,
    confirmation: CONFIRM_DELIVER,
    acknowledgeDownstreamAutomation: true,
    isolation: { mode: "verified_test_identity", sheetsContract: "exact_v3_test_worksheet" },
    noteOverflow: "refuse",
    actorLabel: "operator",
    ...overrides,
  };
}

const flags = {
  SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED: "true",
  [ONBOARDING_GHL_TEST_GLOBAL_FLAG]: "true",
  [ONBOARDING_GHL_TEST_ADAPTER_APPROVED_FLAG]: "true",
} as NodeJS.ProcessEnv;

test("sheets plus GHL does not post and does not append", async () => {
  const posts: string[] = [];
  const sheets = createFakeSheetsAppend();
  const steps = createFakeGhlLocation();
  const store = createMemoryCapturedTestStore();
  const adapter = createOnboardingGhlTestAdapter({
    env: flags,
    apiBaseUrl: "https://127.0.0.1:9",
    resolveAuth: async () => ({ token: "injected-loopback-token" }),
    fetch: async (input, init) => {
      const url = String(input);
      assert.equal(url.startsWith("https://127.0.0.1:9"), true);
      assert.equal(url.includes("leadconnectorhq.com"), false);
      posts.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/contacts/upsert")) {
        return new Response(JSON.stringify({ contact: { id: "contactmock1" } }), { status: 200 });
      }
      if (url.endsWith("/notes")) return new Response(JSON.stringify({ note: { id: "notemock1" } }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  const outcome = await runCapturedTestDelivery(request(), world(), {
    env: flags,
    store,
    notes: capturedTestNoteBuilder(),
    sheets,
    ghl: steps,
    ghlAggregate: adapter,
    execution: "injected_fakes",
    rereadSheet: async (sheet) => ({
      header: [...sheet.header],
      headerSha256: sheet.headerSha256,
      control: sheet.control,
      ownerClientAccountId: sheet.ownerClientAccountId,
      destinationRevision: sheet.destinationRevision,
    }),
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error, "google_only_pilot_required");
  assert.equal(steps.calls.length, 0);
  assert.equal(posts.length, 0);
  assert.equal(sheets.calls.length, 0);
});

test("a production GHL host is not contacted when the adapter flags are true", async () => {
  let fetched = 0;
  const adapter = createOnboardingGhlTestAdapter({
    env: flags,
    apiBaseUrl: "https://services.leadconnectorhq.com",
    resolveAuth: async () => ({ token: "must-not-be-sent" }),
    fetch: async () => {
      fetched += 1;
      throw new Error("production host was contacted");
    },
  });
  const outcome = await runCapturedTestDelivery(request({ requestId: "22222222-2222-4222-8222-222222222222", destinations: ["ghl_location_api"] }), world(), {
    env: flags,
    store: createMemoryCapturedTestStore(),
    notes: capturedTestNoteBuilder(),
    ghlAggregate: adapter,
    execution: "injected_fakes",
  });
  assert.equal(fetched, 0);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error, "google_only_pilot_required");
  assert.equal(outcome.externalCalls.ghl, false);
});

test("a GHL-only delivery and a repeat phrase make no aggregate POST", async () => {
  const store = createMemoryCapturedTestStore();
  let posts = 0;
  const adapter = createOnboardingGhlTestAdapter({
    env: flags,
    apiBaseUrl: "https://127.0.0.1:9",
    resolveAuth: async () => ({ token: "injected-loopback-token" }),
    fetch: async () => {
      posts += 1;
      throw new Error("socket closed");
    },
  });
  const deps = {
    env: flags,
    store,
    notes: capturedTestNoteBuilder(),
    ghlAggregate: adapter,
    execution: "injected_fakes" as const,
  };
  const first = await runCapturedTestDelivery(
    request({ requestId: "33333333-3333-4333-8333-333333333333", destinations: ["ghl_location_api"] }),
    world(),
    deps
  );
  assert.equal(first.ok, false);
  if (first.ok) return;
  assert.equal(first.error, "google_only_pilot_required");
  assert.equal(posts, 0);
  const again = await runCapturedTestDelivery(
    request({
      requestId: "44444444-4444-4444-8444-444444444444",
      destinations: ["ghl_location_api"],
      confirmation: CONFIRM_REPEAT,
    }),
    world(),
    deps
  );
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.equal(again.error, "google_only_pilot_required");
  assert.equal(posts, 0);
});
