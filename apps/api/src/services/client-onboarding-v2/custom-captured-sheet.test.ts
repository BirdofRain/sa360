import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";

import { formatGenerationTimestamp } from "../company-sheets-delivery/company-sheets-campaign-row.js";
import { COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA } from "../company-sheets-delivery/company-sheets-custom-row.js";
import { adminClientOnboardingV2TestRoutes } from "../../routes/admin-client-onboarding-v2-test.js";
import {
  CONFIRM_ONE_CUSTOM_SHEETS_ROW,
  CONFIRM_ONE_GOOGLE_SHEETS_ROW,
  CONFIRM_REPEAT,
  runCapturedTestDelivery,
  type CapturedTestRequest,
  type CapturedTestWorld,
  type CustomCapturedCampaignSheetsPort,
  type StoredSourceEvent,
} from "./captured-test-delivery.js";
import { createFakeSheetsAppend, createMemoryCapturedTestStore } from "./captured-test-delivery.fakes.js";
import { isOperatorCreatedDummyEvent } from "./custom-captured-sheet.js";

const CLIENT = "alex_gross_fixture";
const SHEET = "copy_sheet_alex";
const EVENT = "evt_sample";
const VET = [
  "Date",
  "Lead Type",
  "Client Name",
  "Phone",
  "Email",
  "State",
  "Age/ DOB",
  "Military Status",
  "Branch of Service",
  "Marital Status",
  "Desired Coverage",
  "Primary Concern",
  "Beneficiary",
  "Time to Call",
  "Notes",
];

const FIELD: Record<string, { header: string; sourceField: string; transform: "passthrough" | "date_america_new_york" }> = {
  Date: { header: "Date", sourceField: "submitted_at", transform: "passthrough" },
  "Lead Type": { header: "Lead Type", sourceField: "lead_type", transform: "passthrough" },
  "Client Name": { header: "Client Name", sourceField: "full_name", transform: "passthrough" },
  Phone: { header: "Phone", sourceField: "phone", transform: "passthrough" },
  Email: { header: "Email", sourceField: "email", transform: "passthrough" },
  State: { header: "State", sourceField: "state", transform: "passthrough" },
  "Age/ DOB": { header: "DOB", sourceField: "date_of_birth", transform: "date_america_new_york" },
  "Military Status": { header: "Military Status", sourceField: "military_status", transform: "passthrough" },
  "Branch of Service": { header: "Branch of Service", sourceField: "branch_of_service", transform: "passthrough" },
  "Marital Status": { header: "Marital Status", sourceField: "marital_status", transform: "passthrough" },
  "Desired Coverage": { header: "Desired Coverage", sourceField: "coverage_amount", transform: "passthrough" },
  "Primary Concern": { header: "Primary Concern", sourceField: "primary_concern", transform: "passthrough" },
  Beneficiary: { header: "Beneficiary", sourceField: "beneficiary", transform: "passthrough" },
  "Time to Call": { header: "Time to Call", sourceField: "best_time_to_call", transform: "passthrough" },
  Notes: { header: "Notes", sourceField: "notes", transform: "passthrough" },
};

const SUBMITTED_AT = "2026-10-29T01:32:34.966Z";

function assignments() {
  return VET.map((sheetHeader, columnIndex) => {
    const field = FIELD[sheetHeader];
    if (!field) throw new Error(sheetHeader);
    return {
      sheetHeader,
      columnIndex,
      formula: false,
      target: { kind: "v3_column" as const, header: field.header, sourceField: field.sourceField },
      transform: field.transform,
      decision: "mapped" as const,
      explicit: true,
      code: null,
    };
  });
}

function payload() {
  return {
    contact: {
      first_name: "Sample",
      last_name: "Lead",
      email: "sample.lead@example.invalid",
      phone: "5550100199",
      state: "TX",
      date_of_birth: "1990-04-02",
    },
    phone: "5550100199",
    routing: {
      source_intake: {
        submitted_at: SUBMITTED_AT,
        sourceAttributes: {
          military_status: "Veteran",
          branch_of_service: "Army",
          marital_status: "Married",
          desired_coverage: "250000",
          beneficiary: "Spouse",
          best_time_to_call: "Morning",
          primary_reason: "Burial",
        },
      },
    },
  };
}

