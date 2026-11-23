/**
 * Campaign Sheets recovery proof. Local sa360_test only. The writer is an
 * in-memory sheet. No live Google call, and no delivery flag is changed.
 *
 * The routing transaction in source-intake-routing-persist.ts commits the
 * lead update and recordCompanySheetsCampaignIntent together. The worker
 * posts to /admin/v1/company-sheets/internal/process-dispatch, which calls
 * processDueCompanySheetsDispatches. That drain is the recovery path.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";
import { COMPANY_SHEETS_EXECUTION_LEASE_MS } from "@sa360/shared";

import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
  COMPANY_SHEETS_LEAD_HEADER,
} from "../../lib/company-google-sheets-env.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { canonicalCompanySheetsDelivery } from "../delivery-success/canonical-delivery.js";
import { evaluateDeliveryHealth } from "../delivery-health/rules.js";
import type { CompanySheetsDeliveryDeps } from "../company-sheets-delivery/company-sheets-delivery.service.js";
import { recordCompanySheetsCampaignIntent } from "./company-sheets-dispatch-record.js";
import {
  getCompanySheetsDispatchStatus,
  processDueCompanySheetsDispatches,
  setCompanySheetsDispatchActivation,
} from "./company-sheets-dispatch.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const EMAIL = "campaign-recovery@lifeagentlaunch.test";
const scopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

class MemorySheet {
  rows: string[][] = [];
  appends: string[][][] = [];
  calls = 0;
  hangAfterRecord: Promise<void> | null = null;
  onAppendRecorded: (() => void) | null = null;

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    this.calls += 1;
    if (url.includes("USER_ENTERED") || url.includes("/permissions") || url.includes("type=anyone")) {
      throw new Error(`refused Google call ${url}`);
    }
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    if (method === "PUT") {
      const parsed = JSON.parse(body ?? "{}") as { values?: string[][] };
      this.rows[0] = parsed.values?.[0] ?? [];
      return json(200, {});
    }
    if (method === "POST") {
      const parsed = JSON.parse(body ?? "{}") as { values?: string[][] };
      const values = parsed.values ?? [];
      this.appends.push(values);
      for (const row of values) this.rows.push(row);
      this.onAppendRecorded?.();
      if (this.hangAfterRecord) await this.hangAfterRecord;
      return json(200, {});
    }
    const decoded = decodeURIComponent(url);
    if (decoded.includes("A1:ZZ2")) return json(200, { values: this.rows.slice(0, 2) });
    if (decoded.includes("!A1:A")) return json(200, { values: this.rows.map((row) => [row[0] ?? ""]) });
    return json(200, { values: [] });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}`;
}

function leadRowsAppended(sheet: MemorySheet): number {
  return sheet.appends.reduce(
    (count, batch) => count + batch.filter((row) => row[0]?.startsWith("lead:")).length,
    0
  );
}

describe("campaign sheets delivery recovery (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const clientId = `cs_recover_${suffix}`;
  const spreadsheetId = `sheetRecover${suffix}`;
  const sheet = new MemorySheet();
  const leadIds: string[] = [];
  let connectionId = "";
  let destinationId = "";

  function envFor(dispatch: boolean, execution: boolean): NodeJS.ProcessEnv {
    return {
      ...process.env,
      SA360_COMPANY_GOOGLE_SHEETS_ENABLED: "true",
      SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: dispatch ? "true" : "false",
      SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: execution ? "true" : "false",
    };
  }

  function deps(dispatch: boolean, execution: boolean): CompanySheetsDeliveryDeps {
    const env = envFor(dispatch, execution);
    const fetchImpl: typeof fetch = async (input, init) => sheet.fetch(String(input), init);
    return {
      env,
      db,
      now: () => new Date(),
      fetchImpl,
      getAccessToken: async () => ({
        ok: true,
        accessToken: "ya29.recovery-test",
        connectionId,
        tokenVersion: 1,
        googleEmail: EMAIL,
      }),
      getMetadata: async () => ({
        ok: true as const,
        metadata: {
          spreadsheetId,
          title: "Recovery",
          spreadsheetUrl: sheetUrl(spreadsheetId),
          worksheets: [{ sheetId: 0, title: "Campaign Leads", index: 0, hidden: false, sheetType: "GRID" }],
        },
      }),
      getDriveFile: async (input: { fileId: string }) => ({
        ok: true as const,
        file: {
          id: input.fileId,
          name: "Recovery",
          mimeType: "application/vnd.google-apps.spreadsheet",
          ownedByMe: true,
          ownerEmails: [EMAIL],
          driveId: null,
          parents: [],
          capabilities: { canEdit: true, canAddChildren: null },
          trashed: false,
          shortcutTargetId: null,
        },
      }),
    };
  }

  async function resetSheet() {
    sheet.rows = [];
    sheet.appends = [];
    sheet.calls = 0;
    sheet.hangAfterRecord = null;
    sheet.onAppendRecorded = null;
    await db.clientSheetsPersonAdmission.deleteMany({ where: { clientAccountId: clientId } });
    await db.clientSheetsDedupeDecision.deleteMany({ where: { clientAccountId: clientId } });
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: clientId } });
    await db.companySheetsDispatchIntent.deleteMany({ where: { clientAccountId: clientId } });
    await db.companySheetsWorksheetLock.deleteMany({ where: { spreadsheetId } });
    await db.clientAccount.update({ where: { clientAccountId: clientId }, data: { status: "active" } });
    await db.companySheetsDestination.update({
      where: { id: destinationId },
      data: { campaignDispatchEnabled: false },
    });
  }

  async function arm() {
    const activated = await setCompanySheetsDispatchActivation(
      clientId,
      { campaignEnabled: true },
      { db, now: () => new Date("2026-07-01T00:00:00.000Z") }
    );
    assert.equal(activated.ok, true);
  }

  async function commitLead(phone: string) {
    const lead = await db.sourceLeadEvent.create({
      data: {
        sourceLeadUid: `uid_${suffix}_${leadIds.length}_${Math.random().toString(16).slice(2)}`,
        sourceProvider: "manual_import",
        sourceSystem: "external_vendor",
        sourceType: "manual_entry",
        rawPayloadJson: { untouched: true },
        clientAccountIdResolved: clientId,
        status: "received",
        normalizedPayloadJson: {
          first_name: "Ada",
          last_name: "Lovelace",
          email: `ada.${leadIds.length}.${suffix}@example.com`,
          phone,
        },
        enrichmentMetadataJson: { source: "campaign-recovery-test" },
      },
    });
    leadIds.push(lead.id);
    const resolvedAt = new Date("2026-08-01T00:00:00.000Z");
    await db.$transaction(async (tx) => {
      await tx.sourceLeadEvent.update({
        where: { id: lead.id },
        data: {
          status: "routing_matched",
          routedAt: resolvedAt,
          clientAccountIdResolved: clientId,
        },
      });
      await recordCompanySheetsCampaignIntent(
        {
          sourceLeadEventId: lead.id,
          status: "routing_matched",
          clientAccountId: clientId,
          resolvedAt,
        },
        tx,
        envFor(true, false)
      );
    });
    const intent = await db.companySheetsDispatchIntent.findUniqueOrThrow({
      where: { idempotencyKey: `campaign:${clientId}:${lead.id}` },
    });
    assert.equal(intent.kind, "campaign_lead");
    assert.equal(intent.status, "pending");
    assert.equal(intent.jobId, null);
    return lead;
  }

  async function receiptFor(leadId: string) {
    const job = await db.companySheetsDeliveryJob.findFirst({
      where: { sourceLeadEventId: leadId, kind: "lead" },
      orderBy: { createdAt: "desc" },
    });
    const intent = await db.companySheetsDispatchIntent.findFirstOrThrow({
      where: { sourceLeadEventId: leadId, kind: "campaign_lead" },
    });
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: clientId } });
    const rows = job ? await db.companySheetsDeliveryRow.findMany({ where: { jobId: job.id } }) : [];
    const verdict = job
      ? canonicalCompanySheetsDelivery({
          evidence: "campaign_job",
          job,
          rows,
          destination: {
            clientAccountId: destination.clientAccountId,
            campaignDispatchNotBefore: destination.campaignDispatchNotBefore,
          },
          intent,
          onboardingTestAttemptKeys: [],
        })
      : null;
    return { job, intent, rows, verdict };
  }

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.clientAccount.create({
      data: { clientAccountId: clientId, clientDisplayName: clientId, status: "active" },
    });
    const connection = await db.companyGoogleConnection.create({
      data: {
        connectionKey: `campaign_recovery_${suffix}`,
        googleUserId: `campaign-recovery-${suffix}`,
        googleEmail: EMAIL,
        status: "connected",
        scopes,
        tokenVersion: 1,
      },
    });
    connectionId = connection.id;
    const destination = await db.companySheetsDestination.create({
      data: {
        clientAccountId: clientId,
        companyConnectionId: connectionId,
        spreadsheetId,
        spreadsheetTitle: "Recovery",
        spreadsheetUrl: sheetUrl(spreadsheetId),
        worksheetId: 0,
        worksheetTitle: "Leads",
        controlBasis: "drive_owner_verified",
        accessStatus: "readable",
        sharingStatus: "missing_recipient",
        enabled: false,
      },
    });
    destinationId = destination.id;
    await db.companySheetsTabContract.create({
      data: {
        destinationId,
        role: "campaign",
        setupState: "bound",
        worksheetId: 0,
        worksheetTitle: "Campaign Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
        headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
        boundAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
  });

  after(async () => {
    if (!db) return;
    await db.clientSheetsPersonAdmission.deleteMany({ where: { clientAccountId: clientId } });
    await db.clientSheetsDedupeDecision.deleteMany({ where: { clientAccountId: clientId } });
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: clientId } });
    await db.companySheetsDispatchIntent.deleteMany({ where: { clientAccountId: clientId } });
    await db.companySheetsWorksheetLock.deleteMany({ where: { spreadsheetId } });
    await db.companySheetsDestination.deleteMany({ where: { clientAccountId: clientId } });
    await db.companyGoogleConnection.deleteMany({ where: { connectionKey: `campaign_recovery_${suffix}` } });
    if (leadIds.length > 0) await db.sourceLeadEvent.deleteMany({ where: { id: { in: leadIds } } });
    await db.clientAccount.deleteMany({ where: { clientAccountId: clientId } });
    await db.$disconnect();
  });

  it("recreates one claimed job after enqueue fails, and does not append twice", async () => {
    await resetSheet();
    await arm();
    const lead = await commitLead("+15551110001");
    const tab = await db.companySheetsTabContract.findUniqueOrThrow({
      where: { destinationId_role: { destinationId, role: "campaign" } },
    });
    await db.companySheetsTabContract.update({
      where: { id: tab.id },
      data: { setupState: "missing", worksheetId: null, schemaVersion: null, boundAt: null },
    });
    try {
      const failed = await processDueCompanySheetsDispatches(deps(true, true));
      assert.equal(failed.executed, 0);
      assert.equal(sheet.appends.length, 0);
      assert.equal(leadRowsAppended(sheet), 0);
      assert.equal(sheet.calls, 0);
      assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: lead.id } }), 0);
      const held = await db.companySheetsDispatchIntent.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
      assert.equal(held.status, "awaiting_setup");
      assert.equal(held.lastError, "tab_missing");
      assert.equal(held.attemptCount, 1);
    } finally {
      await db.companySheetsTabContract.update({
        where: { id: tab.id },
        data: {
          setupState: "bound",
          worksheetId: 0,
          worksheetTitle: "Campaign Leads",
          schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
          headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
          boundAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      });
    }

    const recovered = await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(recovered.executed, 1);
    assert.equal(sheet.appends.length, 1);
    assert.equal(leadRowsAppended(sheet), 1);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: lead.id } }), 1);
    const stored = await receiptFor(lead.id);
    assert.equal(stored.job?.status, "succeeded");
    assert.equal(stored.job?.attemptCount, 1);
    assert.equal(stored.intent.status, "completed");
    assert.equal(stored.verdict?.canonical, true);
    assert.ok(stored.rows.every((row) => row.status === "written"));

    const repeated = await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(repeated.processed, 0);
    assert.equal(repeated.executed, 0);
    assert.equal(sheet.appends.length, 1);
    assert.equal(leadRowsAppended(sheet), 1);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: lead.id } }), 1);
    const afterRepeat = await db.companySheetsDeliveryJob.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
    assert.equal(afterRepeat.attemptCount, 1);
  });

  it("claims one replacement job when the queued job disappears before execute", async () => {
    await resetSheet();
    await arm();
    const lead = await commitLead("+15551110002");
    const parked = await processDueCompanySheetsDispatches(deps(true, false));
    assert.equal(parked.executed, 0);
    assert.equal(sheet.appends.length, 0);
    assert.equal(leadRowsAppended(sheet), 0);
    const queued = await db.companySheetsDeliveryJob.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
    assert.equal(queued.status, "queued");
    assert.equal(queued.attemptCount, 0);
    const scheduled = await db.companySheetsDispatchIntent.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
    assert.equal(scheduled.status, "scheduled");
    assert.equal(scheduled.jobId, queued.id);

    await db.companySheetsDeliveryJob.delete({ where: { id: queued.id } });
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: lead.id } }), 0);

    const recovered = await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(recovered.executed, 1);
    assert.equal(sheet.appends.length, 1);
    assert.equal(leadRowsAppended(sheet), 1);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: lead.id } }), 1);
    const stored = await receiptFor(lead.id);
    assert.notEqual(stored.job?.id, queued.id);
    assert.equal(stored.job?.status, "succeeded");
    assert.equal(stored.job?.attemptCount, 1);
    assert.equal(stored.intent.status, "completed");
    assert.equal(stored.intent.jobId, stored.job?.id);
    assert.equal(stored.verdict?.canonical, true);

    const repeated = await processDueCompanySheetsDispatches(deps(true, true));
    assert.equal(repeated.processed, 0);
    assert.equal(repeated.executed, 0);
    assert.equal(sheet.appends.length, 1);
    assert.equal(leadRowsAppended(sheet), 1);
    const still = await db.companySheetsDeliveryJob.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
    assert.equal(still.attemptCount, 1);
  });

  it("holds a recorded append when the worker stops before the receipt, and does not append again", async () => {
    await resetSheet();
    await arm();
    const lead = await commitLead("+15551110003");
    let nowMs = Date.now();
    const running = deps(true, true);
    running.now = () => new Date(nowMs);
    let release = () => {};
    const hang = new Promise<void>((resolve) => {
      release = resolve;
    });
    let recorded = () => {};
    const recordedPromise = new Promise<void>((resolve) => {
      recorded = resolve;
    });
    sheet.hangAfterRecord = hang;
    sheet.onAppendRecorded = () => recorded();
    const first = processDueCompanySheetsDispatches(running);
    try {
      await Promise.race([
        recordedPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("append was not recorded")), 8000)),
      ]);
      assert.equal(leadRowsAppended(sheet), 1);
      assert.equal(sheet.appends.length, 1);
      const runningJob = await db.companySheetsDeliveryJob.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
      assert.equal(runningJob.status, "running");
      assert.ok(runningJob.appendStartedAt);
      assert.equal(runningJob.rowsWritten, 0);
      const pending = await db.companySheetsDeliveryRow.count({ where: { jobId: runningJob.id, status: "pending" } });
      assert.equal(pending, 1);

      nowMs += COMPANY_SHEETS_EXECUTION_LEASE_MS + 60_000;
      const recovered = await processDueCompanySheetsDispatches(running);
      assert.equal(recovered.executed, 0);
      assert.equal(leadRowsAppended(sheet), 1);
      const held = await receiptFor(lead.id);
      assert.equal(held.job?.status, "uncertain");
      assert.equal(held.job?.uncertainReason, "worker_lost");
      assert.ok(held.job?.appendStartedAt);
      assert.equal(held.job?.rowsWritten, 0);
      assert.equal(held.rows.filter((row) => row.status === "written").length, 0);
      assert.equal(held.intent.status, "scheduled");
      assert.equal(held.intent.reason, "append_outcome_unresolved");
      assert.equal(held.verdict?.canonical, false);
      assert.ok(held.verdict?.reasons.includes("status_uncertain"));
      assert.ok(held.verdict?.reasons.includes("uncertain_after_append"));

      const operator = await getCompanySheetsDispatchStatus(clientId, { db, env: envFor(true, true) });
      const shown = operator.intents.find((intent) => intent.sourceLeadEventId === lead.id);
      assert.equal(shown?.delivered, false);
      assert.equal(shown?.headline, "Scheduled, append outcome unknown");
      assert.match(shown?.detail ?? "", /not safe to retry/);
      assert.equal(operator.lastCampaignDelivery?.status, "uncertain");
      assert.equal(operator.lastCampaignDelivery?.uncertainReason, "worker_lost");
      assert.ok(operator.lastCampaignDelivery?.appendStartedAt);

      const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: clientId } });
      const account = await db.clientAccount.findUniqueOrThrow({ where: { clientAccountId: clientId } });
      const findings = evaluateDeliveryHealth(
        {
          clients: [
            {
              clientAccountId: clientId,
              status: account.status,
              destination: {
                campaignDispatchEnabled: destination.campaignDispatchEnabled,
                campaignDispatchNotBefore: destination.campaignDispatchNotBefore,
              },
            },
          ],
          leads: [
            {
              id: lead.id,
              clientAccountId: clientId,
              status: "routing_matched",
              routedAt: lead.routedAt,
              receivedAt: lead.receivedAt,
              sourceRouteKey: lead.sourceRouteKey,
              cleanupStatus: null,
              enrichmentMetadataJson: lead.enrichmentMetadataJson,
            },
          ],
          intents: [
            {
              id: held.intent.id,
              clientAccountId: clientId,
              sourceLeadEventId: lead.id,
              kind: held.intent.kind,
              status: held.intent.status,
              reason: held.intent.reason,
              lastError: held.intent.lastError,
              jobId: held.intent.jobId,
              createdAt: held.intent.createdAt,
            },
          ],
          jobs: held.job
            ? [
                {
                  id: held.job.id,
                  kind: held.job.kind,
                  status: held.job.status,
                  clientAccountId: held.job.clientAccountId,
                  sourceLeadEventId: held.job.sourceLeadEventId,
                  idempotencyKey: held.job.idempotencyKey,
                  rowsWritten: held.job.rowsWritten,
                  appendStartedAt: held.job.appendStartedAt,
                  finishedAt: held.job.finishedAt,
                  lastError: held.job.lastError,
                  uncertainReason: held.job.uncertainReason,
                  createdAt: held.job.createdAt,
                },
              ]
            : [],
          rows: held.rows.map((row) => ({ jobId: row.jobId, status: row.status })),
          onboardingTestAttemptKeys: [],
          intake: [],
        },
        new Date(nowMs)
      );
      assert.equal(findings.length, 1);
      assert.equal(findings[0]?.failureClass, "uncertain_append");
      assert.equal(findings[0]?.severity, "critical");
      assert.equal(leadRowsAppended(sheet), 1);

      nowMs += 60_000;
      const repeated = await processDueCompanySheetsDispatches(running);
      assert.equal(repeated.executed, 0);
      assert.equal(leadRowsAppended(sheet), 1);
      assert.equal(sheet.appends.length, 1);
      const still = await receiptFor(lead.id);
      assert.equal(still.job?.status, "uncertain");
      assert.equal(still.job?.uncertainReason, "worker_lost");
      assert.equal(still.job?.attemptCount, 1);
      assert.equal(still.intent.reason, "append_outcome_unresolved");
      assert.equal(still.verdict?.canonical, false);
      assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: lead.id } }), 1);
    } finally {
      release();
      sheet.hangAfterRecord = null;
      sheet.onAppendRecorded = null;
      await first.catch(() => undefined);
    }
    assert.equal(leadRowsAppended(sheet), 1);
    assert.equal(sheet.appends.length, 1);
    const finished = await db.companySheetsDeliveryJob.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
    assert.equal(finished.status, "uncertain");
    assert.equal(finished.uncertainReason, "worker_lost");
    const written = await db.companySheetsDeliveryRow.count({ where: { jobId: finished.id, status: "written" } });
    assert.equal(written, 0);
  });

  it("does not append a committed lead while API dispatch is off or the client is paused", async () => {
    await resetSheet();
    await arm();
    const dispatchLead = await commitLead("+15551110004");
    const dispatchOff = await processDueCompanySheetsDispatches(deps(false, true));
    assert.equal(dispatchOff.processed, 0);
    assert.equal(dispatchOff.executed, 0);
    assert.equal(leadRowsAppended(sheet), 0);
    assert.equal(sheet.calls, 0);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: dispatchLead.id } }), 0);
    const stillPending = await db.companySheetsDispatchIntent.findFirstOrThrow({
      where: { sourceLeadEventId: dispatchLead.id },
    });
    assert.equal(stillPending.status, "pending");

    await resetSheet();
    await arm();
    const pausedLead = await commitLead("+15551110005");
    await db.clientAccount.update({ where: { clientAccountId: clientId }, data: { status: "paused" } });
    let nowMs = Date.now();
    const pausedDeps = deps(true, true);
    pausedDeps.now = () => new Date(nowMs);
    try {
      const paused = await processDueCompanySheetsDispatches(pausedDeps);
      assert.equal(paused.executed, 0);
      assert.equal(leadRowsAppended(sheet), 0);
      assert.equal(sheet.calls, 0);
      assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: pausedLead.id } }), 0);
      const parked = await db.companySheetsDispatchIntent.findFirstOrThrow({
        where: { sourceLeadEventId: pausedLead.id },
      });
      assert.equal(parked.status, "retryable");
      assert.equal(parked.lastError, "client_not_active");
      const operator = await getCompanySheetsDispatchStatus(clientId, { db, env: envFor(true, true) });
      const shown = operator.intents.find((intent) => intent.sourceLeadEventId === pausedLead.id);
      assert.equal(shown?.delivered, false);
      assert.equal(shown?.headline, "Retryable");
      assert.match(shown?.detail ?? "", /Not delivered/);
      assert.match(shown?.detail ?? "", /client_not_active/);
      nowMs += 1_000;
      const repeated = await processDueCompanySheetsDispatches(pausedDeps);
      assert.equal(repeated.processed, 0);
      assert.equal(leadRowsAppended(sheet), 0);

      await db.clientAccount.update({ where: { clientAccountId: clientId }, data: { status: "active" } });
      nowMs += 60_000;
      const resumed = await processDueCompanySheetsDispatches(pausedDeps);
      assert.equal(resumed.executed, 1);
      assert.equal(leadRowsAppended(sheet), 1);
      const stored = await receiptFor(pausedLead.id);
      assert.equal(stored.job?.attemptCount, 1);
      assert.equal(stored.verdict?.canonical, true);
      const again = await processDueCompanySheetsDispatches(pausedDeps);
      assert.equal(again.executed, 0);
      assert.equal(leadRowsAppended(sheet), 1);
    } finally {
      await db.clientAccount.update({ where: { clientAccountId: clientId }, data: { status: "active" } });
    }
  });

  it("does not execute a queued campaign job while the client is paused", async () => {
    await resetSheet();
    await arm();
    const lead = await commitLead("+15551110006");
    const parked = await processDueCompanySheetsDispatches(deps(true, false));
    assert.equal(parked.executed, 0);
    assert.equal(leadRowsAppended(sheet), 0);
    const queued = await db.companySheetsDeliveryJob.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
    assert.equal(queued.status, "queued");
    assert.equal(queued.attemptCount, 0);

    await db.clientAccount.update({ where: { clientAccountId: clientId }, data: { status: "paused" } });
    let nowMs = Date.now();
    const pausedDeps = deps(true, true);
    pausedDeps.now = () => new Date(nowMs);
    try {
      const paused = await processDueCompanySheetsDispatches(pausedDeps);
      assert.equal(paused.executed, 0);
      assert.equal(leadRowsAppended(sheet), 0);
      assert.equal(sheet.calls, 0);
      const held = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: queued.id } });
      assert.equal(held.status, "queued");
      assert.equal(held.attemptCount, 0);
      const intent = await db.companySheetsDispatchIntent.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
      assert.equal(intent.status, "retryable");
      assert.equal(intent.lastError, "client_not_active");

      nowMs += 1_000;
      const repeated = await processDueCompanySheetsDispatches(pausedDeps);
      assert.equal(repeated.processed, 0);
      assert.equal(leadRowsAppended(sheet), 0);
      assert.equal((await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: queued.id } })).attemptCount, 0);

      await db.clientAccount.update({ where: { clientAccountId: clientId }, data: { status: "active" } });
      nowMs += 60_000;
      const resumed = await processDueCompanySheetsDispatches(pausedDeps);
      assert.equal(resumed.executed, 1);
      assert.equal(leadRowsAppended(sheet), 1);
      assert.equal(sheet.appends.length, 1);
      const stored = await receiptFor(lead.id);
      assert.equal(stored.job?.id, queued.id);
      assert.equal(stored.job?.attemptCount, 1);
      assert.equal(stored.verdict?.canonical, true);
      const again = await processDueCompanySheetsDispatches(pausedDeps);
      assert.equal(again.executed, 0);
      assert.equal(leadRowsAppended(sheet), 1);
    } finally {
      await db.clientAccount.update({ where: { clientAccountId: clientId }, data: { status: "active" } });
    }
  });
});
