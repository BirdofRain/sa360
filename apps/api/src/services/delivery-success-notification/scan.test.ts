import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { isCustomWebhookDeliveryEnabled } from "../../lib/custom-webhook-env.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import type { SendTransactionalEmailInput } from "../../lib/transactional-email.js";
import {
  DELIVERY_SUCCESS_NOTIFICATION_STATUS,
  recordDeliverySuccessNotification,
} from "./notification-claim.js";
import {
  saveDeliveryNotificationRecipient,
  setDeliveryNotificationEnabled,
} from "./notification-preference.js";
import { scanCanonicalDeliveryNotifications } from "./scan.js";

const databaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
const ENABLED_AT = new Date("2026-11-01T12:00:00.000Z");
const CUTOFF = new Date("2026-10-01T00:00:00.000Z");
const INTENT_AT = new Date("2026-10-02T00:00:00.000Z");
const FINISHED = new Date("2026-11-01T15:00:00.000Z");
const COMPLETED = new Date("2026-11-01T16:00:00.000Z");
const SCAN_NOW = new Date("2026-11-06T18:00:00.000Z");
const RECIPIENT = "owner@example.com";
const STAFF_LIST = "staff-list@internal.example";

function newClient(): PrismaClient {
  const sep = databaseUrl.includes("?") ? "&" : "?";
  return new PrismaClient({
    datasources: { db: { url: `${databaseUrl}${sep}connection_limit=2` } },
  });
}

type SentMail = { to: string | string[]; text: string; idempotencyKey?: string };

let dbA: PrismaClient;
let dbB: PrismaClient;
const clientIds: string[] = [];
const connectionKeys: string[] = [];

function notifyEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED: "true",
    SA360_DELIVERY_SUCCESS_NOTIFY_TO: STAFF_LIST,
    ...extra,
  };
}

function recordingMailer(calls: SentMail[]) {
  return async (input: SendTransactionalEmailInput) => {
    calls.push({ to: input.to, text: input.text, idempotencyKey: input.idempotencyKey });
    return { ok: true as const, id: "email_1" };
  };
}

function assertClientMail(call: SentMail, clientAccountId: string, sourceLeadEventId: string) {
  assert.equal(call.to, RECIPIENT);
  assert.equal(Array.isArray(call.to), false);
  assert.equal(call.idempotencyKey, `client_lead:${clientAccountId}:${sourceLeadEventId}`);
  assert.equal(call.text.includes("@"), false);
  assert.equal(call.text.includes("http"), false);
  assert.equal(call.text.includes(STAFF_LIST), false);
  assert.equal(call.text.includes(RECIPIENT), false);
}

