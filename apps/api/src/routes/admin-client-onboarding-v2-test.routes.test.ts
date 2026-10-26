import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3, companySheetsCampaignHeader } from "../lib/company-google-sheets-env.js";
import {
  CONFIRM_DELIVER,
  type CapturedTestWorld,
} from "../services/client-onboarding-v2/captured-test-delivery.js";
import {
  createFakeGhlLocation,
  createFakeSheetsAppend,
  createMemoryCapturedTestStore,
  fakeOnboardingLeadNote,
} from "../services/client-onboarding-v2/captured-test-delivery.fakes.js";
import { adminClientOnboardingV2TestRoutes, type CapturedTestRouteOptions } from "./admin-client-onboarding-v2-test.js";

const HEADER = "x-sa360-admin-key";
const CLIENT = "client_a";
const header = [...(companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) ?? [])];

function world(): CapturedTestWorld {
  return {
    clientFound: true,
    event: {
      id: "evt_note_v2",
      clientAccountIdResolved: CLIENT,
      status: "routing_matched",
      sourceRouteKey: "leadcapture_form",
      enrichmentMetadataJson: {},
      normalizedPayloadJson: {
        contact: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.invalid", phone_e164: "+15555550100" },
      },
      receivedAt: "2026-10-26T15:00:00.000Z",
      sourceLeadId: null,
      deliveryResultJson: { receipt: "keep" },
    },
    identities: [{ email: "ada@example.invalid", phoneE164: null }],
    sheets: {
      spreadsheetId: "sheet_client",
      spreadsheetTitle: null,
      canaryApproved: false,
      campaignDispatchEnabled: false,
      agedDispatchEnabled: false,
      campaign: { worksheetId: 10, worksheetTitle: "Campaign Leads", schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3, header },
      canary: null,
      campaignRisk: { uncertain: false, appendStartedAtHeld: false },
      canaryRisk: { uncertain: false, appendStartedAtHeld: false },
    },
    ghl: {
      locationId: "loc_prod",
      isolatedLocationId: null,
      workflowId: "wf_timezone",
      workflowName: "Select Time Zone",
      workflowTriggerMode: "direct_api",
      notesEnabled: true,
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

async function buildApp(opts: CapturedTestRouteOptions = {}) {
  const app = Fastify({ logger: false });
  await app.register(adminClientOnboardingV2TestRoutes, { prefix: "/admin/v1", ...opts });
  return app;
}

test("test-run routes reject a missing admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: `/admin/v1/clients/${CLIENT}/onboarding/test-runs`,
    payload: { requestId: "req", kind: "preview", destinations: ["google_sheets"], execute: false },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("captured delivery stays disabled and calls no fakes while the flag is unset", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const sheets = createFakeSheetsAppend();
  const ghl = createFakeGhlLocation();
  const app = await buildApp({
    env: {},
    loadWorld: () => world(),
    sheets,
    ghl,
    notes: fakeOnboardingLeadNote(),
    execution: "injected_fakes",
  });
  const res = await app.inject({
    method: "POST",
    url: `/admin/v1/clients/${CLIENT}/onboarding/test-runs`,
    headers: { [HEADER]: "admin-secret" },
    payload: {
      requestId: "req_off",
      kind: "captured_event_delivery",
      sourceLeadEventId: "evt_note_v2",
      destinations: ["google_sheets", "ghl_location_api"],
      execute: true,
      confirmation: CONFIRM_DELIVER,
      acknowledgeDownstreamAutomation: true,
      isolation: { mode: "verified_test_identity" },
    },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "captured_test_disabled");
  assert.equal(res.json().externalCalls.providerWebhook, false);
  assert.equal(sheets.calls.length, 0);
  assert.equal(ghl.calls.length, 0);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("preview persists no external calls, and a mismatched body client is rejected", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const sheets = createFakeSheetsAppend();
  const store = createMemoryCapturedTestStore();
  const app = await buildApp({
    env: { SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED: "true" },
    loadWorld: () => world(),
    store,
    sheets,
    notes: fakeOnboardingLeadNote(),
  });
  const mismatch = await app.inject({
    method: "POST",
    url: `/admin/v1/clients/${CLIENT}/onboarding/test-runs`,
    headers: { [HEADER]: "admin-secret" },
    payload: {
      requestId: "req_bad_client",
      kind: "preview",
      destinations: ["google_sheets"],
      execute: false,
      clientAccountId: "someone_else",
    },
  });
  assert.equal(mismatch.statusCode, 400);
  assert.equal(mismatch.json().error, "client_account_mismatch");

  const preview = await app.inject({
    method: "POST",
    url: `/admin/v1/clients/${CLIENT}/onboarding/test-runs`,
    headers: { [HEADER]: "admin-secret" },
    payload: {
      requestId: "req_preview",
      kind: "captured_event_replay",
      sourceLeadEventId: "evt_note_v2",
      destinations: ["google_sheets", "ghl_location_api"],
      execute: false,
    },
  });
  assert.equal(preview.statusCode, 200);
  const body = preview.json();
  assert.equal(body.externalCalls.providerWebhook, false);
  assert.equal(body.externalCalls.sheets, false);
  assert.equal(body.externalCalls.ghl, false);
  assert.equal(body.sourceDeliverySatisfied, false);
  assert.equal(sheets.calls.length, 0);
  const listed = await app.inject({
    method: "GET",
    url: `/admin/v1/clients/${CLIENT}/onboarding/test-runs/${body.testRunId}`,
    headers: { [HEADER]: "admin-secret" },
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().externalCalls.providerWebhook, false);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("a flagged delivery still does not call adapters until execution review, and reconcile does not authorize a resend", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const sheets = createFakeSheetsAppend();
  const ghl = createFakeGhlLocation();
  const store = createMemoryCapturedTestStore();
  const app = await buildApp({
    env: {
      SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED: "true",
      SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED: "true",
    },
    loadWorld: () => world(),
    store,
    sheets,
    ghl,
    notes: fakeOnboardingLeadNote(),
    execution: "disabled_pending_review",
  });
  const res = await app.inject({
    method: "POST",
    url: `/admin/v1/clients/${CLIENT}/onboarding/test-runs`,
    headers: { [HEADER]: "admin-secret" },
    payload: {
      requestId: "req_blocked",
      kind: "captured_event_delivery",
      sourceLeadEventId: "evt_note_v2",
      destinations: ["google_sheets", "ghl_location_api"],
      execute: true,
      confirmation: CONFIRM_DELIVER,
      acknowledgeDownstreamAutomation: true,
      isolation: { mode: "verified_test_identity" },
    },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, "execution_pending_review");
  assert.equal(sheets.calls.length, 0);
  assert.equal(ghl.calls.length, 0);
  assert.equal(res.json().externalCalls.providerWebhook, false);
  assert.equal(res.json().idempotencyKeys.every((key: string) => key.startsWith("onboarding-test:")), true);

  const identity = await app.inject({
    method: "PUT",
    url: `/admin/v1/clients/${CLIENT}/onboarding/test-identities`,
    headers: { [HEADER]: "admin-secret" },
    payload: { requestId: "id_1", email: "ada@example.invalid" },
  });
  assert.equal(identity.statusCode, 409);
  assert.equal(identity.json().persisted, false);

  const reconcile = await app.inject({
    method: "POST",
    url: `/admin/v1/clients/${CLIENT}/onboarding/test-runs/missing/reconcile`,
    headers: { [HEADER]: "admin-secret" },
    payload: { requestId: "recon", observation: "row absent", inspectedAbsentRow: true, clearAppendStartedAt: true },
  });
  assert.equal(reconcile.json().resendAuthorized, false);
  assert.equal(reconcile.json().appendStartedAtCleared, false);
  assert.equal(sheets.calls.length, 0);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
