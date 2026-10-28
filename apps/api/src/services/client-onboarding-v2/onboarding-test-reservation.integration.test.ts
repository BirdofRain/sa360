/**
 * Two Prisma clients reserve one captured test at a time.
 * Google and GHL are in-process fakes. No production host is contacted.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3, companySheetsCampaignHeader } from "../../lib/company-google-sheets-env.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  CONFIRM_ONE_GOOGLE_SHEETS_ROW,
  runCapturedTestDelivery,
  type CapturedTestRequest,
  type CapturedTestWorld,
  type SheetsAppendOutcome,
} from "./captured-test-delivery.js";
import { fakeOnboardingLeadNote } from "./captured-test-delivery.fakes.js";
import {
  GHL_CONTACT_NOTE_TRANSMIT_CEILING,
  type OnboardingGhlTestDeliveryReceipt,
  type OnboardingGhlTestDeliveryRequest,
} from "./onboarding-ghl-test-adapter.js";
import { createPrismaCapturedTestStore } from "./onboarding-test-store.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const EMAIL = "reservation-owned@sa360.pilot";
const PHONE = "+15555550199";
const header = [...(companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) ?? [])];

describe("captured test reservation across two Prisma clients", { skip: !runIntegration }, () => {
  let leftDb: PrismaClient;
  let rightDb: PrismaClient;
  const suffix = `${Date.now()}`;
  const clientId = `ong241fix_${suffix}`;
  const eventIds: string[] = [];

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    leftDb = new PrismaClient({ datasources: { db: { url } } });
    rightDb = new PrismaClient({ datasources: { db: { url } } });
    await leftDb.clientAccount.create({
      data: { clientAccountId: clientId, clientDisplayName: "Reservation Mock", status: "active" },
    });
    await leftDb.clientOnboardingVerifiedTestIdentity.create({
      data: {
        clientAccountId: clientId,
        email: EMAIL,
        phoneE164: PHONE,
        requestId: randomUUID(),
        actorLabel: "reservation",
        evidenceJson: { method: "operator_confirmed" },
      },
    });
  });

  after(async () => {
    if (!leftDb) return;
    await leftDb.clientOnboardingVerifiedTestIdentity.deleteMany({ where: { clientAccountId: clientId } }).catch(() => undefined);
    await leftDb.clientOnboardingTestRun.deleteMany({ where: { clientAccountId: clientId } }).catch(() => undefined);
    await leftDb.sourceLeadEvent.deleteMany({ where: { id: { in: eventIds } } }).catch(() => undefined);
    await leftDb.clientAccount.deleteMany({ where: { clientAccountId: clientId } }).catch(() => undefined);
    await leftDb.$disconnect();
    await rightDb.$disconnect();
  });

  it("refuses concurrent forged intake before any sheets reservation", async () => {
    const raceEvent = await createEvent(leftDb, clientId, eventIds);
    const sheets = openSheets();
    const left = createPrismaCapturedTestStore(leftDb);
    const right = createPrismaCapturedTestStore(rightDb);
    const eventsBefore = await leftDb.sourceLeadEvent.count({ where: { clientAccountIdResolved: clientId } });

    const [first, second] = await Promise.all([
      deliver(left, sheets.port, undefined, clientId, raceEvent, `req_sheets_a_${suffix}`),
      deliver(right, sheets.port, undefined, clientId, raceEvent, `req_sheets_b_${suffix}`),
    ]);
    assert.equal(sheets.appends, 0);
    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    if (first.ok || second.ok) return;
    assert.equal(first.error, "quarantine_not_registered");
    assert.equal(second.error, "quarantine_not_registered");
    assert.equal(await leftDb.clientOnboardingTestRun.count({ where: { clientAccountId: clientId, sourceLeadEventId: raceEvent } }), 0);
    assert.equal(await leftDb.companySheetsDeliveryJob.count({ where: { clientAccountId: clientId } }), 0);

    const repeated = await deliver(right, sheets.port, undefined, clientId, raceEvent, `req_sheets_a_${suffix}`);
    assert.equal(repeated.ok, false);
    if (repeated.ok) return;
    assert.equal(repeated.error, "quarantine_not_registered");
    assert.equal(sheets.appends, 0);

    const ghlEvent = await createEvent(leftDb, clientId, eventIds);
    const ghl = heldGhl();
    const ghlLeft = await deliver(left, openSheets().port, ghl.port, clientId, ghlEvent, `req_ghl_a_${suffix}`, ["ghl_location_api"]);
    const ghlRight = await deliver(right, openSheets().port, ghl.port, clientId, ghlEvent, `req_ghl_b_${suffix}`, ["ghl_location_api"]);
    assert.equal(ghl.deliveries, 0);
    assert.equal(ghlLeft.ok, false);
    assert.equal(ghlRight.ok, false);
    if (ghlLeft.ok || ghlRight.ok) return;
    assert.equal(ghlLeft.error, "google_only_pilot_required");
    assert.equal(ghlRight.error, "google_only_pilot_required");
    const ghlRuns = await rightDb.clientOnboardingTestRun.findMany({
      where: { clientAccountId: clientId, sourceLeadEventId: ghlEvent },
    });
    assert.equal(ghlRuns.length, 0);
    assert.equal(await leftDb.sourceLeadEvent.count({ where: { clientAccountIdResolved: clientId } }), eventsBefore + 1);
    const account = await rightDb.clientAccount.findUniqueOrThrow({ where: { clientAccountId: clientId } });
    assert.equal(account.status, "active");
  });
});

async function createEvent(db: PrismaClient, clientId: string, eventIds: string[]): Promise<string> {
  const lead = await db.sourceLeadEvent.create({
    data: {
      sourceLeadUid: `ong241fix_${randomUUID()}`,
      sourceProvider: "manual_import",
      sourceSystem: "external_vendor",
      sourceType: "manual_entry",
      clientAccountIdResolved: clientId,
      status: "routing_matched",
      receivedAt: new Date("2026-10-26T15:00:00.000Z"),
      rawPayloadJson: { fixture: "synthetic" },
      normalizedPayloadJson: {
        contact: { first_name: "Ada", last_name: "Mock", email: EMAIL, phone_e164: PHONE, state: "VA" },
      },
      enrichmentMetadataJson: { recordClass: "onboarding_operator_owned_test" },
    },
  });
  eventIds.push(lead.id);
  return lead.id;
}

function deliver(
  store: ReturnType<typeof createPrismaCapturedTestStore>,
  sheets: { append(request: unknown): Promise<SheetsAppendOutcome> },
  ghl: { deliver(request: OnboardingGhlTestDeliveryRequest): Promise<OnboardingGhlTestDeliveryReceipt> } | undefined,
  clientId: string,
  eventId: string,
  requestId: string,
  destinations: CapturedTestRequest["destinations"] = ["google_sheets"]
) {
  return runCapturedTestDelivery(requestFor(clientId, eventId, requestId, destinations), worldFor(clientId, eventId), {
    env: {
      SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED: "true",
      SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED: "true",
      SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED: "true",
    },
    notes: fakeOnboardingLeadNote(),
    store,
    sheets,
    ghlAggregate: ghl,
    rereadSheet: async (sheet) => ({
      header: [...sheet.header],
      headerSha256: sheet.headerSha256,
      control: sheet.control,
      ownerClientAccountId: sheet.ownerClientAccountId,
      destinationRevision: sheet.destinationRevision,
      historicalDataRows: "empty" as const,
    }),
    execution: "injected_fakes",
  });
}

function requestFor(
  clientId: string,
  eventId: string,
  requestId: string,
  destinations: CapturedTestRequest["destinations"]
): CapturedTestRequest {
  return {
    requestId,
    kind: "captured_event_delivery",
    clientAccountId: clientId,
    sourceLeadEventId: eventId,
    destinations,
    execute: true,
    confirmation: CONFIRM_ONE_GOOGLE_SHEETS_ROW,
    acknowledgeDownstreamAutomation: true,
    isolation: { mode: "isolated_destination", sheetsContract: "exact_v3_test_worksheet" },
    noteOverflow: "refuse",
    repeatOfTestRunId: null,
    actorLabel: "operator",
  };
}

function worldFor(clientId: string, eventId: string): CapturedTestWorld {
  return {
    clientFound: true,
    event: {
      id: eventId,
      clientAccountIdResolved: clientId,
      status: "routing_matched",
      sourceRouteKey: "operator_owned_test",
      sourceProvider: "manual_import",
      sourceSystem: "external_vendor",
      sourceType: "manual_entry",
      webhookRequestLogId: null,
      enrichmentMetadataJson: { recordClass: "onboarding_operator_owned_test" },
      normalizedPayloadJson: {
        contact: { first_name: "Ada", last_name: "Mock", email: EMAIL, phone_e164: PHONE, state: "VA" },
      },
      receivedAt: "2026-10-26T15:00:00.000Z",
      sourceLeadId: null,
      deliveryResultJson: null,
      downstream: { inventoryCount: 0, fulfillmentCount: 0, allocationCount: 0, dispatchIntentCount: 0 },
    },
    identities: [{ email: EMAIL, phoneE164: PHONE }],
    testIdentitySharedWithOtherClient: false,
    sheets: {
      spreadsheetId: `sheet_${clientId}`,
      spreadsheetTitle: "Reservation",
      canaryApproved: false,
      campaignDispatchEnabled: false,
      agedDispatchEnabled: false,
      campaign: {
        worksheetId: 10,
        worksheetTitle: "Campaign Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
        header,
      },
      canary: null,
      campaignRisk: { uncertain: false, appendStartedAtHeld: false },
      canaryRisk: { uncertain: false, appendStartedAtHeld: false },
      campaignControl: { establishControl: "drive_owner_verified", checkedAt: "2026-10-26T18:00:00.000Z" },
      destinationRevision: 3,
      approvedTestWorksheet: {
        spreadsheetId: `test_${clientId}`,
        worksheetId: 77,
        worksheetTitle: "Onboarding Test Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
        header,
        headerSha256: "a".repeat(64),
        destinationRevision: 1,
        ownerClientAccountId: clientId,
        control: { establishControl: "drive_owner_verified", checkedAt: "2026-10-26T18:00:00.000Z" },
      },
      approvedTestWorksheetRisk: { uncertain: false, appendStartedAtHeld: false },
    },
    ghl: {
      locationId: "loc_mock",
      isolatedLocationId: null,
      workflowId: "wf_timezone",
      workflowName: "Select Time Zone",
      workflowTriggerMode: "direct_api",
      notesEnabled: true,
      discoveredWorkflows: [{ id: "wf_timezone", name: "Select Time Zone", status: "published" }],
    },
    storedLead: {
      sourceLeadEventId: eventId,
      clientAccountId: clientId,
      generatedAt: "2026-10-26T15:00:00.000Z",
      firstName: "Ada",
      lastName: "Mock",
      email: EMAIL,
      phone: PHONE,
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

function openSheets() {
  let appends = 0;
  return {
    get appends() {
      return appends;
    },
    port: {
      async append(): Promise<SheetsAppendOutcome> {
        appends += 1;
        return { status: "succeeded", rowsWritten: 1, externalCallExecuted: true };
      },
    },
  };
}

function heldGhl() {
  let deliveries = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    get deliveries() {
      return deliveries;
    },
    release,
    port: {
      async deliver(request: OnboardingGhlTestDeliveryRequest): Promise<OnboardingGhlTestDeliveryReceipt> {
        deliveries += 1;
        await gate;
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
      },
    },
  };
}
