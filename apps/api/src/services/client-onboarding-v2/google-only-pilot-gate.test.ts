import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";

import {
  CONFIRM_DELIVER,
  CONFIRM_ONE_GOOGLE_SHEETS_ROW,
  CONFIRM_REPEAT,
  isGoogleOnlyPilotEnabled,
  runCapturedTestDelivery,
  sha256Text,
  type CapturedTestRequest,
  type CapturedTestWorld,
  type TestDestination,
  type TestRunKind,
} from "./captured-test-delivery.js";
import { createFakeGhlLocation, createFakeSheetsAppend, createMemoryCapturedTestStore } from "./captured-test-delivery.fakes.js";
import { deliverOnboardingGhlCapturedTest } from "./onboarding-ghl-test-adapter.js";
import { adminClientOnboardingV2TestRoutes } from "../../routes/admin-client-onboarding-v2-test.js";
import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3, companySheetsCampaignHeader } from "../../lib/company-google-sheets-env.js";

const header = [...(companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) ?? [])];
const CLIENT = "alex_gross_fixture";

function flags(captured: boolean, pilot: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED: "true" };
  if (captured) env.SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED = "true";
  if (pilot) env.SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED = "true";
  return env;
}

function request(kind: TestRunKind, confirmation: string, destinations: TestDestination[]): CapturedTestRequest {
  return {
    requestId: randomUUID(),
    kind,
    clientAccountId: CLIENT,
    sourceLeadEventId: "evt_operator",
    destinations,
    execute: kind === "preview" || kind === "captured_event_replay" ? false : true,
    confirmation,
    isolation: { mode: "isolated_destination", sheetsContract: "exact_v3_test_worksheet" },
    actorLabel: "operator",
  };
}

function world(): CapturedTestWorld {
  return {
    clientFound: true,
    event: {
      id: "evt_operator",
      clientAccountIdResolved: CLIENT,
      status: "received",
      sourceRouteKey: "operator_owned_test",
      sourceProvider: "manual_import",
      sourceSystem: "external_vendor",
      sourceType: "manual_entry",
      webhookRequestLogId: null,
      enrichmentMetadataJson: { recordClass: "onboarding_operator_owned_test" },
      normalizedPayloadJson: { contact: { email: "operator-owned@sa360.pilot", phone_e164: "+15551230000" } },
      receivedAt: "2026-10-28T15:00:00.000Z",
      sourceLeadId: null,
      deliveryResultJson: null,
      downstream: { inventoryCount: 0, fulfillmentCount: 0, allocationCount: 0, dispatchIntentCount: 0 },
    },
    identities: [{ email: "operator-owned@sa360.pilot", phoneE164: "+15551230000" }],
    testIdentitySharedWithOtherClient: false,
    sheets: {
      spreadsheetId: "prod_sheet",
      spreadsheetTitle: "Production",
      canaryApproved: false,
      campaignDispatchEnabled: false,
      agedDispatchEnabled: false,
      campaign: { worksheetId: 15, worksheetTitle: "VET Web Form", schemaVersion: "company_sheets_campaign_custom_v1", header: ["Name"] },
      canary: null,
      campaignRisk: { uncertain: false, appendStartedAtHeld: false },
      canaryRisk: { uncertain: false, appendStartedAtHeld: false },
      campaignControl: { establishControl: "approved_shared_drive", checkedAt: "2026-10-28T15:00:00.000Z" },
      destinationRevision: 4,
      approvedTestWorksheet: {
        spreadsheetId: "test_sheet",
        worksheetId: 77,
        worksheetTitle: "Onboarding Test Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
        header,
        headerSha256: sha256Text(JSON.stringify(header)),
        destinationRevision: 1,
        ownerClientAccountId: CLIENT,
        control: { establishControl: "approved_shared_drive", checkedAt: "2026-10-28T15:00:00.000Z" },
      },
      approvedTestWorksheetRisk: { uncertain: false, appendStartedAtHeld: false },
    },
    ghl: null,
    production: {
      sourceLeadEventCount: 0,
      inventoryCount: 0,
      billingRowCount: 0,
      dispatchIntentCount: 0,
      eventStatus: "received",
      eventDeliveryResult: null,
      campaignDispatchEnabled: false,
      agedDispatchEnabled: false,
    },
  };
}

const phrases = [
  ["deliver", CONFIRM_DELIVER],
  ["repeat", CONFIRM_REPEAT],
  ["one-shot", CONFIRM_ONE_GOOGLE_SHEETS_ROW],
] as const;
const destinations: Array<["sheets", TestDestination[]] | ["ghl", TestDestination[]] | ["both", TestDestination[]]> = [
  ["sheets", ["google_sheets"]],
  ["ghl", ["ghl_location_api"]],
  ["both", ["google_sheets", "ghl_location_api"]],
];
const matrix = [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
] as const;

test("the pilot flag enables only on the exact string true", () => {
  assert.equal(isGoogleOnlyPilotEnabled({}), false);
  assert.equal(isGoogleOnlyPilotEnabled({ SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED: "TRUE" }), false);
  assert.equal(isGoogleOnlyPilotEnabled({ SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED: "true" }), true);
});

