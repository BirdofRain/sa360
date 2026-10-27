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
  CONFIRM_DELIVER,
  runCapturedTestDelivery,
  type CapturedTestOutcome,
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
const EMAIL = "reservation.mock@example.invalid";
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
  });

  after(async () => {
    if (!leftDb) return;
    await leftDb.clientOnboardingTestRun.deleteMany({ where: { clientAccountId: clientId } }).catch(() => undefined);
    await leftDb.sourceLeadEvent.deleteMany({ where: { id: { in: eventIds } } }).catch(() => undefined);
    await leftDb.clientAccount.deleteMany({ where: { clientAccountId: clientId } }).catch(() => undefined);
    await leftDb.$disconnect();
    await rightDb.$disconnect();
  });

  it("lets one sheets reservation and one GHL reservation execute", async () => {
    const raceEvent = await createEvent(leftDb, clientId, eventIds);
    const sheets = heldSheets();
    const left = createPrismaCapturedTestStore(leftDb);
    const right = createPrismaCapturedTestStore(rightDb);
    const eventsBefore = await leftDb.sourceLeadEvent.count({ where: { clientAccountIdResolved: clientId } });

    const pendingA = deliver(left, sheets.port, undefined, clientId, raceEvent, `req_sheets_a_${suffix}`);
    const pendingB = deliver(right, sheets.port, undefined, clientId, raceEvent, `req_sheets_b_${suffix}`);
    const earlySheets = await firstToSettle(pendingA, pendingB);
    await untilCount(() => sheets.appends, 1);
    assert.equal(sheets.appends, 1);
    assert.equal(earlySheets.ok, false);
    sheets.release();
    const [first, second] = await Promise.all([pendingA, pendingB]);
    const executed = [first, second].filter(executedNow);
    const blocked = [first, second].filter((outcome) => !outcome.ok);
    assert.equal(executed.length, 1);
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0]?.ok, false);
    if (blocked[0]?.ok !== false) return;
    assert.ok(blocked[0].error === "repeat_blocked_in_flight" || blocked[0].error === "repeat_of_required");
    assert.equal(sheets.appends, 1);

    const winner = executed[0];
    assert.equal(winner?.ok, true);
    if (!winner?.ok) return;
    const repeated = await deliver(right, sheets.port, undefined, clientId, raceEvent, winner.run.requestId);
    assert.equal(repeated.ok, true);
    if (!repeated.ok) return;
    assert.equal(repeated.duplicateRequest, true);
    assert.equal(repeated.externalCallsThisRequest.sheets, false);
    assert.equal(sheets.appends, 1);

    const sheetsRuns = await leftDb.clientOnboardingTestRun.findMany({
      where: { clientAccountId: clientId, sourceLeadEventId: raceEvent },
      include: { attempts: { include: { keys: true } } },
    });
    assert.equal(sheetsRuns.length, 1);
    assert.equal(sheetsRuns[0]?.status, "succeeded");
    assert.equal(sheetsRuns[0]?.attempts.length, 1);
    assert.equal(sheetsRuns[0]?.attempts[0]?.destination, "google_sheets");
    assert.equal(sheetsRuns[0]?.attempts[0]?.externalCallExecuted, true);
    assert.equal(sheetsRuns[0]?.attempts[0]?.downstreamExecuted, false);
    assert.ok(sheetsRuns[0]?.attempts[0]?.keys.some((key) => key.idempotencyKey.endsWith(":sheets")));
    const sheetsAudits = await leftDb.clientOnboardingV2AuditEvent.count({
      where: { clientAccountId: clientId, sourceLeadEventId: raceEvent, action: "execute" },
    });
    assert.equal(sheetsAudits, 1);

    const sharedA = await createEvent(leftDb, clientId, eventIds);
    const sharedB = await createEvent(leftDb, clientId, eventIds);
    const separate = openSheets();
    const [sharedLeft, sharedRight] = await Promise.all([
      deliver(left, separate.port, undefined, clientId, sharedA, `req_shared_a_${suffix}`),
      deliver(right, separate.port, undefined, clientId, sharedB, `req_shared_b_${suffix}`),
    ]);
    assert.equal(sharedLeft.ok, true);
    assert.equal(sharedRight.ok, true);
    assert.equal(separate.appends, 2);
    const sharedRuns = await leftDb.clientOnboardingTestRun.count({
      where: { clientAccountId: clientId, sourceLeadEventId: { in: [sharedA, sharedB] } },
    });
    assert.equal(sharedRuns, 2);

    const duplicateA = await createEvent(leftDb, clientId, eventIds);
    const duplicateB = await createEvent(leftDb, clientId, eventIds);
    const duplicateSheets = heldSheets();
    const duplicateRequestId = `req_same_${suffix}`;
    const duplicateLeft = deliver(left, duplicateSheets.port, undefined, clientId, duplicateA, duplicateRequestId);
    const duplicateRight = deliver(right, duplicateSheets.port, undefined, clientId, duplicateB, duplicateRequestId);
    const earlyDuplicate = await firstToSettle(duplicateLeft, duplicateRight);
    await untilCount(() => duplicateSheets.appends, 1);
    assert.equal(duplicateSheets.appends, 1);
    assert.equal(executedNow(earlyDuplicate), false);
    duplicateSheets.release();
    const duplicateOutcomes = await Promise.all([duplicateLeft, duplicateRight]);
    assert.equal(duplicateOutcomes.filter(executedNow).length, 1);
    assert.equal(duplicateSheets.appends, 1);
    const duplicateRuns = await leftDb.clientOnboardingTestRun.count({
      where: { clientAccountId: clientId, requestId: duplicateRequestId },
    });
    assert.equal(duplicateRuns, 1);

    const ghlEvent = await createEvent(leftDb, clientId, eventIds);
    const ghl = heldGhl();
    const ghlLeft = deliver(left, openSheets().port, ghl.port, clientId, ghlEvent, `req_ghl_a_${suffix}`, ["ghl_location_api"]);
    const ghlRight = deliver(right, openSheets().port, ghl.port, clientId, ghlEvent, `req_ghl_b_${suffix}`, ["ghl_location_api"]);
    const earlyGhl = await firstToSettle(ghlLeft, ghlRight);
    await untilCount(() => ghl.deliveries, 1);
    assert.equal(ghl.deliveries, 1);
    assert.equal(earlyGhl.ok, false);
    ghl.release();
    const ghlOutcomes = await Promise.all([ghlLeft, ghlRight]);
    assert.equal(ghlOutcomes.filter(executedNow).length, 1);
    assert.equal(ghl.deliveries, 1);
    const ghlRuns = await rightDb.clientOnboardingTestRun.findMany({
      where: { clientAccountId: clientId, sourceLeadEventId: ghlEvent },
      include: { attempts: { include: { keys: true } } },
    });
    assert.equal(ghlRuns.length, 1);
    assert.equal(ghlRuns[0]?.attempts.length, 1);
    assert.equal(ghlRuns[0]?.attempts[0]?.destination, "ghl_location_api");
    assert.equal(ghlRuns[0]?.attempts[0]?.downstreamExecuted, false);
    assert.equal(ghlRuns[0]?.attempts[0]?.externalCallExecuted, true);
    const ghlKeys = ghlRuns[0]?.attempts[0]?.keys.map((key) => key.idempotencyKey) ?? [];
    assert.ok(ghlKeys.some((key) => key.endsWith(":ghl-contact")));
    assert.ok(ghlKeys.some((key) => key.endsWith(":ghl-workflow")));
    assert.ok(ghlKeys.some((key) => key.includes(":ghl-note:")));
    assert.equal(await leftDb.sourceLeadEvent.count({ where: { clientAccountIdResolved: clientId } }), eventsBefore + 5);
    const account = await rightDb.clientAccount.findUniqueOrThrow({ where: { clientAccountId: clientId } });
    assert.equal(account.status, "active");
  });
});