function event(overrides: Partial<StoredSourceEvent> = {}): StoredSourceEvent {
  return {
    id: EVENT,
    clientAccountIdResolved: CLIENT,
    status: "routing_matched",
    sourceRouteKey: "go.example.com/learn",
    sourceProvider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceType: "webhook",
    webhookRequestLogId: null,
    enrichmentMetadataJson: {},
    normalizedPayloadJson: payload(),
    receivedAt: SUBMITTED_AT,
    sourceLeadId: "sample-lead",
    deliveryResultJson: null,
    downstream: { inventoryCount: 1, fulfillmentCount: 0, allocationCount: 0, dispatchIntentCount: 0 },
    ...overrides,
  };
}

function world(overrides: Partial<CapturedTestWorld> = {}): CapturedTestWorld {
  const header = [...VET];
  return {
    clientFound: true,
    event: event(),
    identities: [],
    sheets: {
      spreadsheetId: SHEET,
      spreadsheetTitle: "Copy of FaceBook Lead Master",
      canaryApproved: false,
      campaignDispatchEnabled: false,
      agedDispatchEnabled: false,
      campaign: {
        worksheetId: 0,
        worksheetTitle: "VET Web Form",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
        header,
      },
      canary: null,
      campaignRisk: { uncertain: false, appendStartedAtHeld: false },
      canaryRisk: { uncertain: false, appendStartedAtHeld: false },
      campaignControl: { establishControl: "approved_shared_drive", checkedAt: "2026-10-28T15:00:00.000Z" },
      destinationRevision: 6,
      publishedCampaignMap: {
        id: "map_vet",
        mapVersion: 1,
        spreadsheetId: SHEET,
        worksheetId: 0,
        headerSnapshot: header,
        assignments: assignments(),
      },
      approvedTestWorksheet: null,
    },
    ghl: null,
    production: {
      sourceLeadEventCount: 2,
      inventoryCount: 2,
      billingRowCount: 0,
      dispatchIntentCount: 0,
      eventStatus: "routing_matched",
      eventDeliveryResult: null,
      campaignDispatchEnabled: false,
      agedDispatchEnabled: false,
    },
    ...overrides,
  };
}

function configEnv(captured = true): NodeJS.ProcessEnv {
  return {
    SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED: "true",
    ...(captured ? { SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED: "true" } : {}),
  };
}

function replay(): CapturedTestRequest {
  return {
    requestId: randomUUID(),
    kind: "captured_event_replay",
    clientAccountId: CLIENT,
    sourceLeadEventId: EVENT,
    destinations: ["google_sheets"],
    execute: false,
  };
}

function deliver(overrides: Partial<CapturedTestRequest> = {}): CapturedTestRequest {
  return {
    requestId: randomUUID(),
    kind: "captured_event_delivery",
    clientAccountId: CLIENT,
    sourceLeadEventId: EVENT,
    destinations: ["google_sheets"],
    execute: true,
    confirmation: CONFIRM_ONE_CUSTOM_SHEETS_ROW,
    isolation: { mode: "verified_test_identity", sheetsContract: "custom_campaign_map" },
    ...overrides,
  };
}

function quietPort(calls: string[], status: "succeeded" | "failed" = "succeeded"): CustomCapturedCampaignSheetsPort {
  return {
    async send(input) {
      calls.push(input.sourceLeadEventId);
      return {
        status,
        externalCallExecuted: status === "succeeded",
        error: status === "failed" ? "header_changed" : undefined,
        inventoryAffected: false,
        billingAffected: false,
        deliveryEnabled: false,
        cutoffChanged: false,
        duplicate: false,
      };
    },
  };
}

test("a stored lead is an operator dummy only when intake recorded that marker", () => {
  assert.equal(isOperatorCreatedDummyEvent(event()), false);
  assert.equal(isOperatorCreatedDummyEvent(event({ id: "synthetic-campaign-test", enrichmentMetadataJson: { operatorDummy: true } })), false);
  assert.equal(
    isOperatorCreatedDummyEvent(event({ sourceLeadId: "synthetic-campaign-test", enrichmentMetadataJson: { operatorDummy: true } })),
    false
  );
  assert.equal(isOperatorCreatedDummyEvent(event({ enrichmentMetadataJson: { operatorDummy: true } })), true);
});