test("only both flags and the one-shot Google request can reach the sheets writer", async () => {
  for (const [captured, pilot] of matrix) {
    for (const [phraseName, confirmation] of phrases) {
      for (const [destinationName, destinationList] of destinations) {
        const sheets = createFakeSheetsAppend();
        const ghl = createFakeGhlLocation();
        const outcome = await runCapturedTestDelivery(request("captured_event_delivery", confirmation, destinationList), world(), {
          env: flags(captured, pilot),
          store: createMemoryCapturedTestStore(),
          sheets,
          ghl,
          execution: "injected_fakes",
          rereadSheet: async (sheet) => ({
            header: [...sheet.header],
            headerSha256: sheet.headerSha256,
            control: sheet.control,
            ownerClientAccountId: sheet.ownerClientAccountId,
            destinationRevision: sheet.destinationRevision,
            historicalDataRows: "empty" as const,
          }),
        });
        const authorized = captured && pilot && phraseName === "one-shot" && destinationName === "sheets";
        if (!authorized) {
          assert.equal(outcome.ok, false, `${captured}/${pilot} ${phraseName} ${destinationName}`);
          assert.equal(sheets.calls.length, 0, `${captured}/${pilot} ${phraseName} ${destinationName}`);
          assert.equal(ghl.calls.length, 0, `${captured}/${pilot} ${phraseName} ${destinationName}`);
        } else {
          assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.error);
          assert.equal(sheets.calls.length, 1);
          assert.equal(ghl.calls.length, 0);
        }
      }
    }
  }
});

test("synthetic delivery and a changed replay phrase make no external call", async () => {
  const sheets = createFakeSheetsAppend();
  const synthetic = await runCapturedTestDelivery(
    request("synthetic_delivery", CONFIRM_ONE_GOOGLE_SHEETS_ROW, ["google_sheets"]),
    world(),
    { env: flags(true, true), store: createMemoryCapturedTestStore(), sheets, execution: "injected_fakes", syntheticSheets: { async send() { throw new Error("synthetic"); } } }
  );
  assert.equal(synthetic.ok, false);
  if (synthetic.ok) return;
  assert.equal(synthetic.error, "google_only_pilot_required");
  assert.equal(sheets.calls.length, 0);

  const store = createMemoryCapturedTestStore();
  const env = flags(true, true);
  const firstRequest = request("captured_event_delivery", CONFIRM_ONE_GOOGLE_SHEETS_ROW, ["google_sheets"]);
  const first = await runCapturedTestDelivery(firstRequest, world(), {
    env,
    store,
    sheets,
    execution: "injected_fakes",
    rereadSheet: async (sheet) => ({
      header: [...sheet.header],
      headerSha256: sheet.headerSha256,
      control: sheet.control,
      ownerClientAccountId: sheet.ownerClientAccountId,
      destinationRevision: sheet.destinationRevision,
      historicalDataRows: "empty" as const,
    }),
  });
  assert.equal(first.ok, true);
  const replay = await runCapturedTestDelivery({ ...firstRequest, confirmation: CONFIRM_DELIVER }, world(), {
    env,
    store,
    sheets,
    execution: "injected_fakes",
  });
  assert.equal(replay.ok, false);
  if (replay.ok) return;
  assert.equal(replay.error, "revision_conflict");
  assert.equal(sheets.calls.length, 1);
});

test("a mounted HTTP call uses the same gate", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const sheets = createFakeSheetsAppend();
  const app = Fastify({ logger: false });
  await app.register(adminClientOnboardingV2TestRoutes, {
    prefix: "/admin/v1",
    env: flags(true, false),
    execution: "injected_fakes",
    store: createMemoryCapturedTestStore(),
    sheets,
    loadWorld: () => world(),
  });
  const res = await app.inject({
    method: "POST",
    url: `/admin/v1/clients/${CLIENT}/onboarding/test-runs`,
    headers: { "x-sa360-admin-key": "admin-secret" },
    payload: request("captured_event_delivery", CONFIRM_DELIVER, ["google_sheets", "ghl_location_api"]),
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, "google_only_pilot_required");
  assert.equal(sheets.calls.length, 0);
  await app.close();
  if (prev === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = prev;
});

test("the GHL adapter refuses a direct call while the pilot flag is on", async () => {
  let fetches = 0;
  const receipt = await deliverOnboardingGhlCapturedTest(
    {
      clientAccountId: CLIENT,
      testRunId: "run",
      sourceLeadEventId: "evt",
      authorization: { scope: "client", clientAccountId: CLIENT, testRunId: "run", granted: true },
      verifiedTestIdentity: { email: "operator-owned@sa360.pilot" },
      contact: { email: "operator-owned@sa360.pilot" },
      event: { sourceLeadEventId: "evt", clientAccountId: CLIENT },
      locationId: "loc",
      selectedLocationId: "loc",
      workflowId: "wf",
      workflowName: "Select Time Zone",
      workflowTriggerMode: "direct_api",
      discoveredWorkflows: [],
      acknowledgeDownstreamAutomation: true,
    },
    {
      env: { SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED: "true", SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED: "true", SA360_CLIENT_ONBOARDING_GHL_LOCATION_TEST_ADAPTER_APPROVED: "true" },
      apiBaseUrl: "https://127.0.0.1:9",
      fetch: async () => {
        fetches += 1;
        return new Response("{}", { status: 200 });
      },
    }
  );
  assert.equal(receipt.posted, false);
  assert.equal(receipt.externalCallExecuted, false);
  assert.equal(fetches, 0);
});
