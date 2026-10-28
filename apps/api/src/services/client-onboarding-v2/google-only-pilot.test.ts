import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
  companySheetsCampaignHeader,
} from "../../lib/company-google-sheets-env.js";
import { isCustomSheetsWriterEnabled } from "../company-sheets-delivery/company-sheets-custom-row.js";
import {
  CONFIRM_ONE_GOOGLE_SHEETS_ROW,
  CONFIRM_REPEAT,
  GOOGLE_ONLY_ONE_SHOT_WARNING,
  ONBOARDING_OPERATOR_OWNED_TEST_CLASS,
  isCapturedTestEnabled,
  runCapturedTestDelivery,
  sha256Text,
  type CapturedTestRequest,
  type CapturedTestWorld,
  type StoredSourceEvent,
} from "./captured-test-delivery.js";
import { createFakeSheetsAppend, createMemoryCapturedTestStore } from "./captured-test-delivery.fakes.js";
import {
  decideGoogleOnlyPilot,
  readEvidence,
  type GoogleOnlyPilotPreflight,
  type ReadEvidence,
} from "./google-only-pilot-preflight.js";

const CLIENT = "alex_gross_fixture";
const header = [...(companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) ?? [])];
const OPERATOR_EMAIL = "operator-owned@sa360.pilot";

const productionFlags = {
  SA360_CLIENT_ONBOARDING_V2_READ_ENABLED: "true",
  SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED: "true",
  SA360_COMPANY_GOOGLE_SHEETS_ENABLED: "true",
  SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: "true",
  SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: "true",
} as NodeJS.ProcessEnv;

function event(overrides: Partial<StoredSourceEvent> = {}): StoredSourceEvent {
  return {
    id: "evt_operator",
    clientAccountIdResolved: CLIENT,
    status: "received",
    sourceRouteKey: "operator_owned_test",
    enrichmentMetadataJson: { recordClass: ONBOARDING_OPERATOR_OWNED_TEST_CLASS, inventoryTracked: false },
    normalizedPayloadJson: {
      contact: { first_name: "Operator", last_name: "Owned", email: OPERATOR_EMAIL, phone_e164: "+15551230000", state: "VA" },
    },
    receivedAt: "2026-10-28T15:00:00.000Z",
    sourceLeadId: "operator-owned-1",
    deliveryResultJson: null,
    downstream: { inventoryCount: 0, fulfillmentCount: 0, allocationCount: 0, dispatchIntentCount: 0 },
    ...overrides,
  };
}