test("preview projects the published 15 headers, including blanks, DOB, and niche answers", async () => {
  const sheets = createFakeSheetsAppend();
  const preview = await runCapturedTestDelivery(replay(), world(), {
    env: configEnv(false),
    execution: "injected_fakes",
    sheets,
    store: createMemoryCapturedTestStore(),
  });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const values = preview.plan.sheet?.values ?? [];
  assert.deepEqual(preview.plan.sheet?.header, VET);
  assert.equal(values.length, 15);
  assert.equal(values[0], formatGenerationTimestamp(SUBMITTED_AT));
  assert.equal(values[1], "");
  assert.equal(values[2], "Sample Lead");
  assert.equal(values[3], "5550100199");
  assert.equal(values[4], "sample.lead@example.invalid");
  assert.equal(values[5], "TX");
  assert.equal(values[6], "04/02/1990");
  assert.equal(values[7], "Veteran");
  assert.equal(values[8], "Army");
  assert.equal(values[9], "Married");
  assert.equal(values[10], "250000");
  assert.equal(values[11], "Burial");
  assert.equal(values[12], "Spouse");
  assert.equal(values[13], "Morning");
  assert.equal(values[14], "");
  assert.equal(preview.plan.warningCodes.includes("primary_concern_filled_from_primary_reason"), true);
  assert.equal(preview.externalCallsThisRequest.sheets, false);
  assert.equal(sheets.calls.length, 0);
});

test("header drift blocks the custom preview before a row is planned", async () => {
  const drifted = world();
  drifted.sheets!.campaign!.header = ["Changed", ...VET.slice(1)];
  const preview = await runCapturedTestDelivery(replay(), drifted, {
    env: configEnv(false),
    store: createMemoryCapturedTestStore(),
  });
  assert.equal(preview.ok, false);
  if (preview.ok) return;
  assert.equal(preview.error, "header_changed");
});

test("delivery sends a stored client lead while the campaign switch is off", async () => {
  const calls: string[] = [];
  const sheets = createFakeSheetsAppend();
  const store = createMemoryCapturedTestStore();
  const deps = {
    env: configEnv(true),
    execution: "injected_fakes" as const,
    sheets,
    customCampaignSheets: quietPort(calls),
    store,
  };
  const liveWorld = world({
    sheets: { ...world().sheets!, campaignDispatchEnabled: true },
  });
  const live = await runCapturedTestDelivery(deliver(), liveWorld, deps);
  assert.equal(live.ok, false);
  if (live.ok) return;
  assert.equal(live.error, "live_tab_test_refused");
  assert.equal(calls.length, 0);

  const closed = await runCapturedTestDelivery(deliver(), world(), {
    ...deps,
    env: configEnv(false),
    store: createMemoryCapturedTestStore(),
  });
  assert.equal(closed.ok, false);
  if (closed.ok) return;
  assert.equal(closed.error, "captured_test_disabled");

  const pilot = await runCapturedTestDelivery(
    deliver({
      confirmation: CONFIRM_ONE_GOOGLE_SHEETS_ROW,
      isolation: { mode: "isolated_destination", sheetsContract: "exact_v3_test_worksheet" },
    }),
    world(),
    deps
  );
  assert.equal(pilot.ok, false);
  if (pilot.ok) return;
  assert.equal(pilot.error, "google_only_pilot_required");
  assert.equal(calls.length, 0);

  const synthetic = await runCapturedTestDelivery(
    deliver({ sourceLeadEventId: "synthetic-campaign-test" }),
    world({ event: event({ id: "synthetic-campaign-test", sourceLeadId: "synthetic-campaign-test" }) }),
    { ...deps, store: createMemoryCapturedTestStore() }
  );
  assert.equal(synthetic.ok, false);
  if (synthetic.ok) return;
  assert.equal(synthetic.error, "synthetic_campaign_test_refused");
  assert.equal(calls.length, 0);

  const sent = await runCapturedTestDelivery(deliver(), world(), deps);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.run.status, "succeeded");
  assert.equal(sent.effects?.inventoryAffected, false);
  assert.equal(sent.effects?.billingAffected, false);
  assert.equal(sent.effects?.deliveryEnabled, false);
  assert.equal(sent.effects?.cutoffChanged, false);
  assert.equal(sent.effects?.duplicate, false);
  assert.equal(sent.externalCallsThisRequest.sheets, true);
  assert.equal(calls.length, 1);
  assert.equal(sheets.calls.length, 0);

  const repeat = await runCapturedTestDelivery(deliver({ confirmation: CONFIRM_REPEAT, repeatOfTestRunId: sent.run.id }), world(), deps);
  assert.equal(repeat.ok, false);
  if (repeat.ok) return;
  assert.equal(repeat.error, "captured_event_test_already_used");
  const second = await runCapturedTestDelivery(deliver(), world(), deps);
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.error, "captured_event_test_already_used");
  assert.equal(calls.length, 1);
});

