/**
 * The mounted test-run route must forward rereadSheet and ghlAggregate.
 * Adapters here are fakes. No Google append or GHL POST leaves the process.
 */
import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3, companySheetsCampaignHeader } from "../lib/company-google-sheets-env.js";
import {
  CONFIRM_ONE_GOOGLE_SHEETS_ROW,
  CONFIRM_REPEAT,
  ONBOARDING_OPERATOR_OWNED_TEST_CLASS,
  sha256Text,
  type CapturedTestWorld,
  type PlannedSheet,
} from "../services/client-onboarding-v2/captured-test-delivery.js";
import {
  createFakeGhlLocation,
  createFakeSheetsAppend,
  createMemoryCapturedTestStore,
  fakeOnboardingLeadNote,
} from "../services/client-onboarding-v2/captured-test-delivery.fakes.js";
import {
  GHL_CONTACT_NOTE_TRANSMIT_CEILING,
  type OnboardingGhlTestDeliveryReceipt,
  type OnboardingGhlTestDeliveryRequest,
} from "../services/client-onboarding-v2/onboarding-ghl-test-adapter.js";
import { adminClientOnboardingV2TestRoutes, type CapturedTestRouteOptions } from "./admin-client-onboarding-v2-test.js";

const HEADER = "x-sa360-admin-key";
const CLIENT = "client_a";
const header = [...(companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) ?? [])];
const enabled = {
  SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED: "true",
  SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED: "true",
  SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED: "true",
};
const OPERATOR_EMAIL = "operator-owned@sa360.pilot";