function executedNow(outcome: CapturedTestOutcome): boolean {
  if (!outcome.ok || outcome.duplicateRequest) return false;
  return outcome.externalCallsThisRequest.sheets || outcome.externalCallsThisRequest.ghl;
}

async function untilCount(read: () => number, expected: number) {
  const start = Date.now();
  while (read() < expected && Date.now() - start < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function firstToSettle<T>(left: Promise<T>, right: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      left,
      right,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out waiting for the blocked reservation")), 8000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
      enrichmentMetadataJson: { recordClass: "campaign_lead" },
      deliveryResultJson: { receipt: "unchanged" },
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
    },
    notes: fakeOnboardingLeadNote(),
    store,
    sheets,
    ghlAggregate: ghl,
    rereadSheet: async (sheet) => sheet,
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
    confirmation: CONFIRM_DELIVER,
    acknowledgeDownstreamAutomation: true,
    isolation: { mode: "verified_test_identity", sheetsContract: "exact_v3_test_worksheet" },
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
      sourceRouteKey: "manual",
      enrichmentMetadataJson: { recordClass: "campaign_lead" },
      normalizedPayloadJson: {
        contact: { first_name: "Ada", last_name: "Mock", email: EMAIL, phone_e164: PHONE, state: "VA" },
      },
      receivedAt: "2026-10-26T15:00:00.000Z",
      sourceLeadId: null,
      deliveryResultJson: { receipt: "unchanged" },
    },
    identities: [{ email: EMAIL, phoneE164: PHONE }],
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
      eventStatus: "routing_matched",
      eventDeliveryResult: { receipt: "unchanged" },
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

function heldSheets() {
  let appends = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    get appends() {
      return appends;
    },
    release,
    port: {
      async append(): Promise<SheetsAppendOutcome> {
        appends += 1;
        await gate;
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