function world(overrides: Partial<CapturedTestWorld> = {}): CapturedTestWorld {
  return {
    clientFound: true,
    event: event(),
    identities: [{ email: OPERATOR_EMAIL, phoneE164: "+15551230000" }],
    testIdentitySharedWithOtherClient: false,
    sheets: {
      spreadsheetId: "prod_sheet_alex",
      spreadsheetTitle: "Copy of FaceBook Lead Master - Alex Gross",
      canaryApproved: false,
      campaignDispatchEnabled: false,
      agedDispatchEnabled: false,
      campaign: {
        worksheetId: 15,
        worksheetTitle: "VET Web Form",
        schemaVersion: "company_sheets_campaign_custom_v1",
        header: ["Name", "Phone", "Email", "Age/ DOB", "Primary Reason"],
      },
      canary: null,
      campaignRisk: { uncertain: false, appendStartedAtHeld: false },
      canaryRisk: { uncertain: false, appendStartedAtHeld: false },
      campaignControl: { establishControl: "approved_shared_drive", checkedAt: "2026-10-28T15:00:00.000Z" },
      destinationRevision: 4,
      approvedTestWorksheet: {
        spreadsheetId: "test_sheet_separate",
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
    ghl: {
      locationId: "loc_alex",
      isolatedLocationId: null,
      workflowId: "wf_timezone",
      workflowName: "Select Time Zone",
      workflowTriggerMode: "direct_api",
      notesEnabled: true,
    },
    production: {
      sourceLeadEventCount: 22,
      inventoryCount: 21,
      billingRowCount: 0,
      dispatchIntentCount: 0,
      eventStatus: "received",
      eventDeliveryResult: null,
      campaignDispatchEnabled: false,
      agedDispatchEnabled: false,
    },
    ...overrides,
  };
}

function oneShot(overrides: Partial<CapturedTestRequest> = {}): CapturedTestRequest {
  return {
    requestId: randomUUID(),
    kind: "captured_event_delivery",
    clientAccountId: CLIENT,
    sourceLeadEventId: "evt_operator",
    destinations: ["google_sheets"],
    execute: true,
    confirmation: CONFIRM_ONE_GOOGLE_SHEETS_ROW,
    isolation: { mode: "isolated_destination", sheetsContract: "exact_v3_test_worksheet" },
    noteOverflow: "refuse",
    repeatOfTestRunId: null,
    actorLabel: "operator",
    ...overrides,
  };
}

function deps(sheets = createFakeSheetsAppend(), env: NodeJS.ProcessEnv = { ...productionFlags, SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED: "true" }) {
  const ghlCalls: string[] = [];
  return {
    sheets,
    ghlCalls,
    store: createMemoryCapturedTestStore(),
    runDeps: {
      env,
      store: undefined as never,
      sheets,
      execution: "injected_fakes" as const,
      newId: () => randomUUID(),
      rereadSheet: async (sheet: { header: string[]; headerSha256: string; control: { establishControl: string; checkedAt: string } | null; ownerClientAccountId: string; destinationRevision: number }) => ({
        header: [...sheet.header],
        headerSha256: sheet.headerSha256,
        control: sheet.control,
        ownerClientAccountId: sheet.ownerClientAccountId,
        destinationRevision: sheet.destinationRevision,
        historicalDataRows: "empty" as const,
      }),
      ghlAggregate: {
        async deliver() {
          ghlCalls.push("deliver");
          throw new Error("GHL must not be called for a Google-only one-shot");
        },
      },
    },
  };
}

test("production flags do not append, and only the captured-test flag opens the one-shot", async () => {
  assert.equal(isCapturedTestEnabled(productionFlags), false);
  assert.equal(isCustomSheetsWriterEnabled(productionFlags), false);
  assert.equal(productionFlags.SA360_CLIENT_ONBOARDING_GHL_LOCATION_TEST_ADAPTER_APPROVED, undefined);
  const closed = deps(createFakeSheetsAppend(), productionFlags);
  closed.runDeps.store = createMemoryCapturedTestStore();
  const refused = await runCapturedTestDelivery(oneShot(), world(), { ...closed.runDeps, store: closed.runDeps.store });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.error, "captured_test_disabled");
  assert.equal(closed.sheets.calls.length, 0);
  assert.equal(closed.ghlCalls.length, 0);

  const opened = deps();
  const store = createMemoryCapturedTestStore();
  const sent = await runCapturedTestDelivery(oneShot(), world(), { ...opened.runDeps, store });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(opened.sheets.calls.length, 1);
  assert.equal(opened.sheets.calls[0]?.spreadsheetId, "test_sheet_separate");
  assert.notEqual(opened.sheets.calls[0]?.spreadsheetId, "prod_sheet_alex");
  assert.equal(opened.sheets.calls[0]?.values.length, 35);
  assert.equal(opened.sheets.calls[0]?.idempotencyKey.startsWith("onboarding-test:"), true);
  assert.equal(opened.sheets.calls[0]?.idempotencyKey.startsWith("lead:"), false);
  assert.equal(opened.sheets.calls[0]?.idempotencyKey.startsWith("campaign:"), false);
  assert.equal(opened.ghlCalls.length, 0);
  assert.equal(sent.externalCalls.ghl, false);
  assert.equal(sent.externalCalls.providerWebhook, false);
  assert.equal(sent.production.campaignDispatchEnabled, false);
  assert.equal(sent.run.warningCodes.includes(GOOGLE_ONLY_ONE_SHOT_WARNING), true);
});

test("the one-shot phrase cannot select GHL, a customer event, a synthetic address, or the production file", async () => {
  const box = deps();
  const store = createMemoryCapturedTestStore();
  const base = { ...box.runDeps, store };
  const ghl = await runCapturedTestDelivery(
    oneShot({ destinations: ["google_sheets", "ghl_location_api"], acknowledgeDownstreamAutomation: true }),
    world(),
    base
  );
  assert.equal(ghl.ok, false);
  if (ghl.ok) return;
  assert.equal(ghl.error, "ghl_destination_not_allowed");
  assert.equal(box.sheets.calls.length, 0);
  assert.equal(box.ghlCalls.length, 0);

  const customer = await runCapturedTestDelivery(
    oneShot({ sourceLeadEventId: "evt_customer" }),
    world({
      event: event({
        id: "evt_customer",
        enrichmentMetadataJson: { recordClass: "campaign_lead" },
        normalizedPayloadJson: { contact: { email: OPERATOR_EMAIL } },
      }),
    }),
    base
  );
  assert.equal(customer.ok, false);
  if (customer.ok) return;
  assert.equal(customer.error, "event_not_operator_owned");

  const synthetic = await runCapturedTestDelivery(
    oneShot(),
    world({
      event: event({
        normalizedPayloadJson: { contact: { email: "synthetic@example.invalid" } },
      }),
      identities: [{ email: "synthetic@example.invalid", phoneE164: null }],
    }),
    base
  );
  assert.equal(synthetic.ok, false);
  if (synthetic.ok) return;
  assert.equal(synthetic.error, "synthetic_contact_refused");

  const otherClient = await runCapturedTestDelivery(
    oneShot({ clientAccountId: "other_client", sourceLeadEventId: "evt_operator" }),
    world({ event: event({ clientAccountIdResolved: CLIENT }) }),
    base
  );
  assert.equal(otherClient.ok, false);
  if (otherClient.ok) return;
  assert.equal(otherClient.error, "tenant_mismatch");

  const sameFile = world();
  sameFile.sheets!.approvedTestWorksheet!.spreadsheetId = "prod_sheet_alex";
  const productionFile = await runCapturedTestDelivery(oneShot(), sameFile, base);
  assert.equal(productionFile.ok, false);
  if (productionFile.ok) return;
  assert.equal(productionFile.error, "test_worksheet_not_approved");
  assert.equal(box.sheets.calls.length, 0);
});

test("a duplicate request and an uncertain append cannot send a second row", async () => {
  const sheets = createFakeSheetsAppend();
  const store = createMemoryCapturedTestStore();
  const request = oneShot({ requestId: "11111111-1111-4111-8111-111111111111" });
  const first = await runCapturedTestDelivery(request, world(), {
    ...deps(sheets).runDeps,
    store,
  });
  assert.equal(first.ok, true);
  const duplicate = await runCapturedTestDelivery(request, world(), {
    ...deps(sheets).runDeps,
    store,
  });
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) return;
  assert.equal(duplicate.duplicateRequest, true);
  assert.equal(sheets.calls.length, 1);

  const uncertainSheets = createFakeSheetsAppend({ status: "uncertain", reason: "timeout" });
  const uncertainStore = createMemoryCapturedTestStore();
  const uncertainWorld = world({ event: event({ id: "evt_uncertain" }) });
  const uncertain = await runCapturedTestDelivery(
    oneShot({ sourceLeadEventId: "evt_uncertain" }),
    uncertainWorld,
    { ...deps(uncertainSheets).runDeps, store: uncertainStore }
  );
  assert.equal(uncertain.ok, true);
  if (!uncertain.ok) return;
  assert.equal(uncertain.run.status, "uncertain");
  const again = await runCapturedTestDelivery(
    oneShot({ sourceLeadEventId: "evt_uncertain", confirmation: CONFIRM_REPEAT, repeatOfTestRunId: uncertain.run.id }),
    uncertainWorld,
    { ...deps(uncertainSheets).runDeps, store: uncertainStore }
  );
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.equal(again.error, "repeat_blocked_uncertain");
  const retriedWithGhl = await runCapturedTestDelivery(
    oneShot({
      sourceLeadEventId: "evt_uncertain",
      destinations: ["google_sheets", "ghl_location_api"],
    }),
    uncertainWorld,
    { ...deps(uncertainSheets).runDeps, store: uncertainStore }
  );
  assert.equal(retriedWithGhl.ok, false);
  if (retriedWithGhl.ok) return;
  assert.equal(retriedWithGhl.error, "repeat_blocked_uncertain");
  assert.equal(uncertainSheets.calls.length, 1);
});

test("a timed-out preflight read is unavailable and is not reported as zero rows", async () => {
  const runs = await readEvidence<GoogleOnlyPilotPreflight["runs"] extends ReadEvidence<infer T> ? T : never>(
    "runs",
    () => new Promise(() => {}),
    15
  );
  assert.equal(runs.state, "unavailable");
  const unavailable = { state: "unavailable", reason: "not read" } as const;
  const decision = decideGoogleOnlyPilot({
    clientAccountId: CLIENT,
    worksheet: unavailable,
    identities: unavailable,
    runs,
    locks: unavailable,
    heldAppends: unavailable,
    unresolvedJobs: unavailable,
    grants: unavailable,
    dispatch: unavailable,
  });
  assert.equal(decision.append, "no_go");
  assert.equal(decision.setup, "no_go");
  assert.match(decision.reasons.join(" "), /unavailable/);
  assert.match(decision.reasons.join(" "), /not an empty result/);
  assert.equal(decision.reasons.some((reason) => /\b0 runs\b|\bno runs\b|\bzero rows\b/i.test(reason)), false);
});
