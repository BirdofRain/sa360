import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";

import { prisma } from "../../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
  COMPANY_SHEETS_CANARY_HEADER,
  companySheetsCampaignHeader,
} from "../../lib/company-google-sheets-env.js";
import { CONFIRM_DELIVER, runCapturedTestDelivery, type CapturedTestWorld } from "./captured-test-delivery.js";
import { createFailClosedSheetsAppend } from "./onboarding-execution-binding.js";
import { saveSelectTimeZone } from "./onboarding-ghl-bindings.js";
import {
  approveExactV3TestWorksheet,
  recordActivationIntent,
  saveOnboardingDestinationProfile,
} from "./onboarding-config.service.js";
import { createPrismaCapturedTestStore } from "./onboarding-test-store.js";

const header = [...(companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) ?? COMPANY_SHEETS_V3_HEADER)];
const enabled = {
  SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED: "true",
  SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED: "true",
} as NodeJS.ProcessEnv;

function world(clientAccountId: string, eventId: string): CapturedTestWorld {
  return {
    clientFound: true,
    event: {
      id: eventId,
      clientAccountIdResolved: clientAccountId,
      status: "routing_matched",
      sourceRouteKey: "leadcapture_form",
      enrichmentMetadataJson: {},
      normalizedPayloadJson: { contact: { email: "ada@example.com", phone_e164: "+15555550100" } },
      receivedAt: "2026-10-26T15:00:00.000Z",
      sourceLeadId: "src_1",
      deliveryResultJson: null,
    },
    identities: [],
    sheets: {
      spreadsheetId: "sheet_client",
      spreadsheetTitle: "Client",
      canaryApproved: false,
      campaignDispatchEnabled: false,
      agedDispatchEnabled: false,
      campaign: {
        worksheetId: 10,
        worksheetTitle: "Campaign Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
        header,
      },
      canary: { worksheetId: 20, worksheetTitle: "Canary", header: [...COMPANY_SHEETS_CANARY_HEADER] },
      campaignRisk: { uncertain: false, appendStartedAtHeld: false },
      canaryRisk: { uncertain: false, appendStartedAtHeld: false },
      campaignControl: { establishControl: "drive_owner_verified", checkedAt: "2026-10-26T18:00:00.000Z" },
      destinationRevision: 3,
      approvedTestWorksheet: {
        spreadsheetId: "sheet_isolated",
        worksheetId: 77,
        worksheetTitle: "Approved Test Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
        header,
        headerSha256: "",
        destinationRevision: 4,
        ownerClientAccountId: clientAccountId,
        control: { establishControl: "company_created", checkedAt: "2026-10-26T18:00:00.000Z" },
      },
      approvedTestWorksheetRisk: { uncertain: false, appendStartedAtHeld: false },
    },
    ghl: null,
    production: {
      sourceLeadEventCount: 1,
      inventoryCount: 0,
      billingRowCount: 0,
      dispatchIntentCount: 0,
      eventStatus: "routing_matched",
      eventDeliveryResult: null,
      campaignDispatchEnabled: false,
      agedDispatchEnabled: false,
    },
  };
}

test("destination profile, worksheet approval, and activation intent do not enable delivery", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const clientAccountId = `ob2_cfg_${randomUUID().slice(0, 8)}`;
  const otherId = `ob2_cfg_other_${randomUUID().slice(0, 8)}`;
  await prisma.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "Config Client",
      ghlDestination: {
        create: { destinationSubaccountIdGhl: `loc_${clientAccountId}`, deliveryEnabled: false, clientCutoverApproved: false },
      },
    },
  });
  await prisma.clientAccount.create({
    data: {
      clientAccountId: otherId,
      clientDisplayName: "Other Client",
      ghlDestination: { create: { destinationSubaccountIdGhl: `loc_${otherId}`, deliveryEnabled: false } },
    },
  });
  try {
    const saved = await saveOnboardingDestinationProfile({
      clientAccountId,
      requestId: randomUUID(),
      expectedRevision: 0,
      sheetsSelected: true,
      ghlMode: "location_api",
      notesEnabled: true,
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.notesEnabled, true);
    assert.equal(saved.notesContractVersion, "sa360_lead_note_v2");
    assert.equal(saved.deliveryEnabled, false);
    assert.equal(saved.campaignDispatchEnabled, false);
    const destination = await prisma.clientGhlDestination.findUniqueOrThrow({ where: { clientAccountId } });
    assert.equal(destination.deliveryEnabled, false);
    assert.equal(destination.workflowTriggerMode, "tag_trigger");

    const canary = await approveExactV3TestWorksheet(
      { clientAccountId, requestId: randomUUID() },
      async () => ({
        spreadsheetId: `sheet_${clientAccountId}`,
        worksheetId: 4,
        worksheetTitle: "Canary",
        header: [...COMPANY_SHEETS_CANARY_HEADER],
        control: { establishControl: "drive_owner_verified", checkedAt: "2026-10-26T18:00:00.000Z" },
        destinationRevision: 1,
      })
    );
    assert.equal(canary.ok, false);
    if (canary.ok) return;
    assert.equal(canary.error, "canary_schema_mismatch");
    assert.equal(await prisma.clientOnboardingTestWorksheet.count({ where: { clientAccountId } }), 0);
    assert.equal(await prisma.companySheetsDestination.count({ where: { clientAccountId } }), 0);

    const approved = await approveExactV3TestWorksheet(
      { clientAccountId, requestId: randomUUID() },
      async () => ({
        spreadsheetId: `sheet_${clientAccountId}`,
        worksheetId: 77,
        worksheetTitle: "Approved Test Leads",
        header,
        control: { establishControl: "drive_owner_verified", checkedAt: "2026-10-26T18:00:00.000Z" },
        destinationRevision: 1,
      })
    );
    assert.equal(approved.ok, true);
    const worksheet = await prisma.clientOnboardingTestWorksheet.findUniqueOrThrow({ where: { clientAccountId } });
    assert.equal(worksheet.schemaVersion, "company_sheets_campaign_v3");
    assert.equal(worksheet.worksheetId, 77);

    const intent = await recordActivationIntent({
      clientAccountId,
      requestId: randomUUID(),
      destination: "google_sheets_campaign",
      confirmation: "ACTIVATE CLIENT ONBOARDING DESTINATION",
      expectedReceiptIds: [],
    });
    assert.equal(intent.ok, true);
    if (!intent.ok) return;
    assert.equal(intent.status, "blocked");
    assert.equal(intent.activatesDelivery, false);
    const stored = await prisma.clientOnboardingActivationIntent.findUniqueOrThrow({ where: { id: intent.id } });
    assert.equal(stored.deliverySwitchChanged, false);
    assert.equal(stored.cutoffChanged, false);
    assert.equal((await prisma.clientGhlDestination.findUniqueOrThrow({ where: { clientAccountId } })).deliveryEnabled, false);
    assert.equal((await prisma.clientGhlDestination.findUniqueOrThrow({ where: { clientAccountId: otherId } })).deliveryEnabled, false);

    await saveSelectTimeZone(clientAccountId, {
      destinationWorkflowIdGhl: "wf_select_time_zone",
      workflowTriggerMode: "direct_api",
    });
    const selected = await prisma.clientGhlDestination.findUniqueOrThrow({ where: { clientAccountId } });
    assert.equal(selected.destinationWorkflowIdGhl, "wf_select_time_zone");
    assert.equal(selected.workflowTriggerMode, "direct_api");
    assert.equal(selected.deliveryEnabled, false);
    assert.equal(selected.clientCutoverApproved, false);
    assert.equal(process.env.SA360_CLIENT_ONBOARDING_V2_ACTIVATION_ENABLED, undefined);
  } finally {
    await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: [clientAccountId, otherId] } } });
  }
});

