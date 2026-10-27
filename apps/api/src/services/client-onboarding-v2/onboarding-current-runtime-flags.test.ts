/**
 * Current production flag combination, simulated locally.
 * Sheets execution and dispatch are on. Captured-test, custom-writer, and
 * GHL adapter approval stay unset. Nothing here enables a flag.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
  companySheetsCampaignHeader,
  isCompanyGoogleSheetsDispatchEnabled,
  isCompanyGoogleSheetsExecutionEnabled,
} from "../../lib/company-google-sheets-env.js";
import { isCustomSheetsWriterEnabled } from "../company-sheets-delivery/company-sheets-custom-row.js";
import {
  CONFIRM_DELIVER,
  isCapturedTestEnabled,
  runCapturedTestDelivery,
  sha256Text,
  type CapturedTestWorld,
} from "./captured-test-delivery.js";
import { createFakeSheetsAppend, createMemoryCapturedTestStore } from "./captured-test-delivery.fakes.js";

const header = [...(companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) ?? [])];

/** Matches the observed API runtime. Unset keys are absent, not "false". */
const currentProduction = {
  SA360_CLIENT_ONBOARDING_V2_READ_ENABLED: "true",
  SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED: "true",
  SA360_COMPANY_GOOGLE_SHEETS_ENABLED: "true",
  SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: "true",
  SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: "true",
} as NodeJS.ProcessEnv;

function world(): CapturedTestWorld {
  return {
    clientFound: true,
    event: {
      id: "evt_runtime",
      clientAccountIdResolved: "client_runtime",
      status: "routing_matched",
      sourceRouteKey: "leadcapture_form",
      enrichmentMetadataJson: {},
      normalizedPayloadJson: { contact: { email: "ada@example.invalid", phone_e164: "+15555550100" } },
      receivedAt: "2026-10-26T15:00:00.000Z",
      sourceLeadId: "src_runtime",
      deliveryResultJson: null,
    },
    identities: [],
    sheets: {
      spreadsheetId: "sheet_client",
      spreadsheetTitle: "Client",
      canaryApproved: false,
      campaignDispatchEnabled: true,
      agedDispatchEnabled: false,
      campaign: {
        worksheetId: 10,
        worksheetTitle: "Campaign Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
        header,
      },
      canary: { worksheetId: 20, worksheetTitle: "Canary", header: ["delivery_row_id", "sample_formula", "sample_plus", "note"] },
      campaignRisk: { uncertain: false, appendStartedAtHeld: false },
      canaryRisk: { uncertain: false, appendStartedAtHeld: false },
      campaignControl: { establishControl: "drive_owner_verified", checkedAt: "2026-10-26T18:00:00.000Z" },
      destinationRevision: 3,
      approvedTestWorksheet: {
        spreadsheetId: "sheet_isolated",
        worksheetId: 77,
        worksheetTitle: "Onboarding Test Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
        header,
        headerSha256: sha256Text(JSON.stringify(header)),
        destinationRevision: 4,
        ownerClientAccountId: "client_runtime",
        control: { establishControl: "company_created", checkedAt: "2026-10-26T18:00:00.000Z" },
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
    },
    production: {
      sourceLeadEventCount: 1,
      inventoryCount: 0,
      billingRowCount: 0,
      dispatchIntentCount: 0,
      eventStatus: "routing_matched",
      eventDeliveryResult: null,
      campaignDispatchEnabled: true,
      agedDispatchEnabled: false,
    },
  };
}

test("the current production flag combination does not authorize captured or custom sends", async () => {
  assert.equal(isCompanyGoogleSheetsExecutionEnabled(currentProduction), true);
  assert.equal(isCompanyGoogleSheetsDispatchEnabled(currentProduction), true);
  assert.equal(isCapturedTestEnabled(currentProduction), false);
  assert.equal(isCustomSheetsWriterEnabled(currentProduction), false);
  assert.equal(currentProduction.SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED, undefined);
  assert.equal(currentProduction.SA360_CLIENT_ONBOARDING_V2_CUSTOM_WRITER_ENABLED, undefined);
  assert.equal(currentProduction.SA360_CLIENT_ONBOARDING_GHL_LOCATION_TEST_ADAPTER_APPROVED, undefined);

  const sheets = createFakeSheetsAppend();
  const delivered = await runCapturedTestDelivery(
    {
      requestId: randomUUID(),
      kind: "captured_event_delivery",
      clientAccountId: "client_runtime",
      sourceLeadEventId: "evt_runtime",
      destinations: ["google_sheets", "ghl_location_api"],
      execute: true,
      confirmation: CONFIRM_DELIVER,
      acknowledgeDownstreamAutomation: true,
      isolation: { mode: "isolated_destination", sheetsContract: "exact_v3_test_worksheet" },
    },
    world(),
    {
      env: currentProduction,
      store: createMemoryCapturedTestStore(),
      sheets,
      execution: "injected_fakes",
      rereadSheet: async (sheet) => ({
        header: [...sheet.header],
        headerSha256: sheet.headerSha256,
        control: sheet.control,
        ownerClientAccountId: sheet.ownerClientAccountId,
        destinationRevision: sheet.destinationRevision,
      }),
      ghlAggregate: {
        async deliver() {
          throw new Error("ghl aggregate must not run while captured test is unset");
        },
      },
    }
  );
  assert.equal(delivered.ok, false);
  if (delivered.ok) return;
  assert.equal(delivered.error, "captured_test_disabled");
  assert.equal(sheets.calls.length, 0);
  assert.equal(delivered.externalCallsThisRequest?.sheets ?? false, false);
  assert.equal(delivered.externalCallsThisRequest?.ghl ?? false, false);

  const preview = await runCapturedTestDelivery(
    {
      requestId: randomUUID(),
      kind: "preview",
      clientAccountId: "client_runtime",
      sourceLeadEventId: "evt_runtime",
      destinations: ["google_sheets"],
      execute: false,
    },
    world(),
    { env: currentProduction, store: createMemoryCapturedTestStore(), sheets, execution: "injected_fakes" }
  );
  assert.equal(preview.ok, true);
  assert.equal(sheets.calls.length, 0);
});

test("captured-test and custom-writer flags stay independent of the sheets execution switch", () => {
  const capturedOnly = { ...currentProduction, SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED: "true" };
  const customOnly = { ...currentProduction, SA360_CLIENT_ONBOARDING_V2_CUSTOM_WRITER_ENABLED: "true" };
  assert.equal(isCapturedTestEnabled(capturedOnly), true);
  assert.equal(isCustomSheetsWriterEnabled(capturedOnly), false);
  assert.equal(isCustomSheetsWriterEnabled(customOnly), true);
  assert.equal(isCapturedTestEnabled(customOnly), false);
  assert.equal(isCompanyGoogleSheetsExecutionEnabled(capturedOnly), true);
  assert.equal(isCompanyGoogleSheetsDispatchEnabled(customOnly), true);
});