describe("canonical delivery notification scan", { concurrency: false }, () => {
  before(async () => {
    dbA = newClient();
    dbB = newClient();
    await dbA.$queryRaw`SELECT 1`;
  });

  after(async () => {
    if (clientIds.length > 0) {
      await dbA.deliverySuccessNotification
        .deleteMany({ where: { clientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      await dbA.ghlAssociationDispatchOutbox
        .deleteMany({ where: { clientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      await dbA.leadDeliveryPlan
        .deleteMany({ where: { destinationClientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      await dbA.companySheetsDispatchIntent
        .deleteMany({ where: { clientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      await dbA.companySheetsDeliveryJob
        .deleteMany({ where: { clientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      await dbA.companySheetsDestination
        .deleteMany({ where: { clientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      if (connectionKeys.length > 0) {
        await dbA.companyGoogleConnection
          .deleteMany({ where: { connectionKey: { in: connectionKeys } } })
          .catch(() => undefined);
      }
      await dbA.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    }
    await dbA.$disconnect().catch(() => undefined);
    await dbB.$disconnect().catch(() => undefined);
  });

  async function createClient(label: string): Promise<string> {
    const clientAccountId = `scan_${label}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 6)}`;
    await dbA.clientAccount.create({
      data: { clientAccountId, clientDisplayName: "Scan test", status: "onboarding" },
    });
    clientIds.push(clientAccountId);
    return clientAccountId;
  }

  async function enablePreference(clientAccountId: string, enabledAt = ENABLED_AT) {
    const saved = await saveDeliveryNotificationRecipient(dbA, {
      clientAccountId,
      recipientEmail: RECIPIENT,
    });
    assert.equal(saved.ok, true);
    const enabled = await setDeliveryNotificationEnabled(dbA, { clientAccountId, enabled: true });
    assert.equal(enabled.ok, true);
    await dbA.clientDeliveryNotificationPreference.update({
      where: { clientAccountId },
      data: { enabledAt },
    });
  }

  async function armSheets(
    clientAccountId: string,
    options?: { enabled?: boolean; notBefore?: Date | null }
  ) {
    const connectionKey = `conn_${clientAccountId}`;
    connectionKeys.push(connectionKey);
    const connection = await dbA.companyGoogleConnection.create({ data: { connectionKey } });
    const destination = await dbA.companySheetsDestination.create({
      data: {
        clientAccountId,
        companyConnectionId: connection.id,
        spreadsheetId: `sheet_${clientAccountId}`,
        spreadsheetUrl: "https://docs.example.test/sheet",
        worksheetId: 1,
        worksheetTitle: "Campaign",
        controlBasis: "company_created",
        sharingStatus: "missing_recipient",
        campaignDispatchEnabled: options?.enabled ?? true,
        campaignDispatchNotBefore: options && "notBefore" in options ? options.notBefore : CUTOFF,
      },
    });
    return { connection, destination };
  }

  async function addSheetsJob(input: {
    clientAccountId: string;
    connectionId: string;
    destinationId: string;
    spreadsheetId: string;
    sourceLeadEventId: string;
    kind?: string;
    status?: string;
    finishedAt?: Date | null;
    appendStartedAt?: Date | null;
    idempotencyKey?: string;
    rowStatus?: string;
    intent?: boolean;
  }) {
    const job = await dbA.companySheetsDeliveryJob.create({
      data: {
        kind: input.kind ?? "lead",
        status: input.status ?? "succeeded",
        clientAccountId: input.clientAccountId,
        companyConnectionId: input.connectionId,
        destinationId: input.destinationId,
        spreadsheetId: input.spreadsheetId,
        spreadsheetUrl: "https://docs.example.test/sheet",
        worksheetId: 1,
        worksheetTitle: "Campaign",
        controlBasis: "company_created",
        destinationUpdatedAt: INTENT_AT,
        headerContract: [],
        sourceLeadEventId: input.sourceLeadEventId,
        idempotencyKey: input.idempotencyKey ?? `sheets_${input.clientAccountId}_${input.sourceLeadEventId}`,
        rowsTotal: 1,
        rowsWritten: 1,
        appendStartedAt: input.appendStartedAt ?? null,
        finishedAt: input.finishedAt === undefined ? FINISHED : input.finishedAt,
        rows: {
          create: {
            spreadsheetId: input.spreadsheetId,
            worksheetId: 1,
            stableRowId: `row_${input.clientAccountId}_${input.sourceLeadEventId}`,
            ordinal: 1,
            valuesJson: { delivery_row_id: "row" },
            status: input.rowStatus ?? "written",
          },
        },
      },
    });
    if (input.intent !== false) {
      await dbA.companySheetsDispatchIntent.create({
        data: {
          idempotencyKey: `intent_${input.clientAccountId}_${input.sourceLeadEventId}`,
          kind: "campaign_lead",
          status: "completed",
          clientAccountId: input.clientAccountId,
          sourceLeadEventId: input.sourceLeadEventId,
          jobId: job.id,
          createdAt: INTENT_AT,
        },
      });
    }
    return job;
  }

  async function armGhl(
    clientAccountId: string,
    options?: {
      live?: boolean;
      workflowStartRequired?: boolean;
      opportunityCreationEnabled?: boolean;
      notesEnabled?: boolean;
      profileNotes?: boolean;
    }
  ) {
    const locationId = `loc_${clientAccountId}`;
    const live = options?.live !== false;
    await dbA.clientGhlDestination.create({
      data: {
        clientAccountId,
        destinationSubaccountIdGhl: locationId,
        deliveryEnabled: live,
        deliveryMode: live ? "live" : "shadow",
        clientCutoverApproved: live,
        internalApprovalStatus: live ? "approved" : "not_reviewed",
        workflowStartRequired: options?.workflowStartRequired ?? true,
        opportunityCreationEnabled: options?.opportunityCreationEnabled ?? false,
        sourceEnrichmentPolicyJson: { intakeSummaryNotesEnabled: options?.notesEnabled === true },
      },
    });
    if (options?.profileNotes) {
      await dbA.clientOnboardingDestinationProfile.create({
        data: {
          clientAccountId,
          ghlMode: "location_api",
          notesEnabled: true,
          notesContractVersion: "sa360_lead_note_v2",
          sheetsSelected: true,
        },
      });
    }
    return locationId;
  }

  function ghlSteps(input: {
    leadId: string;
    ownerSkipped?: boolean;
    workflow?: "enrolled" | "skipped" | "absent";
    notes?: boolean;
  }): Prisma.GhlLiveDeliveryStepRunCreateWithoutLiveRunInput[] {
    const workflow = input.workflow ?? "enrolled";
    const steps: Prisma.GhlLiveDeliveryStepRunCreateWithoutLiveRunInput[] = [
      {
        stepOrder: 1,
        stepType: "create_or_update_contact",
        status: "succeeded",
        externalId: "contact_1",
        responseRedactedJson: {
          externalCallExecuted: true,
          vetOperationReceipt: {
            operation: "contact",
            outcome: "completed",
            externalId: "contact_1",
            httpStatus: 200,
            idempotencyKey: `assoc_${input.leadId}_contact`,
          },
        },
      },
      {
        stepOrder: 2,
        stepType: "add_tags",
        status: "succeeded",
        responseRedactedJson: {
          externalCallExecuted: true,
          vetOperationReceipt: {
            operation: "tags",
            outcome: "completed",
            externalId: null,
            httpStatus: 200,
            idempotencyKey: `assoc_${input.leadId}_tags`,
          },
        },
      },
    ];
    if (input.ownerSkipped) {
      steps.push({
        stepOrder: 3,
        stepType: "assign_owner",
        status: "skipped",
        externalId: "contact_1",
        responseRedactedJson: { externalCallExecuted: false, assignedTo: "user_existing" },
      });
    }
    if (input.notes) {
      steps.push({
        stepOrder: 4,
        stepType: "write_intake_summary_note",
        status: "succeeded",
        externalId: "note_1",
        responseRedactedJson: {
          externalCallExecuted: true,
          vetOperationReceipt: {
            operation: "note",
            outcome: "completed",
            externalId: "note_1",
            httpStatus: 200,
            idempotencyKey: `assoc_${input.leadId}_note`,
          },
        },
      });
    }
    if (workflow === "enrolled") {
      steps.push({
        stepOrder: 5,
        stepType: "start_workflow",
        status: "succeeded",
        externalId: "contact_1",
        responseRedactedJson: {
          externalCallExecuted: true,
          vetOperationReceipt: {
            operation: "workflow",
            outcome: "completed",
            externalId: "contact_1",
            httpStatus: 200,
            idempotencyKey: `assoc_${input.leadId}_workflow`,
          },
        },
      });
    } else if (workflow === "skipped") {
      steps.push({
        stepOrder: 5,
        stepType: "start_workflow",
        status: "skipped",
        responseRedactedJson: {
          externalCallExecuted: false,
          vetOperationReceipt: {
            operation: "workflow",
            outcome: "skipped",
            externalId: null,
            httpStatus: null,
            idempotencyKey: `assoc_${input.leadId}_workflow`,
          },
        },
      });
    }
    return steps;
  }

  async function addGhlRun(input: {
    clientAccountId: string;
    locationId: string;
    sourceLeadEventId: string;
    status?: string;
    mode?: string;
    completedAt?: Date | null;
    steps: Prisma.GhlLiveDeliveryStepRunCreateWithoutLiveRunInput[];
    outboxStatus?: string;
    idempotencyKey?: string;
  }) {
    const plan = await dbA.leadDeliveryPlan.create({
      data: {
        masterClientAccountId: input.clientAccountId,
        destinationClientAccountId: input.clientAccountId,
        destinationSubaccountIdGhl: input.locationId,
      },
    });
    const run = await dbA.ghlLiveDeliveryRun.create({
      data: {
        leadDeliveryPlanId: plan.id,
        masterClientAccountId: input.clientAccountId,
        destinationClientAccountId: input.clientAccountId,
        destinationSubaccountIdGhl: input.locationId,
        mode: input.mode ?? "ongoing_association",
        status: input.status ?? "succeeded",
        idempotencyKey: input.idempotencyKey ?? `ghl_${input.clientAccountId}_${input.sourceLeadEventId}`,
        completedAt: input.completedAt === undefined ? COMPLETED : input.completedAt,
        stepRuns: { create: input.steps },
      },
    });
    await dbA.ghlAssociationDispatchOutbox.create({
      data: {
        idempotencyKey: `outbox_${input.clientAccountId}_${input.sourceLeadEventId}`,
        status: input.outboxStatus ?? "settled",
        clientAccountId: input.clientAccountId,
        sourceLeadEventId: input.sourceLeadEventId,
        destinationLocationIdGhl: input.locationId,
        liveRunId: run.id,
        externalCallExecuted: true,
        lastError: null,
        availableAt: COMPLETED,
      },
    });
    return run;
  }

  async function notificationCount(clientAccountId: string) {
    return dbA.deliverySuccessNotification.count({ where: { clientAccountId } });
  }

  test("scanner source does not call providers, staff lists, or the other notifiers", () => {
    const source = readFileSync(new URL("./scan.ts", import.meta.url), "utf8");
    for (const token of [
      "findProductionGhlReceipt",
      "notifyCustomerDeliveryReleased",
      "notifySupportTicketCreated",
      "SA360_DELIVERY_SUCCESS_NOTIFY_TO",
      "node:http",
      "fetch(",
    ]) {
      assert.equal(source.includes(token), false, token);
    }
  });

  test("global flag off performs no database query and no send", async () => {
    for (const value of [undefined, "", "TRUE", "1", "yes", "on", "false"]) {
      let queries = 0;
      const db = new Proxy(
        {},
        {
          get() {
            queries += 1;
            throw new Error("database queried");
          },
        }
      ) as PrismaClient;
      let sends = 0;
      const env =
        value === undefined ? {} : { SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED: value };
      const result = await scanCanonicalDeliveryNotifications({
        db,
        env,
        send: async () => {
          sends += 1;
          return { ok: true, id: "email_should_not_send" };
        },
      });
      assert.equal(result.enabled, false);
      assert.equal(result.queried, false);
      assert.equal(result.sent, 0);
      assert.equal(queries, 0);
      assert.equal(sends, 0);
    }
  });

  test("client preference off produces no notification", async () => {
    const clientAccountId = await createClient("pref-off");
    const sheets = await armSheets(clientAccountId);
    await saveDeliveryNotificationRecipient(dbA, { clientAccountId, recipientEmail: RECIPIENT });
    await addSheetsJob({
      clientAccountId,
      connectionId: sheets.connection.id,
      destinationId: sheets.destination.id,
      spreadsheetId: sheets.destination.spreadsheetId,
      sourceLeadEventId: "lead_pref_off",
    });
    const calls: SentMail[] = [];
    await scanCanonicalDeliveryNotifications({
      db: dbA,
      env: notifyEnv(),
      now: SCAN_NOW,
      send: recordingMailer(calls),
    });
    assert.equal(await notificationCount(clientAccountId), 0);
    assert.equal(calls.length, 0);
  });

  test("unverified recipient produces no notification", async () => {
    const clientAccountId = await createClient("unverified");
    const sheets = await armSheets(clientAccountId);
    await dbA.clientDeliveryNotificationPreference.create({
      data: {
        clientAccountId,
        enabled: false,
        recipientEmail: RECIPIENT,
        recipientEmailVerifiedAt: null,
      },
    });
    await addSheetsJob({
      clientAccountId,
      connectionId: sheets.connection.id,
      destinationId: sheets.destination.id,
      spreadsheetId: sheets.destination.spreadsheetId,
      sourceLeadEventId: "lead_unverified",
    });
    const calls: SentMail[] = [];
    await scanCanonicalDeliveryNotifications({
      db: dbA,
      env: notifyEnv(),
      now: SCAN_NOW,
      send: recordingMailer(calls),
    });
    assert.equal(await notificationCount(clientAccountId), 0);
    assert.equal(calls.length, 0);
  });

  test("no armed destinations produces no notification", async () => {
    const clientAccountId = await createClient("unarmed");
    await enablePreference(clientAccountId);
    const sheets = await armSheets(clientAccountId, { enabled: false, notBefore: CUTOFF });
    await armGhl(clientAccountId, { live: false, profileNotes: true });
    await addSheetsJob({
      clientAccountId,
      connectionId: sheets.connection.id,
      destinationId: sheets.destination.id,
      spreadsheetId: sheets.destination.spreadsheetId,
      sourceLeadEventId: "lead_unarmed",
    });
    const calls: SentMail[] = [];
    await scanCanonicalDeliveryNotifications({
      db: dbA,
      env: notifyEnv(),
      now: SCAN_NOW,
      send: recordingMailer(calls),
    });
    assert.equal(await notificationCount(clientAccountId), 0);
    assert.equal(calls.length, 0);
  });

  test("a sheets-only delivered lead produces one notification", async () => {
    const clientAccountId = await createClient("sheets");
    await enablePreference(clientAccountId);
    const sheets = await armSheets(clientAccountId);
    const job = await addSheetsJob({
      clientAccountId,
      connectionId: sheets.connection.id,
      destinationId: sheets.destination.id,
      spreadsheetId: sheets.destination.spreadsheetId,
      sourceLeadEventId: "lead_sheets",
    });
    const calls: SentMail[] = [];
    const result = await scanCanonicalDeliveryNotifications({
      db: dbA,
      env: notifyEnv(),
      now: SCAN_NOW,
      send: recordingMailer(calls),
    });
    assert.equal(result.sent, 1);
    assert.equal(calls.length, 1);
    assertClientMail(calls[0]!, clientAccountId, "lead_sheets");
    const rows = await dbA.deliverySuccessNotification.findMany({ where: { clientAccountId } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sheetsJobId, job.id);
    assert.equal(rows[0]?.ghlLiveRunId, null);
    assert.equal(rows[0]?.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent);
    assert.equal(rows[0]?.sentAt?.toISOString(), SCAN_NOW.toISOString());
  });

  test("a ghl-only delivered lead produces one notification", async () => {
    const clientAccountId = await createClient("ghl");
    await enablePreference(clientAccountId);
    const locationId = await armGhl(clientAccountId, { profileNotes: true, notesEnabled: false });
    const run = await addGhlRun({
      clientAccountId,
      locationId,
      sourceLeadEventId: "lead_ghl",
      steps: ghlSteps({ leadId: "lead_ghl", workflow: "enrolled", notes: false }),
    });
    const calls: SentMail[] = [];
    await scanCanonicalDeliveryNotifications({
      db: dbA,
      env: notifyEnv(),
      now: SCAN_NOW,
      send: recordingMailer(calls),
    });
    assert.equal(calls.length, 1);
    assertClientMail(calls[0]!, clientAccountId, "lead_ghl");
    const row = await dbA.deliverySuccessNotification.findUniqueOrThrow({
      where: { idempotencyKey: `client_lead:${clientAccountId}:lead_ghl` },
    });
    assert.equal(row.ghlLiveRunId, run.id);
    assert.equal(row.sheetsJobId, null);
    assert.equal(row.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent);
  });

  test("both destinations armed and one still pending produces no notification", async () => {
    const clientAccountId = await createClient("pending");
    await enablePreference(clientAccountId);
    const sheets = await armSheets(clientAccountId);
    const locationId = await armGhl(clientAccountId);
    await addSheetsJob({
      clientAccountId,
      connectionId: sheets.connection.id,
      destinationId: sheets.destination.id,
      spreadsheetId: sheets.destination.spreadsheetId,
      sourceLeadEventId: "lead_pending",
    });
    await addGhlRun({
      clientAccountId,
      locationId,
      sourceLeadEventId: "lead_pending",
      status: "executing",
      completedAt: null,
      outboxStatus: "executing",
      steps: ghlSteps({ leadId: "lead_pending" }),
    });
    const calls: SentMail[] = [];
    await scanCanonicalDeliveryNotifications({
      db: dbA,
      env: notifyEnv(),
      now: SCAN_NOW,
      send: recordingMailer(calls),
    });
    assert.equal(await notificationCount(clientAccountId), 0);
    assert.equal(calls.length, 0);
  });

  test("ghl and sheets both complete produce one row and one mailer call", async () => {
    const clientAccountId = await createClient("both");
    await enablePreference(clientAccountId);
    const sheets = await armSheets(clientAccountId);
    const locationId = await armGhl(clientAccountId);
    const job = await addSheetsJob({
      clientAccountId,
      connectionId: sheets.connection.id,
      destinationId: sheets.destination.id,
      spreadsheetId: sheets.destination.spreadsheetId,
      sourceLeadEventId: "lead_both",
    });
    const run = await addGhlRun({
      clientAccountId,
      locationId,
      sourceLeadEventId: "lead_both",
      steps: ghlSteps({ leadId: "lead_both" }),
    });
    const calls: SentMail[] = [];
    await scanCanonicalDeliveryNotifications({
      db: dbA,
      env: notifyEnv(),
      now: SCAN_NOW,
      send: recordingMailer(calls),
    });
    assert.equal(calls.length, 1);
    assertClientMail(calls[0]!, clientAccountId, "lead_both");
    const rows = await dbA.deliverySuccessNotification.findMany({ where: { clientAccountId } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sheetsJobId, job.id);
    assert.equal(rows[0]?.ghlLiveRunId, run.id);
    assert.equal(rows[0]?.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent);
    assert.equal(rows[0]?.attemptCount, 1);
  });

  test("partial ghl success with a skipped owner step is accepted", async () => {
    const clientAccountId = await createClient("owner");
    await enablePreference(clientAccountId);
    const locationId = await armGhl(clientAccountId, {
      workflowStartRequired: true,
      opportunityCreationEnabled: false,
      notesEnabled: false,
      profileNotes: true,
    });
    const run = await addGhlRun({
      clientAccountId,
      locationId,
      sourceLeadEventId: "lead_owner",
      status: "partial_success",
      steps: ghlSteps({ leadId: "lead_owner", ownerSkipped: true, workflow: "enrolled", notes: false }),
    });
    const calls: SentMail[] = [];
    await scanCanonicalDeliveryNotifications({
      db: dbA,
      env: notifyEnv(),
      now: SCAN_NOW,
      send: recordingMailer(calls),
    });
    assert.equal(calls.length, 1);
    const row = await dbA.deliverySuccessNotification.findUniqueOrThrow({
      where: { idempotencyKey: `client_lead:${clientAccountId}:lead_owner` },
    });
    assert.equal(row.ghlLiveRunId, run.id);
    assert.equal(row.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent);
  });

  test("a failed required ghl workflow is rejected", async () => {
    const clientAccountId = await createClient("workflow");
    await enablePreference(clientAccountId);
    const locationId = await armGhl(clientAccountId, { workflowStartRequired: true });
    await addGhlRun({
      clientAccountId,
      locationId,
      sourceLeadEventId: "lead_workflow",
      status: "partial_success",
      steps: ghlSteps({ leadId: "lead_workflow", workflow: "skipped" }),
    });
    const calls: SentMail[] = [];
    await scanCanonicalDeliveryNotifications({
      db: dbA,
      env: notifyEnv(),
      now: SCAN_NOW,
      send: recordingMailer(calls),
    });
    assert.equal(await notificationCount(clientAccountId), 0);
    assert.equal(calls.length, 0);
  });

  test("uncertain sheets delivery is rejected", async () => {
    const clientAccountId = await createClient("uncertain");
    await enablePreference(clientAccountId);
    const sheets = await armSheets(clientAccountId);
    await addSheetsJob({
      clientAccountId,
      connectionId: sheets.connection.id,
      destinationId: sheets.destination.id,
      spreadsheetId: sheets.destination.spreadsheetId,
      sourceLeadEventId: "lead_uncertain",
      status: "uncertain",
      appendStartedAt: FINISHED,
      finishedAt: FINISHED,
    });
    const calls: SentMail[] = [];
    await scanCanonicalDeliveryNotifications({
      db: dbA,
      env: notifyEnv(),
      now: SCAN_NOW,
      send: recordingMailer(calls),
    });
    assert.equal(await notificationCount(clientAccountId), 0);
    assert.equal(calls.length, 0);
  });

  test("onboarding tests, canaries, and aged release are rejected", async () => {
    const sheetsClient = await createClient("excluded-sheets");
    await enablePreference(sheetsClient);
    const sheets = await armSheets(sheetsClient);
    const sheetBase = {
      clientAccountId: sheetsClient,
      connectionId: sheets.connection.id,
      destinationId: sheets.destination.id,
      spreadsheetId: sheets.destination.spreadsheetId,
    };
    await addSheetsJob({
      ...sheetBase,
      sourceLeadEventId: "lead_onboarding",
      idempotencyKey: `onboarding-test:${sheetsClient}:sheets`,
    });
    await addSheetsJob({
      ...sheetBase,
      sourceLeadEventId: "lead_canary",
      kind: "canary",
    });
    await addSheetsJob({
      ...sheetBase,
      sourceLeadEventId: "lead_aged",
      kind: "aged_release",
    });

    const ghlClient = await createClient("excluded-ghl");
    await enablePreference(ghlClient);
    const locationId = await armGhl(ghlClient);
    await addGhlRun({
      clientAccountId: ghlClient,
      locationId,
      sourceLeadEventId: "lead_canary_ghl",
      mode: "live_canary",
      steps: ghlSteps({ leadId: "lead_canary_ghl" }),
    });
    await addGhlRun({
      clientAccountId: ghlClient,
      locationId,
      sourceLeadEventId: "lead_location_api",
      mode: "location_api",
      steps: ghlSteps({ leadId: "lead_location_api" }),
    });

    const calls: SentMail[] = [];
    await scanCanonicalDeliveryNotifications({
      db: dbA,
      env: notifyEnv(),
      now: SCAN_NOW,
      send: recordingMailer(calls),
    });
    assert.equal(await notificationCount(sheetsClient), 0);
    assert.equal(await notificationCount(ghlClient), 0);
    assert.equal(calls.length, 0);
  });

  test("completion at enabledAt is rejected", async () => {
    const clientAccountId = await createClient("clock");
    await enablePreference(clientAccountId);
    const sheets = await armSheets(clientAccountId);
    await addSheetsJob({
      clientAccountId,
      connectionId: sheets.connection.id,
      destinationId: sheets.destination.id,
      spreadsheetId: sheets.destination.spreadsheetId,
      sourceLeadEventId: "lead_clock",
      finishedAt: ENABLED_AT,
    });
    const calls: SentMail[] = [];
    await scanCanonicalDeliveryNotifications({
      db: dbA,
      env: notifyEnv(),
      now: SCAN_NOW,
      send: recordingMailer(calls),
    });
    assert.equal(await notificationCount(clientAccountId), 0);
    assert.equal(calls.length, 0);
  });

  test("two concurrent scans cannot both claim the same notification", async () => {
    const clientAccountId = await createClient("claim-race");
    await enablePreference(clientAccountId);
    const sheets = await armSheets(clientAccountId);
    await addSheetsJob({
      clientAccountId,
      connectionId: sheets.connection.id,
      destinationId: sheets.destination.id,
      spreadsheetId: sheets.destination.spreadsheetId,
      sourceLeadEventId: "lead_claim",
    });
    const calls: SentMail[] = [];
    const send = recordingMailer(calls);
    await Promise.all([
      scanCanonicalDeliveryNotifications({ db: dbA, env: notifyEnv(), now: SCAN_NOW, send }),
      scanCanonicalDeliveryNotifications({ db: dbB, env: notifyEnv(), now: SCAN_NOW, send }),
    ]);
    assert.equal(calls.length, 1);
    assertClientMail(calls[0]!, clientAccountId, "lead_claim");
    const rows = await dbA.deliverySuccessNotification.findMany({ where: { clientAccountId } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent);
    assert.equal(rows[0]?.attemptCount, 1);
  });

  test("a repeated scan after sent does not resend", async () => {
    const clientAccountId = await createClient("resend");
    await enablePreference(clientAccountId);
    const sheets = await armSheets(clientAccountId);
    await addSheetsJob({
      clientAccountId,
      connectionId: sheets.connection.id,
      destinationId: sheets.destination.id,
      spreadsheetId: sheets.destination.spreadsheetId,
      sourceLeadEventId: "lead_resend",
    });
    const calls: SentMail[] = [];
    const send = recordingMailer(calls);
    await scanCanonicalDeliveryNotifications({ db: dbA, env: notifyEnv(), now: SCAN_NOW, send });
    await scanCanonicalDeliveryNotifications({ db: dbA, env: notifyEnv(), now: SCAN_NOW, send });
    assert.equal(calls.length, 1);
    const row = await dbA.deliverySuccessNotification.findUniqueOrThrow({
      where: { idempotencyKey: `client_lead:${clientAccountId}:lead_resend` },
    });
    assert.equal(row.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent);
    assert.equal(row.attemptCount, 1);
  });

  test("concurrent sheets and ghl evidence stays intact and sends once", async () => {
    const clientAccountId = await createClient("evidence");
    await enablePreference(clientAccountId);
    const sheets = await armSheets(clientAccountId);
    const locationId = await armGhl(clientAccountId);
    const job = await addSheetsJob({
      clientAccountId,
      connectionId: sheets.connection.id,
      destinationId: sheets.destination.id,
      spreadsheetId: sheets.destination.spreadsheetId,
      sourceLeadEventId: "lead_evidence",
    });
    const calls: SentMail[] = [];
    const send = recordingMailer(calls);
    await scanCanonicalDeliveryNotifications({ db: dbA, env: notifyEnv(), now: SCAN_NOW, send });
    assert.equal(await notificationCount(clientAccountId), 0);
    assert.equal(calls.length, 0);

    const run = await addGhlRun({
      clientAccountId,
      locationId,
      sourceLeadEventId: "lead_evidence",
      steps: ghlSteps({ leadId: "lead_evidence" }),
    });
    await Promise.all([
      recordDeliverySuccessNotification(dbA, {
        clientAccountId,
        sourceLeadEventId: "lead_evidence",
        sheetsJobId: job.id,
      }),
      recordDeliverySuccessNotification(dbB, {
        clientAccountId,
        sourceLeadEventId: "lead_evidence",
        ghlLiveRunId: run.id,
      }),
    ]);
    const pending = await dbA.deliverySuccessNotification.findMany({
      where: { clientAccountId, sourceLeadEventId: "lead_evidence" },
    });
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.sheetsJobId, job.id);
    assert.equal(pending[0]?.ghlLiveRunId, run.id);
    assert.equal(pending[0]?.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.pending);
    assert.equal(calls.length, 0);

    await scanCanonicalDeliveryNotifications({ db: dbA, env: notifyEnv(), now: SCAN_NOW, send });
    assert.equal(calls.length, 1);
    assertClientMail(calls[0]!, clientAccountId, "lead_evidence");
    await scanCanonicalDeliveryNotifications({ db: dbA, env: notifyEnv(), now: SCAN_NOW, send });
    assert.equal(calls.length, 1);

    await Promise.all([
      recordDeliverySuccessNotification(dbA, {
        clientAccountId,
        sourceLeadEventId: "lead_evidence",
        sheetsJobId: "job_replacement",
      }),
      recordDeliverySuccessNotification(dbB, {
        clientAccountId,
        sourceLeadEventId: "lead_evidence",
        ghlLiveRunId: "run_replacement",
      }),
    ]);
    const stored = await dbA.deliverySuccessNotification.findUniqueOrThrow({
      where: { idempotencyKey: `client_lead:${clientAccountId}:lead_evidence` },
    });
    assert.equal(stored.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent);
    assert.equal(stored.sheetsJobId, job.id);
    assert.equal(stored.ghlLiveRunId, run.id);
    assert.equal(stored.attemptCount, 1);
    assert.equal(stored.sentAt?.toISOString(), SCAN_NOW.toISOString());
    const jobAfter = await dbA.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: job.id } });
    const runAfter = await dbA.ghlLiveDeliveryRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(jobAfter.status, "succeeded");
    assert.equal(runAfter.status, "succeeded");
  });

  test("email failure marks the notification failed and leaves delivery receipts unchanged", async () => {
    const clientAccountId = await createClient("mail-fail");
    await enablePreference(clientAccountId);
    const sheets = await armSheets(clientAccountId);
    const locationId = await armGhl(clientAccountId);
    const job = await addSheetsJob({
      clientAccountId,
      connectionId: sheets.connection.id,
      destinationId: sheets.destination.id,
      spreadsheetId: sheets.destination.spreadsheetId,
      sourceLeadEventId: "lead_fail",
    });
    const run = await addGhlRun({
      clientAccountId,
      locationId,
      sourceLeadEventId: "lead_fail",
      steps: ghlSteps({ leadId: "lead_fail" }),
    });
    const result = await scanCanonicalDeliveryNotifications({
      db: dbA,
      env: notifyEnv(),
      now: SCAN_NOW,
      send: async () => ({ ok: false, error: "mail down" }),
    });
    assert.equal(result.failed, 1);
    assert.equal(result.sent, 0);
    const row = await dbA.deliverySuccessNotification.findUniqueOrThrow({
      where: { idempotencyKey: `client_lead:${clientAccountId}:lead_fail` },
    });
    assert.equal(row.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.failed);
    assert.equal(row.sheetsJobId, job.id);
    assert.equal(row.ghlLiveRunId, run.id);
    assert.equal(row.sentAt, null);
    const jobAfter = await dbA.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: job.id } });
    const runAfter = await dbA.ghlLiveDeliveryRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(jobAfter.status, "succeeded");
    assert.equal(runAfter.status, "succeeded");
  });

  test("an armed custom webhook without a receipt blocks notification", async () => {
    const clientAccountId = await createClient("webhook-armed");
    await enablePreference(clientAccountId);
    const sheets = await armSheets(clientAccountId);
    await addSheetsJob({
      clientAccountId,
      connectionId: sheets.connection.id,
      destinationId: sheets.destination.id,
      spreadsheetId: sheets.destination.spreadsheetId,
      sourceLeadEventId: "lead_webhook",
    });
    await dbA.clientCustomWebhookDestination.create({
      data: {
        clientAccountId,
        endpointUrl: "https://user:secret@hooks.example.test/lead?token=abc",
        signingSecretCiphertext: "ciphertext-not-used",
        signingSecretFingerprint: "abcdabcdabcdabcd",
        enabled: true,
      },
    });
    const calls: SentMail[] = [];
    const env = notifyEnv({ SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED: "true" });
    const hook = await dbA.clientCustomWebhookDestination.findUnique({ where: { clientAccountId } });
    assert.equal(isCustomWebhookDeliveryEnabled(env), true);
    assert.equal(hook?.enabled, true);
    await scanCanonicalDeliveryNotifications({
      db: dbA,
      env,
      now: SCAN_NOW,
      send: recordingMailer(calls),
    });
    assert.equal(await notificationCount(clientAccountId), 0);
    assert.equal(
      calls.filter((call) => call.idempotencyKey?.includes(clientAccountId)).length,
      0
    );
  });
});