function world(): CapturedTestWorld {
  return {
    clientFound: true,
    event: {
      id: "evt_note_v2",
      clientAccountIdResolved: CLIENT,
      status: "received",
      sourceRouteKey: "operator_owned_test",
      sourceProvider: "manual_import",
      sourceSystem: "external_vendor",
      sourceType: "manual_entry",
      webhookRequestLogId: null,
      enrichmentMetadataJson: { recordClass: ONBOARDING_OPERATOR_OWNED_TEST_CLASS },
      normalizedPayloadJson: {
        contact: { first_name: "Ada", last_name: "Lovelace", email: OPERATOR_EMAIL, phone_e164: "+15551230000", state: "VA" },
      },
      receivedAt: "2026-10-26T15:00:00.000Z",
      sourceLeadId: null,
      deliveryResultJson: null,
      downstream: { inventoryCount: 0, fulfillmentCount: 0, allocationCount: 0, dispatchIntentCount: 0 },
    },
    identities: [{ email: OPERATOR_EMAIL, phoneE164: "+15551230000" }],
    testIdentitySharedWithOtherClient: false,
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
      campaignControl: { establishControl: "drive_owner_verified", checkedAt: "2026-10-26T18:00:00.000Z" },
      destinationRevision: 2,
      approvedTestWorksheet: {
        spreadsheetId: "sheet_isolated",
        worksheetId: 77,
        worksheetTitle: "Onboarding Test Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
        header,
        headerSha256: sha256Text(JSON.stringify(header)),
        destinationRevision: 4,
        ownerClientAccountId: CLIENT,
        control: { establishControl: "drive_owner_verified", checkedAt: "2026-10-26T18:00:00.000Z" },
      },
      approvedTestWorksheetRisk: { uncertain: false, appendStartedAtHeld: false },
    },
    ghl: {
      locationId: "loc_prod",
      isolatedLocationId: null,
      workflowId: "wf_timezone",
      workflowName: "Select Time Zone",
      workflowTriggerMode: "direct_api",
      notesEnabled: true,
      discoveredWorkflows: [{ id: "wf_timezone", name: "Select Time Zone", status: "published" }],
    },
    storedLead: {
      sourceLeadEventId: "evt_note_v2",
      clientAccountId: CLIENT,
      generatedAt: "2026-10-26T15:00:00.000Z",
      firstName: "Ada",
      lastName: "Lovelace",
      email: OPERATOR_EMAIL,
      phone: "+15551230000",
      state: "VA",
    },
    production: {
      sourceLeadEventCount: 1,
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

function payload(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "req_mounted",
    kind: "captured_event_delivery",
    sourceLeadEventId: "evt_note_v2",
    destinations: ["google_sheets"],
    execute: true,
    confirmation: CONFIRM_ONE_GOOGLE_SHEETS_ROW,
    acknowledgeDownstreamAutomation: true,
    isolation: { mode: "isolated_destination", sheetsContract: "exact_v3_test_worksheet" },
    ...overrides,
  };
}

function acceptedReceipt(request: OnboardingGhlTestDeliveryRequest): OnboardingGhlTestDeliveryReceipt {
  const id = request.testRunId;
  return {
    ok: true,
    posted: true,
    retried: false,
    externalCallExecuted: true,
    error: null,
    detail: null,
    evidence: {
      http_accepted: true,
      contact_upserted: true,
      note_persisted: true,
      workflow_enrolled: true,
      downstream_executed: false,
    },
    contactId: "contact_mock",
    workflowId: "wf_timezone",
    idempotencyKeys: {
      contact: `onboarding-test:${id}:ghl-contact`,
      notes: [`onboarding-test:${id}:ghl-note:1`],
      workflow: `onboarding-test:${id}:ghl-workflow`,
    },
    notes: [
      {
        part: 1,
        idempotencyKey: `onboarding-test:${id}:ghl-note:1`,
        noteId: "note_mock",
        httpStatus: 201,
        classification: "accepted",
        attempts: 1,
      },
    ],
    calls: [
      {
        operation: "contact",
        method: "POST",
        path: "/contacts/upsert",
        idempotencyKey: `onboarding-test:${id}:ghl-contact`,
        httpStatus: 200,
        classification: "accepted",
        externalId: "contact_mock",
        attempts: 1,
      },
      {
        operation: "workflow",
        method: "POST",
        path: "/contacts/contact_mock/workflow/wf_timezone",
        idempotencyKey: `onboarding-test:${id}:ghl-workflow`,
        httpStatus: 200,
        classification: "accepted",
        externalId: null,
        attempts: 1,
      },
    ],
    configuredNoteBodyMaxChars: null,
    providerNoteBodyCeiling: GHL_CONTACT_NOTE_TRANSMIT_CEILING,
  };
}

async function post(opts: CapturedTestRouteOptions, body: Record<string, unknown>) {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = Fastify({ logger: false });
  await app.register(adminClientOnboardingV2TestRoutes, {
    prefix: "/admin/v1",
    loadWorld: () => world(),
    notes: fakeOnboardingLeadNote(),
    execution: "injected_fakes",
    store: createMemoryCapturedTestStore(),
    ...opts,
  });
  try {
    return await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/test-runs`,
      headers: { [HEADER]: "admin-secret" },
      payload: body,
    });
  } finally {
    await app.close();
    if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
    else delete process.env.ADMIN_API_KEY;
  }
}

test("A missing rereadSheet blocks the mounted sheets route", async () => {
  const sheets = createFakeSheetsAppend();
  const res = await post({ env: enabled, sheets }, payload({ requestId: "req_missing_reread" }));
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, "worksheet_blocked");
  assert.equal(sheets.calls.length, 0);
  assert.equal(res.json().externalCalls.sheets, false);
});

test("B a null reread blocks before the sheets port", async () => {
  const sheets = createFakeSheetsAppend();
  const res = await post(
    { env: enabled, sheets, rereadSheet: async () => null },
    payload({ requestId: "req_null_reread" })
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, "header_changed");
  assert.equal(sheets.calls.length, 0);
});

test("C a changed header blocks before the sheets port", async () => {
  const sheets = createFakeSheetsAppend();
  const res = await post(
    {
      env: enabled,
      sheets,
      rereadSheet: async (sheet) => ({ ...echo(sheet), header: ["Changed", ...sheet.header.slice(1)], headerSha256: "c".repeat(64) }),
    },
    payload({ requestId: "req_changed_header" })
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, "header_changed");
  assert.equal(sheets.calls.length, 0);
});

test("a stale revision, control mismatch, or throwing reread blocks before the sheets port", async () => {
  const revisionSheets = createFakeSheetsAppend();
  const revision = await post(
    {
      env: enabled,
      sheets: revisionSheets,
      rereadSheet: async (sheet) => ({ ...echo(sheet), destinationRevision: sheet.destinationRevision + 1 }),
    },
    payload({ requestId: "req_revision" })
  );
  assert.equal(revision.statusCode, 409);
  assert.equal(revision.json().error, "header_changed");
  assert.equal(revisionSheets.calls.length, 0);

  const controlSheets = createFakeSheetsAppend();
  const control = await post(
    {
      env: enabled,
      sheets: controlSheets,
      rereadSheet: async (sheet) => ({
        ...echo(sheet),
        control: { establishControl: "company_created", checkedAt: "2026-10-26T18:00:00.000Z" },
      }),
    },
    payload({ requestId: "req_control" })
  );
  assert.equal(control.statusCode, 409);
  assert.equal(control.json().error, "header_changed");
  assert.equal(controlSheets.calls.length, 0);

  const throwingSheets = createFakeSheetsAppend();
  const thrown = await post(
    {
      env: enabled,
      sheets: throwingSheets,
      rereadSheet: async () => {
        throw new Error("stale worksheet");
      },
    },
    payload({ requestId: "req_throw" })
  );
  assert.equal(thrown.statusCode, 409);
  assert.equal(thrown.json().error, "worksheet_blocked");
  assert.equal(throwingSheets.calls.length, 0);
});

test("D the wrong worksheet owner blocks before the sheets port", async () => {
  const sheets = createFakeSheetsAppend();
  const res = await post(
    {
      env: enabled,
      sheets,
      rereadSheet: async (sheet) => ({ ...echo(sheet), ownerClientAccountId: "other_client" }),
    },
    payload({ requestId: "req_owner" })
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, "header_changed");
  assert.equal(sheets.calls.length, 0);
});

test("E a matching approved header allows one mock sheets call", async () => {
  const sheets = createFakeSheetsAppend();
  const res = await post(
    { env: enabled, sheets, rereadSheet: async (sheet) => echo(sheet) },
    payload({ requestId: "req_match" })
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, "succeeded");
  assert.equal(res.json().externalCalls.sheets, true);
  assert.equal(res.json().downstreamExecuted, false);
  assert.equal(sheets.calls.length, 1);
});

test("F sheets plus GHL is refused before any sheets or GHL call", async () => {
  const sheets = createFakeSheetsAppend();
  const steps = createFakeGhlLocation();
  const deliveries: OnboardingGhlTestDeliveryRequest[] = [];
  const res = await post(
    {
      env: enabled,
      sheets,
      ghl: steps,
      rereadSheet: async (sheet) => echo(sheet),
      ghlAggregate: {
        async deliver(request) {
          deliveries.push(request);
          return acceptedReceipt(request);
        },
      },
    },
    payload({ requestId: "req_both", destinations: ["google_sheets", "ghl_location_api"] })
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, "google_only_pilot_required");
  assert.equal(res.json().externalCalls.sheets, false);
  assert.equal(res.json().externalCalls.ghl, false);
  assert.equal(sheets.calls.length, 0);
  assert.equal(deliveries.length, 0);
  assert.equal(steps.calls.length, 0);
});

test("G an uncertain sheets append does not start GHL", async () => {
  const sheets = createFakeSheetsAppend({ status: "uncertain", reason: "timeout" });
  const steps = createFakeGhlLocation();
  let deliveries = 0;
  const res = await post(
    {
      env: enabled,
      sheets,
      ghl: steps,
      rereadSheet: async (sheet) => echo(sheet),
      ghlAggregate: {
        async deliver(request) {
          deliveries += 1;
          return acceptedReceipt(request);
        },
      },
    },
    payload({ requestId: "req_uncertain_sheets", destinations: ["google_sheets"] })
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, "uncertain");
  assert.equal(res.json().externalCalls.ghl, false);
  assert.equal(sheets.calls.length, 1);
  assert.equal(deliveries, 0);
  assert.equal(steps.calls.length, 0);
});

test("H an uncertain one-shot blocks the repeat phrase and a second one-shot", async () => {
  const steps = createFakeGhlLocation();
  let deliveries = 0;
  const store = createMemoryCapturedTestStore();
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = Fastify({ logger: false });
  await app.register(adminClientOnboardingV2TestRoutes, {
    prefix: "/admin/v1",
    env: enabled,
    loadWorld: () => world(),
    notes: fakeOnboardingLeadNote(),
    execution: "injected_fakes",
    store,
    sheets: createFakeSheetsAppend({ status: "uncertain", reason: "timeout" }),
    rereadSheet: async (sheet) => echo(sheet),
    ghl: steps,
    ghlAggregate: {
      async deliver() {
        deliveries += 1;
        throw new Error("ghl timeout");
      },
    },
  });
  try {
    const first = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/test-runs`,
      headers: { [HEADER]: "admin-secret" },
      payload: payload({ requestId: "req_ghl_uncertain", destinations: ["google_sheets"] }),
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().status, "uncertain");
    assert.equal(deliveries, 0);
    assert.equal(steps.calls.length, 0);
    const second = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/test-runs`,
      headers: { [HEADER]: "admin-secret" },
      payload: payload({
        requestId: "req_ghl_repeat",
        destinations: ["google_sheets"],
        confirmation: CONFIRM_REPEAT,
        repeatOfTestRunId: first.json().testRunId,
      }),
    });
    assert.equal(second.statusCode, 409);
    assert.equal(second.json().error, "google_only_pilot_required");
    assert.equal(deliveries, 0);
    assert.equal(steps.calls.length, 0);
    const third = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/test-runs`,
      headers: { [HEADER]: "admin-secret" },
      payload: payload({ requestId: "req_second_one_shot" }),
    });
    assert.equal(third.statusCode, 409);
    assert.equal(third.json().error, "repeat_blocked_uncertain");
    assert.equal(deliveries, 0);
  } finally {
    await app.close();
    if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
    else delete process.env.ADMIN_API_KEY;
  }
});