test("prisma preview persists one sheets attempt and a stale header blocks delivery before a call", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const clientAccountId = `ob2_store_${randomUUID().slice(0, 8)}`;
  await prisma.clientAccount.create({ data: { clientAccountId, clientDisplayName: "Store Client" } });
  const store = createPrismaCapturedTestStore();
  const sheets = createFailClosedSheetsAppend();
  const eventId = `evt_${randomUUID().slice(0, 8)}`;
  const snapshot = world(clientAccountId, eventId);
  try {
    const preview = await runCapturedTestDelivery(
      {
        requestId: randomUUID(),
        kind: "preview",
        clientAccountId,
        destinations: ["google_sheets"],
        execute: false,
        isolation: { mode: "verified_test_identity", sheetsContract: "exact_v3_test_worksheet" },
      },
      snapshot,
      { env: enabled, store, sheets, execution: "injected_fakes", newId: () => randomUUID() }
    );
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    assert.equal(preview.persisted, true);
    const attempts = await prisma.clientOnboardingTestAttempt.findMany({
      where: { testRunId: preview.run.id },
      include: { keys: true },
    });
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.destination, "google_sheets");
    assert.equal(attempts[0]?.externalCallExecuted, false);
    assert.equal(attempts[0]?.appendStartedAt, null);
    assert.equal(attempts[0]?.schemaVersion, "company_sheets_campaign_v3");
    assert.equal(attempts[0]?.keys[0]?.callKind, "sheets");
    assert.equal(sheets.calls.length, 0);

    const refused = await runCapturedTestDelivery(
      {
        requestId: randomUUID(),
        kind: "captured_event_delivery",
        clientAccountId,
        sourceLeadEventId: eventId,
        destinations: ["google_sheets"],
        execute: true,
        confirmation: CONFIRM_DELIVER,
        isolation: { mode: "isolated_destination", sheetsContract: "exact_v3_test_worksheet" },
      },
      snapshot,
      {
        env: enabled,
        store,
        sheets,
        execution: "injected_fakes",
        newId: () => randomUUID(),
        rereadSheet: async () => null,
      }
    );
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.error, "header_changed");
    assert.equal(refused.externalCalls.sheets, false);
    assert.equal(sheets.calls.length, 0);

    const canary = await runCapturedTestDelivery(
      {
        requestId: randomUUID(),
        kind: "captured_event_delivery",
        clientAccountId,
        sourceLeadEventId: eventId,
        destinations: ["google_sheets"],
        execute: true,
        confirmation: CONFIRM_DELIVER,
        isolation: { mode: "isolated_destination", sheetsContract: "canary_v1_projection" },
      },
      snapshot,
      { env: enabled, store, sheets, execution: "injected_fakes", newId: () => randomUUID() }
    );
    assert.equal(canary.ok, false);
    if (canary.ok) return;
    assert.equal(canary.error, "canary_projection_not_a_v3_proof");
    assert.equal(canary.externalCalls.sheets, false);
    assert.equal(sheets.calls.length, 0);
    assert.equal(
      await prisma.clientOnboardingTestAttempt.count({
        where: { ownerClientAccountId: clientAccountId, externalCallExecuted: true },
      }),
      0
    );
  } finally {
    await prisma.clientAccount.deleteMany({ where: { clientAccountId } });
  }
});
