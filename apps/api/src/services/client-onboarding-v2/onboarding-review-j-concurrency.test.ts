/**
 * Agent J re-review of PR #241 at 750d3353.
 *
 * These assertions are the original safety properties from d2ab48f.
 * Do not weaken them.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";

import { PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
  companySheetsCampaignHeader,
} from "../../lib/company-google-sheets-env.js";
import {
  CONFIRM_DELIVER,
  CONFIRM_ONE_GOOGLE_SHEETS_ROW,
  ONBOARDING_OPERATOR_OWNED_TEST_CLASS,
  runCapturedTestDelivery,
  sha256Text,
  type CapturedTestRequest,
  type CapturedTestWorld,
} from "./captured-test-delivery.js";
import { createFakeSheetsAppend, createMemoryCapturedTestStore, fakeOnboardingLeadNote } from "./captured-test-delivery.fakes.js";
import { createPrismaCapturedTestStore } from "./onboarding-test-store.js";
import { adminClientOnboardingV2TestRoutes } from "../../routes/admin-client-onboarding-v2-test.js";

const header = [...(companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) ?? [])];
const headerSha256 = sha256Text(JSON.stringify(header));
const enabled = {
  SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED: "true",
  SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED: "true",
  SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED: "true",
} as NodeJS.ProcessEnv;
const RACE_EMAIL = "operator-owned@sa360.pilot";

function deliveryWorld(clientAccountId: string, eventId: string): CapturedTestWorld {
  return {
    clientFound: true,
      event: {
        id: eventId,
        clientAccountIdResolved: clientAccountId,
        status: "received",
        sourceRouteKey: "operator_owned_test",
        sourceProvider: "manual_import",
        sourceSystem: "external_vendor",
        sourceType: "manual_entry",
        webhookRequestLogId: null,
        enrichmentMetadataJson: { recordClass: ONBOARDING_OPERATOR_OWNED_TEST_CLASS },
        normalizedPayloadJson: { contact: { email: RACE_EMAIL, phone_e164: "+15551230000" } },
        receivedAt: "2026-10-26T15:00:00.000Z",
        sourceLeadId: "src_review_j",
        deliveryResultJson: null,
        downstream: { inventoryCount: 0, fulfillmentCount: 0, allocationCount: 0, dispatchIntentCount: 0 },
      },
      identities: [{ email: RACE_EMAIL, phoneE164: "+15551230000" }],
      testIdentitySharedWithOtherClient: false,
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
        headerSha256,
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

function deliveryRequest(clientAccountId: string, eventId: string, requestId: string): CapturedTestRequest {
  return {
    requestId,
    kind: "captured_event_delivery",
    clientAccountId,
    sourceLeadEventId: eventId,
    destinations: ["google_sheets"],
    execute: true,
    confirmation: CONFIRM_ONE_GOOGLE_SHEETS_ROW,
    isolation: { mode: "isolated_destination", sheetsContract: "exact_v3_test_worksheet" },
    actorLabel: "review-j",
  };
}

async function reservationWait(): Promise<{ tableWaiters: number; advisoryWaiters: number }> {
  const rows = await prisma.$queryRaw<Array<{ table_waiters: number; advisory_waiters: number }>>`
    SELECT
      COUNT(*) FILTER (
        WHERE NOT granted AND relation = '"ClientOnboardingTestRun"'::regclass
      )::int AS table_waiters,
      COUNT(*) FILTER (
        WHERE NOT granted AND locktype = 'advisory'
      )::int AS advisory_waiters
    FROM pg_locks
  `;
  return {
    tableWaiters: Number(rows[0]?.table_waiters ?? 0),
    advisoryWaiters: Number(rows[0]?.advisory_waiters ?? 0),
  };
}

test("two different request ids cannot both send the same captured lead", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const clientAccountId = `ob2_race_${randomUUID().slice(0, 8)}`;
  const requestA = randomUUID();
  const requestB = randomUUID();
  await prisma.clientAccount.create({ data: { clientAccountId, clientDisplayName: "Race Client" } });
  const event = await prisma.sourceLeadEvent.create({
    data: {
      sourceProvider: "manual_import",
      sourceSystem: "external_vendor",
      sourceType: "manual_entry",
      rawPayloadJson: { fixture: "review-j-race" },
      normalizedPayloadJson: { contact: { email: RACE_EMAIL, phone_e164: "+15551230000" } },
      enrichmentMetadataJson: { recordClass: ONBOARDING_OPERATOR_OWNED_TEST_CLASS },
      clientAccountIdResolved: clientAccountId,
    },
  });
  await prisma.clientOnboardingVerifiedTestIdentity.create({
    data: {
      clientAccountId,
      email: RACE_EMAIL,
      phoneE164: "+15551230000",
      requestId: randomUUID(),
      actorLabel: "review-j",
      evidenceJson: { method: "operator_confirmed" },
    },
  });
  const sheets = createFakeSheetsAppend();
  const leftDb = new PrismaClient();
  const rightDb = new PrismaClient();
  const storeA = createPrismaCapturedTestStore(leftDb);
  const storeB = createPrismaCapturedTestStore(rightDb);
  const world = deliveryWorld(clientAccountId, event.id);
  const locker = new PrismaClient();
  let releaseLock = () => {};
  const released = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const held = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("lock holder did not acquire the table lock")), 15000);
    locker
      .$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`LOCK TABLE "ClientOnboardingTestRun" IN EXCLUSIVE MODE`);
          clearTimeout(timer);
          resolve();
          await released;
        },
        { maxWait: 15000, timeout: 60000 }
      )
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });

  try {
    await held;
    const rereadSheet = async (sheet: {
      header: string[];
      headerSha256: string;
      control: { establishControl: string; checkedAt: string } | null;
      ownerClientAccountId: string;
      destinationRevision: number;
    }) => ({
      header: [...sheet.header],
      headerSha256: sheet.headerSha256,
      control: sheet.control,
      ownerClientAccountId: sheet.ownerClientAccountId,
      destinationRevision: sheet.destinationRevision,
      historicalDataRows: "empty" as const,
    });
    const first = runCapturedTestDelivery(deliveryRequest(clientAccountId, event.id, requestA), world, {
      env: enabled,
      store: storeA,
      sheets,
      execution: "injected_fakes",
      rereadSheet,
    });
    const second = runCapturedTestDelivery(deliveryRequest(clientAccountId, event.id, requestB), world, {
      env: enabled,
      store: storeB,
      sheets,
      execution: "injected_fakes",
      rereadSheet,
    });

    const started = Date.now();
    let waiting = { tableWaiters: 0, advisoryWaiters: 0 };
    while (Date.now() - started < 4000) {
      waiting = await reservationWait();
      if (waiting.tableWaiters >= 1 && waiting.advisoryWaiters >= 1) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    releaseLock();
    const [left, right] = await Promise.all([first, second]);
    const sends = sheets.calls.length;
    const outcomes = [left, right].map((result) => (result.ok ? `ok:${result.run.status}` : `error:${result.error}`));
    assert.equal(
      sends,
      1,
      `two request ids for one source event both appended (${sends} sends; tableWaiters=${waiting.tableWaiters}; advisoryWaiters=${waiting.advisoryWaiters}; ${outcomes.join(", ")}). ` +
        "Unique requestId does not serialize the prior-run check."
    );
    assert.equal(
      waiting.tableWaiters >= 1 && waiting.advisoryWaiters >= 1,
      true,
      `the winner must be blocked on its insert and the loser on the advisory lock before either commits; tableWaiters=${waiting.tableWaiters}; advisoryWaiters=${waiting.advisoryWaiters}`
    )
    assert.equal(outcomes.filter((item) => item.startsWith("ok:")).length, 1);
    assert.equal(
      outcomes.some((item) => item === "error:repeat_blocked_in_flight"),
      true,
      `the loser must be repeat_blocked_in_flight before any second send; got ${outcomes.join(", ")}`
    );
  } finally {
    releaseLock();
    await Promise.all([
      locker.$disconnect().catch(() => undefined),
      leftDb.$disconnect().catch(() => undefined),
      rightDb.$disconnect().catch(() => undefined),
    ]);
    await prisma.clientOnboardingVerifiedTestIdentity.deleteMany({ where: { clientAccountId } }).catch(() => undefined);
    await prisma.clientOnboardingTestRun.deleteMany({ where: { clientAccountId } }).catch(() => undefined);
    await prisma.sourceLeadEvent.deleteMany({ where: { id: event.id } }).catch(() => undefined);
    await prisma.clientAccount.deleteMany({ where: { clientAccountId } }).catch(() => undefined);
  }
});

function routeWorld(): CapturedTestWorld {
  return {
      clientFound: true,
      event: {
        id: "evt_note_v2",
        clientAccountIdResolved: "client_a",
        status: "routing_matched",
        sourceRouteKey: "operator_owned_test",
        sourceProvider: "manual_import",
        sourceSystem: "external_vendor",
        sourceType: "manual_entry",
        webhookRequestLogId: null,
        enrichmentMetadataJson: { recordClass: ONBOARDING_OPERATOR_OWNED_TEST_CLASS },
        normalizedPayloadJson: {
          contact: { email: RACE_EMAIL, phone_e164: "+15551230000" },
        },
        receivedAt: "2026-10-26T15:00:00.000Z",
        sourceLeadId: null,
        deliveryResultJson: null,
        downstream: { inventoryCount: 0, fulfillmentCount: 0, allocationCount: 0, dispatchIntentCount: 0 },
      },
      identities: [{ email: RACE_EMAIL, phoneE164: "+15551230000" }],
      testIdentitySharedWithOtherClient: false,
      sheets: {
        spreadsheetId: "sheet_client",
        spreadsheetTitle: null,
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
        destinationRevision: 2,
        approvedTestWorksheet: {
          spreadsheetId: "sheet_isolated",
          worksheetId: 77,
          worksheetTitle: "Onboarding Test Leads",
          schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
          header,
          headerSha256,
          destinationRevision: 4,
          ownerClientAccountId: "client_a",
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
        discoveredWorkflows: [{ id: "wf_timezone", name: "Select Time Zone", status: "published" }],
      },
      storedLead: {
        sourceLeadEventId: "evt_note_v2",
        clientAccountId: "client_a",
        email: "ada@example.invalid",
        phone: "+15555550100",
        firstName: "Ada",
        lastName: "Lovelace",
      },
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

const refusedReceipt = {
  ok: false as const,
  posted: false,
  retried: false as const,
  externalCallExecuted: false,
  error: "review_probe",
  detail: null,
  evidence: {
    http_accepted: false,
    contact_upserted: false,
    note_persisted: false,
    workflow_enrolled: false,
    downstream_executed: false as const,
  },
  contactId: null,
  workflowId: null,
  idempotencyKeys: null,
  notes: [],
  calls: [],
  configuredNoteBodyMaxChars: null,
  providerNoteBodyCeiling: 10000 as const,
};

test("the mounted test route rereads the worksheet before an append", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const sheets = createFakeSheetsAppend();
  let rereadCalls = 0;
  const app = Fastify({ logger: false });
  await app.register(adminClientOnboardingV2TestRoutes, {
    prefix: "/admin/v1",
    env: enabled,
    execution: "injected_fakes",
    store: createMemoryCapturedTestStore(),
    notes: fakeOnboardingLeadNote(),
    sheets,
    rereadSheet: async () => {
      rereadCalls += 1;
      return null;
    },
    loadWorld: () => routeWorld(),
  });
  try {
    const drifted = await app.inject({
      method: "POST",
      url: "/admin/v1/clients/client_a/onboarding/test-runs",
      headers: { "x-sa360-admin-key": "admin-secret" },
      payload: {
        requestId: randomUUID(),
        kind: "captured_event_delivery",
        sourceLeadEventId: "evt_note_v2",
        destinations: ["google_sheets"],
        execute: true,
        confirmation: CONFIRM_ONE_GOOGLE_SHEETS_ROW,
        isolation: { mode: "isolated_destination", sheetsContract: "exact_v3_test_worksheet" },
      },
    });
    assert.equal(
      rereadCalls,
      1,
      `app.ts supplies rereadSheet, but the route dropped it (calls=${rereadCalls}, sheets=${sheets.calls.length}, error=${drifted.json().error})`
    );
    assert.equal(drifted.json().error, "header_changed");
    assert.equal(sheets.calls.length, 0, "a changed worksheet must not be appended");
  } finally {
    await app.close();
    if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
    else delete process.env.ADMIN_API_KEY;
  }
});

test("the mounted test route refuses Sheets plus GHL before any external call", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const sheets = createFakeSheetsAppend();
  let ghlDeliveries = 0;
  const app = Fastify({ logger: false });
  await app.register(adminClientOnboardingV2TestRoutes, {
    prefix: "/admin/v1",
    env: enabled,
    execution: "injected_fakes",
    store: createMemoryCapturedTestStore(),
    notes: fakeOnboardingLeadNote(),
    sheets,
    ghlAggregate: {
      async deliver() {
        ghlDeliveries += 1;
        return refusedReceipt;
      },
    },
    rereadSheet: async (sheet) => ({
      header: [...sheet.header],
      headerSha256: sheet.headerSha256,
      control: sheet.control,
      ownerClientAccountId: sheet.ownerClientAccountId,
      destinationRevision: sheet.destinationRevision,
    }),
    loadWorld: () => routeWorld(),
  });
  try {
    const ghl = await app.inject({
      method: "POST",
      url: "/admin/v1/clients/client_a/onboarding/test-runs",
      headers: { "x-sa360-admin-key": "admin-secret" },
      payload: {
        requestId: randomUUID(),
        kind: "captured_event_delivery",
        sourceLeadEventId: "evt_note_v2",
        destinations: ["google_sheets", "ghl_location_api"],
        execute: true,
        confirmation: CONFIRM_DELIVER,
        acknowledgeDownstreamAutomation: true,
        isolation: { mode: "verified_test_identity", sheetsContract: "exact_v3_test_worksheet" },
      },
    });
    assert.equal(ghl.json().error, "google_only_pilot_required");
    assert.equal(ghlDeliveries, 0, "Sheets+GHL is not an authorized Google-only pilot call");
    assert.equal(sheets.calls.length, 0);
  } finally {
    await app.close();
    if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
    else delete process.env.ADMIN_API_KEY;
  }
});