test("a failed custom attempt that did not write can be sent again", async () => {
  const calls: string[] = [];
  const store = createMemoryCapturedTestStore();
  const port = quietPort(calls, "failed");
  const dummyWorld = world({ event: event({ enrichmentMetadataJson: { operatorDummy: true } }) });
  const deps = {
    env: configEnv(true),
    execution: "injected_fakes" as const,
    sheets: createFakeSheetsAppend(),
    customCampaignSheets: port,
    store,
  };
  const first = await runCapturedTestDelivery(deliver(), dummyWorld, deps);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.run.status, "failed");
  deps.customCampaignSheets = quietPort(calls, "succeeded");
  const second = await runCapturedTestDelivery(deliver(), dummyWorld, deps);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.run.status, "succeeded");
  assert.equal(calls.length, 2);
});

test("the mounted route accepts the custom contract and still refuses the google-only shape", async () => {
  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const calls: string[] = [];
  const sheets = createFakeSheetsAppend();
  const app = Fastify({ logger: false });
  await app.register(adminClientOnboardingV2TestRoutes, {
    prefix: "/admin/v1",
    env: configEnv(true),
    execution: "injected_fakes",
    store: createMemoryCapturedTestStore(),
    sheets,
    customCampaignSheets: quietPort(calls),
    loadWorld: () => world({ event: event({ enrichmentMetadataJson: { operatorDummy: true } }) }),
  });
  const preview = await app.inject({
    method: "POST",
    url: `/admin/v1/clients/${CLIENT}/onboarding/test-runs`,
    headers: { "x-sa360-admin-key": "admin-secret" },
    payload: replay(),
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().preview.sheet.values.length, 15);
  assert.equal(preview.json().preview.sheet.values[6], "04/02/1990");
  assert.equal(preview.json().preview.sheet.values[11], "Burial");
  assert.equal(preview.json().warningCodes.includes("primary_concern_filled_from_primary_reason"), true);
  const pilot = await app.inject({
    method: "POST",
    url: `/admin/v1/clients/${CLIENT}/onboarding/test-runs`,
    headers: { "x-sa360-admin-key": "admin-secret" },
    payload: {
      ...deliver(),
      confirmation: CONFIRM_ONE_GOOGLE_SHEETS_ROW,
      isolation: { mode: "isolated_destination", sheetsContract: "exact_v3_test_worksheet" },
    },
  });
  assert.equal(pilot.statusCode, 409);
  assert.equal(pilot.json().error, "google_only_pilot_required");
  const sent = await app.inject({
    method: "POST",
    url: `/admin/v1/clients/${CLIENT}/onboarding/test-runs`,
    headers: { "x-sa360-admin-key": "admin-secret" },
    payload: deliver(),
  });
  assert.equal(sent.statusCode, 200);
  assert.equal(sent.json().effects.deliveryEnabled, false);
  assert.equal(sent.json().effects.cutoffChanged, false);
  assert.equal(sent.json().effects.inventoryAffected, false);
  assert.equal(sent.json().effects.billingAffected, false);
  assert.equal(calls.length, 1);
  assert.equal(sheets.calls.length, 0);
  await app.close();
  if (previous === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = previous;
});