test("I flags off makes no external call", async () => {
  const sheets = createFakeSheetsAppend();
  const steps = createFakeGhlLocation();
  let deliveries = 0;
  const res = await post(
    {
      env: {},
      sheets,
      ghl: steps,
      rereadSheet: async (sheet) => echo(sheet),
      ghlAggregate: {
        async deliver() {
          deliveries += 1;
          throw new Error("should not run");
        },
      },
    },
    payload({ requestId: "req_flags_off", destinations: ["google_sheets", "ghl_location_api"] })
  );
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "captured_test_disabled");
  assert.equal(sheets.calls.length, 0);
  assert.equal(steps.calls.length, 0);
  assert.equal(deliveries, 0);
});

test("a preview does not call the forwarded sheets or GHL ports", async () => {
  const sheets = createFakeSheetsAppend();
  const steps = createFakeGhlLocation();
  let reads = 0;
  let deliveries = 0;
  const res = await post(
    {
      env: enabled,
      sheets,
      ghl: steps,
      rereadSheet: async (sheet) => {
        reads += 1;
        return echo(sheet);
      },
      ghlAggregate: {
        async deliver() {
          deliveries += 1;
          throw new Error("should not run");
        },
      },
    },
    {
      requestId: "req_preview",
      kind: "preview",
      sourceLeadEventId: "evt_note_v2",
      destinations: ["google_sheets", "ghl_location_api"],
      execute: false,
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().externalCalls.sheets, false);
  assert.equal(res.json().externalCalls.ghl, false);
  assert.equal(sheets.calls.length, 0);
  assert.equal(steps.calls.length, 0);
  assert.equal(reads, 0);
  assert.equal(deliveries, 0);
});

function echo(sheet: PlannedSheet) {
  return {
    header: sheet.header,
    headerSha256: sheet.headerSha256,
    control: sheet.control,
    ownerClientAccountId: sheet.ownerClientAccountId,
    destinationRevision: sheet.destinationRevision,
    historicalDataRows: "empty" as const,
  };
}
