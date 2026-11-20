import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import type { SendTransactionalEmailInput } from "../../lib/transactional-email.js";
import { DELIVERY_HEALTH_HEARTBEAT_ID } from "./heartbeat.js";
import { runDeliveryHealthMonitor } from "./scan.js";

const databaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
const SCAN_NOW = new Date("2026-11-20T18:00:00.000Z");
const CUTOFF = new Date("2026-11-01T00:00:00.000Z");
const PII_EMAIL = "lead@example.com";
const PII_PHONE = "555-010-0199";

function minutesAgo(minutes: number): Date {
  return new Date(SCAN_NOW.getTime() - minutes * 60 * 1000);
}

type Sent = { subject: string; text: string; idempotencyKey?: string };

describe("delivery health scan", { concurrency: 1 }, () => {
  let db: PrismaClient;
  const clientIds: string[] = [];
  const connectionKeys: string[] = [];

  before(() => {
    const sep = databaseUrl.includes("?") ? "&" : "?";
    db = new PrismaClient({ datasources: { db: { url: `${databaseUrl}${sep}connection_limit=1` } } });
  });

  after(async () => {
    await db.deliveryHealthIncident.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await db.companySheetsDispatchIntent.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await db.webhookRequestLog.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await db.routingDryRunDecision.deleteMany({ where: { destinationClientAccountId: { in: clientIds } } }).catch(() => undefined);
    await db.sourceLeadEvent.deleteMany({ where: { clientAccountIdResolved: { in: clientIds } } }).catch(() => undefined);
    await db.companySheetsDestination.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await db.companyGoogleConnection.deleteMany({ where: { connectionKey: { in: connectionKeys } } }).catch(() => undefined);
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await db.deliveryHealthMonitorHeartbeat.deleteMany({ where: { id: DELIVERY_HEALTH_HEARTBEAT_ID } }).catch(() => undefined);
    await db.$disconnect().catch(() => undefined);
  });

  async function resetHeartbeat(): Promise<void> {
    await db.deliveryHealthMonitorHeartbeat.deleteMany({ where: { id: DELIVERY_HEALTH_HEARTBEAT_ID } });
  }

  async function createClient(label: string, status: "active" | "paused" = "active", dispatch = true) {
    const clientAccountId = `dh_${label}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 6)}`;
    await db.clientAccount.create({
      data: { clientAccountId, clientDisplayName: "Delivery health fixture", status },
    });
    clientIds.push(clientAccountId);
    const connectionKey = `conn_${clientAccountId}`;
    connectionKeys.push(connectionKey);
    const connection = await db.companyGoogleConnection.create({ data: { connectionKey } });
    const destination = await db.companySheetsDestination.create({
      data: {
        clientAccountId,
        companyConnectionId: connection.id,
        spreadsheetId: `sheet_${clientAccountId}`,
        spreadsheetUrl: "https://docs.example.test/sheet",
        worksheetId: 1,
        worksheetTitle: "Campaign",
        controlBasis: "company_created",
        sharingStatus: "missing_recipient",
        campaignDispatchEnabled: dispatch,
        campaignDispatchNotBefore: CUTOFF,
      },
    });
    return { clientAccountId, connectionId: connection.id, destinationId: destination.id, spreadsheetId: destination.spreadsheetId };
  }

  async function createLead(clientAccountId: string, minutes: number) {
    return db.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        status: "routing_matched",
        clientAccountIdResolved: clientAccountId,
        routedAt: minutesAgo(minutes),
        receivedAt: minutesAgo(minutes),
        rawPayloadJson: { email: PII_EMAIL, phone: PII_PHONE },
      },
    });
  }

  async function createJob(input: {
    world: { clientAccountId: string; connectionId: string; destinationId: string; spreadsheetId: string };
    leadId: string;
    status?: string;
    lastError?: string | null;
    uncertainReason?: string | null;
    rowsWritten?: number;
    rowStatus?: string;
    finishedAt?: Date | null;
    appendStartedAt?: Date | null;
    intentStatus?: string;
  }) {
    const job = await db.companySheetsDeliveryJob.create({
      data: {
        kind: "lead",
        status: input.status ?? "succeeded",
        clientAccountId: input.world.clientAccountId,
        companyConnectionId: input.world.connectionId,
        destinationId: input.world.destinationId,
        spreadsheetId: input.world.spreadsheetId,
        spreadsheetUrl: "https://docs.example.test/sheet",
        worksheetId: 1,
        worksheetTitle: "Campaign",
        controlBasis: "company_created",
        destinationUpdatedAt: CUTOFF,
        headerContract: ["Delivery Row Id"],
        sourceLeadEventId: input.leadId,
        idempotencyKey: `lead:${input.world.clientAccountId}:${input.leadId}`,
        rowsTotal: 1,
        rowsWritten: input.rowsWritten ?? 1,
        appendStartedAt: input.appendStartedAt ?? null,
        finishedAt: input.finishedAt === undefined ? minutesAgo(1) : input.finishedAt,
        lastError: input.lastError ?? null,
        uncertainReason: input.uncertainReason ?? null,
        rows: {
          create: {
            spreadsheetId: input.world.spreadsheetId,
            worksheetId: 1,
            stableRowId: `row_${input.leadId}`,
            ordinal: 1,
            valuesJson: { email: PII_EMAIL, phone: PII_PHONE },
            status: input.rowStatus ?? "written",
          },
        },
      },
    });
    const intent = await db.companySheetsDispatchIntent.create({
      data: {
        idempotencyKey: `campaign:${input.world.clientAccountId}:${input.leadId}`,
        kind: "campaign_lead",
        status: input.intentStatus ?? "completed",
        clientAccountId: input.world.clientAccountId,
        sourceLeadEventId: input.leadId,
        jobId: job.id,
        createdAt: CUTOFF,
        lastError: input.lastError ?? null,
      },
    });
    return { job, intent };
  }

  function envFor(clientAccountId: string, notify: boolean): NodeJS.ProcessEnv {
    return {
      SA360_DELIVERY_HEALTH_MONITOR_ENABLED: "true",
      SA360_DELIVERY_HEALTH_NOTIFY_ENABLED: notify ? "true" : "false",
      SA360_DELIVERY_HEALTH_PILOT_CLIENT_IDS: clientAccountId,
      SA360_DELIVERY_HEALTH_NOTIFY_RECIPIENTS: "ops@example.com",
      SA360_DELIVERY_HEALTH_HEARTBEAT_STALE_SECONDS: "86400",
    };
  }

  function mailer(sent: Sent[]) {
    return async (input: SendTransactionalEmailInput) => {
      sent.push({
        subject: input.subject,
        text: input.text,
        idempotencyKey: input.idempotencyKey,
      });
      return { ok: true as const, id: "mail_test" };
    };
  }

  function assertNoPii(value: string): void {
    assert.equal(value.includes(PII_EMAIL), false);
    assert.equal(value.includes(PII_PHONE), false);
  }

  test("a verified Sheets receipt opens no incident and sends no mail", async () => {
    await resetHeartbeat();
    const world = await createClient("success");
    const lead = await createLead(world.clientAccountId, 10);
    const beforeLead = lead.updatedAt;
    const { job } = await createJob({ world, leadId: lead.id });
    const beforeJob = job.updatedAt;
    const sent: Sent[] = [];
    const result = await runDeliveryHealthMonitor({
      db,
      env: envFor(world.clientAccountId, true),
      now: SCAN_NOW,
      send: mailer(sent),
    });
    assert.equal(result.ok, true);
    assert.equal(result.findings, 0);
    assert.equal(sent.length, 0);
    const incidents = await db.deliveryHealthIncident.count({ where: { clientAccountId: world.clientAccountId } });
    assert.equal(incidents, 0);
    const afterLead = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: lead.id } });
    const afterJob = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(afterLead.updatedAt.getTime(), beforeLead.getTime());
    assert.equal(afterJob.updatedAt.getTime(), beforeJob.getTime());
    assert.equal(afterJob.status, "succeeded");
  });

  test("retryable delay dedupes notices and escalates once", async () => {
    await resetHeartbeat();
    const world = await createClient("retry");
    const lead = await createLead(world.clientAccountId, 6);
    await createJob({
      world,
      leadId: lead.id,
      status: "retryable",
      lastError: "network_error",
      rowsWritten: 0,
      rowStatus: "pending",
      finishedAt: null,
      intentStatus: "retryable",
    });
    const sent: Sent[] = [];
    const send = mailer(sent);
    const first = await runDeliveryHealthMonitor({ db, env: envFor(world.clientAccountId, true), now: SCAN_NOW, send });
    assert.equal(first.findings, 1);
    assert.deepEqual(first.failureClasses, ["sheets_receipt_delayed"]);
    assert.equal(first.notified, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0]?.text ?? "", /warning/);
    assertNoPii(sent[0]?.text ?? "");
    const second = await runDeliveryHealthMonitor({ db, env: envFor(world.clientAccountId, true), now: SCAN_NOW, send });
    assert.equal(second.notified, 0);
    assert.equal(sent.length, 1);
    const open = await db.deliveryHealthIncident.count({
      where: { clientAccountId: world.clientAccountId, resolvedAt: null },
    });
    assert.equal(open, 1);
    const later = new Date(SCAN_NOW.getTime() + 10 * 60 * 1000);
    const escalated = await runDeliveryHealthMonitor({
      db,
      env: envFor(world.clientAccountId, true),
      now: later,
      send,
    });
    assert.equal(escalated.notified, 1);
    assert.equal(sent[1]?.idempotencyKey?.includes("escalated"), true);
    assert.equal(sent.length, 2);
    const stored = await db.deliveryHealthIncident.findFirstOrThrow({
      where: { clientAccountId: world.clientAccountId, resolvedAt: null },
    });
    assert.equal(stored.severity, "critical");
    assertNoPii(JSON.stringify(stored.evidenceJson));
  });

  test("uncertain append and permissions errors page immediately without lead fields", async () => {
    await resetHeartbeat();
    const world = await createClient("terminal");
    const uncertainLead = await createLead(world.clientAccountId, 0.2);
    await createJob({
      world,
      leadId: uncertainLead.id,
      status: "uncertain",
      lastError: "append_outcome_unknown",
      uncertainReason: "append_outcome_unknown",
      rowsWritten: 0,
      rowStatus: "pending",
      finishedAt: null,
      appendStartedAt: minutesAgo(0.1),
      intentStatus: "scheduled",
    });
    const deniedLead = await createLead(world.clientAccountId, 0.2);
    await createJob({
      world,
      leadId: deniedLead.id,
      status: "retryable",
      lastError: "access_denied",
      rowsWritten: 0,
      rowStatus: "pending",
      finishedAt: null,
      intentStatus: "retryable",
    });
    const sent: Sent[] = [];
    const result = await runDeliveryHealthMonitor({
      db,
      env: envFor(world.clientAccountId, true),
      now: SCAN_NOW,
      send: mailer(sent),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.failureClasses, ["google_permission", "uncertain_append"]);
    assert.equal(sent.length, 2);
    for (const message of sent) {
      assert.match(message.text, /critical/);
      assert.match(message.text, /does not call Google/);
      assertNoPii(message.text);
    }
    const rows = await db.deliveryHealthIncident.findMany({ where: { clientAccountId: world.clientAccountId } });
    assert.equal(rows.length, 2);
    assert.equal(rows.every((row) => row.severity === "critical"), true);
    assertNoPii(JSON.stringify(rows.map((row) => row.evidenceJson)));
  });

  test("missing dispatch warns, and a webhook HTTP 200 is not a Sheets receipt", async () => {
    await resetHeartbeat();
    const world = await createClient("missing");
    const lead = await createLead(world.clientAccountId, 3);
    await db.webhookRequestLog.create({
      data: {
        requestId: `wh_${lead.id}`,
        source: "leadcapture_io",
        route: "/webhooks/leadcapture",
        processingStatus: "stored",
        httpStatus: 200,
        clientAccountId: world.clientAccountId,
        sourceLeadEventId: lead.id,
        completedAt: minutesAgo(3),
        requestBodyRedacted: { email: PII_EMAIL, phone: PII_PHONE },
      },
    });
    const sent: Sent[] = [];
    const result = await runDeliveryHealthMonitor({
      db,
      env: envFor(world.clientAccountId, true),
      now: SCAN_NOW,
      send: mailer(sent),
    });
    assert.deepEqual(result.failureClasses, ["missing_dispatch"]);
    assert.equal(sent[0]?.text.includes("missing_dispatch"), true);
    assertNoPii(JSON.stringify(sent));
    const queued = await createClient("queued");
    const queuedLead = await createLead(queued.clientAccountId, 6);
    await createJob({
      world: queued,
      leadId: queuedLead.id,
      status: "queued",
      rowsWritten: 0,
      rowStatus: "pending",
      finishedAt: null,
      intentStatus: "pending",
    });
    await db.webhookRequestLog.create({
      data: {
        requestId: `wh_${queuedLead.id}`,
        source: "leadcapture_io",
        route: "/webhooks/leadcapture",
        processingStatus: "stored",
        httpStatus: 200,
        clientAccountId: queued.clientAccountId,
        sourceLeadEventId: queuedLead.id,
        completedAt: minutesAgo(6),
        requestBodyRedacted: { email: PII_EMAIL },
      },
    });
    const queuedResult = await runDeliveryHealthMonitor({
      db,
      env: envFor(queued.clientAccountId, false),
      now: SCAN_NOW,
      send: mailer([]),
    });
    assert.deepEqual(queuedResult.failureClasses, ["sheets_receipt_delayed"]);
    assert.equal(queuedResult.notificationSkipped, "notify_disabled");
    assert.equal(queuedResult.notified, 0);
  });

  test("a corroborated routing decision with no source event is missing intake", async () => {
    await resetHeartbeat();
    const world = await createClient("intake");
    const decision = await db.routingDryRunDecision.create({
      data: {
        masterClientAccountId: world.clientAccountId,
        destinationClientAccountId: world.clientAccountId,
        sourceLeadUid: `uid_${world.clientAccountId}`,
        matched: true,
        confidence: "high",
        matchReason: "rule",
        routingEventNameInternal: "lead.received",
        createdAt: minutesAgo(4),
      },
    });
    await db.webhookRequestLog.create({
      data: {
        requestId: `wh_${decision.id}`,
        source: "leadcapture_io",
        route: "/webhooks/leadcapture",
        processingStatus: "stored",
        httpStatus: 200,
        clientAccountId: world.clientAccountId,
        routingDryRunDecisionId: decision.id,
        completedAt: minutesAgo(3),
        requestBodyRedacted: { email: PII_EMAIL, phone: PII_PHONE },
      },
    });
    const sent: Sent[] = [];
    const result = await runDeliveryHealthMonitor({
      db,
      env: envFor(world.clientAccountId, true),
      now: SCAN_NOW,
      send: mailer(sent),
    });
    assert.deepEqual(result.failureClasses, ["missing_intake"]);
    assert.match(sent[0]?.text ?? "", /routingDryRunDecisionId=/);
    assertNoPii(sent[0]?.text ?? "");
    const quiet = await createClient("quiet");
    const quietResult = await runDeliveryHealthMonitor({
      db,
      env: envFor(quiet.clientAccountId, true),
      now: SCAN_NOW,
      send: mailer([]),
    });
    assert.equal(quietResult.findings, 0);
  });

  test("duplicate holds, paused clients, and disabled destinations stay quiet", async () => {
    await resetHeartbeat();
    const duplicate = await createClient("duplicate");
    const duplicateLead = await createLead(duplicate.clientAccountId, 20);
    await db.companySheetsDispatchIntent.create({
      data: {
        idempotencyKey: `campaign:${duplicate.clientAccountId}:${duplicateLead.id}`,
        kind: "campaign_lead",
        status: "duplicate_held",
        clientAccountId: duplicate.clientAccountId,
        sourceLeadEventId: duplicateLead.id,
        lastError: "person_duplicate",
        createdAt: CUTOFF,
      },
    });
    const paused = await createClient("paused", "paused");
    await createLead(paused.clientAccountId, 20);
    const disabled = await createClient("disabled", "active", false);
    await createLead(disabled.clientAccountId, 20);
    for (const clientAccountId of [duplicate.clientAccountId, paused.clientAccountId, disabled.clientAccountId]) {
      const sent: Sent[] = [];
      const result = await runDeliveryHealthMonitor({
        db,
        env: envFor(clientAccountId, true),
        now: SCAN_NOW,
        send: mailer(sent),
      });
      assert.equal(result.findings, 0);
      assert.equal(sent.length, 0);
    }
  });

  test("a cleared receipt resolves the incident and sends one recovery", async () => {
    await resetHeartbeat();
    const world = await createClient("recover");
    const lead = await createLead(world.clientAccountId, 6);
    const { job } = await createJob({
      world,
      leadId: lead.id,
      status: "retryable",
      lastError: "network_error",
      rowsWritten: 0,
      rowStatus: "pending",
      finishedAt: null,
      intentStatus: "retryable",
    });
    const sent: Sent[] = [];
    const send = mailer(sent);
    await runDeliveryHealthMonitor({ db, env: envFor(world.clientAccountId, true), now: SCAN_NOW, send });
    assert.equal(sent.length, 1);
    await db.companySheetsDeliveryRow.updateMany({ where: { jobId: job.id }, data: { status: "written" } });
    await db.companySheetsDeliveryJob.update({
      where: { id: job.id },
      data: { status: "succeeded", rowsWritten: 1, finishedAt: minutesAgo(1), lastError: null, uncertainReason: null },
    });
    await db.companySheetsDispatchIntent.updateMany({
      where: { jobId: job.id },
      data: { status: "completed", lastError: null },
    });
    const fixed = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: job.id } });
    const recovered = await runDeliveryHealthMonitor({
      db,
      env: envFor(world.clientAccountId, true),
      now: SCAN_NOW,
      send,
    });
    assert.equal(recovered.resolved, 1);
    assert.equal(sent.length, 2);
    assert.equal(sent[1]?.idempotencyKey?.includes("recovered"), true);
    assertNoPii(sent[1]?.text ?? "");
    const after = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(after.status, "succeeded");
    assert.equal(after.updatedAt.getTime(), fixed.updatedAt.getTime());
    const third = await runDeliveryHealthMonitor({ db, env: envFor(world.clientAccountId, true), now: SCAN_NOW, send });
    assert.equal(third.notified, 0);
    assert.equal(sent.length, 2);
  });

  test("a scanner failure records the heartbeat and does not copy the thrown secret", async () => {
    await resetHeartbeat();
    const world = await createClient("scanner");
    const lead = await createLead(world.clientAccountId, 3);
    const before = lead.updatedAt;
    const sent: Sent[] = [];
    const result = await runDeliveryHealthMonitor({
      db,
      env: envFor(world.clientAccountId, true),
      now: SCAN_NOW,
      send: mailer(sent),
      loadSnapshot: async () => {
        throw new Error(`Bearer secret-token ${PII_EMAIL} ${PII_PHONE} +15550100199`);
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.heartbeat, "failed");
    const beat = await db.deliveryHealthMonitorHeartbeat.findUniqueOrThrow({ where: { id: DELIVERY_HEALTH_HEARTBEAT_ID } });
    assert.equal(beat.consecutiveFailures >= 1, true);
    assert.equal(beat.lastError?.includes("secret-token"), false);
    assert.equal(beat.lastError?.includes(PII_EMAIL), false);
    assert.equal(beat.lastError?.includes(PII_PHONE), false);
    assert.equal(beat.lastError?.includes("+15550100199"), false);
    assert.equal(sent.length, 1);
    assertNoPii(sent[0]?.text ?? "");
    assert.equal(sent[0]?.text.includes("secret-token"), false);
    assert.equal(sent[0]?.text.includes(PII_PHONE), false);
    assert.equal(sent[0]?.text.includes("+15550100199"), false);
    const after = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: lead.id } });
    assert.equal(after.updatedAt.getTime(), before.getTime());
    const incidents = await db.deliveryHealthIncident.count({ where: { clientAccountId: world.clientAccountId } });
    assert.equal(incidents, 0);
  });

  test("missing intake stays open after the lookback and recovers when the source event exists", async () => {
    await resetHeartbeat();
    const world = await createClient("intake-age");
    const decision = await db.routingDryRunDecision.create({
      data: {
        masterClientAccountId: world.clientAccountId,
        destinationClientAccountId: world.clientAccountId,
        sourceLeadUid: `uid_${world.clientAccountId}`,
        matched: true,
        confidence: "high",
        matchReason: "rule",
        routingEventNameInternal: "lead.received",
        createdAt: minutesAgo(4),
      },
    });
    const webhook = await db.webhookRequestLog.create({
      data: {
        requestId: `wh_${decision.id}`,
        source: "leadcapture_io",
        route: "/webhooks/leadcapture",
        processingStatus: "stored",
        httpStatus: 200,
        clientAccountId: world.clientAccountId,
        routingDryRunDecisionId: decision.id,
        completedAt: minutesAgo(3),
        requestBodyRedacted: { email: PII_EMAIL, phone: PII_PHONE },
      },
    });
    const sent: Sent[] = [];
    const send = mailer(sent);
    const opened = await runDeliveryHealthMonitor({
      db,
      env: envFor(world.clientAccountId, true),
      now: SCAN_NOW,
      send,
    });
    assert.deepEqual(opened.failureClasses, ["missing_intake"]);
    assert.equal(sent.length, 1);
    const aged = new Date(SCAN_NOW.getTime() - 72 * 60 * 60 * 1000);
    await db.routingDryRunDecision.update({ where: { id: decision.id }, data: { createdAt: aged } });
    await db.webhookRequestLog.update({ where: { id: webhook.id }, data: { receivedAt: aged } });
    const expired = await runDeliveryHealthMonitor({
      db,
      env: envFor(world.clientAccountId, true),
      now: SCAN_NOW,
      send,
    });
    assert.deepEqual(expired.failureClasses, ["missing_intake"]);
    assert.equal(expired.resolved, 0);
    assert.equal(sent.length, 1);
    const open = await db.deliveryHealthIncident.findFirstOrThrow({
      where: { clientAccountId: world.clientAccountId, failureClass: "missing_intake", resolvedAt: null },
    });
    assertNoPii(JSON.stringify(open.evidenceJson));
    await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        status: "routing_matched",
        clientAccountIdResolved: world.clientAccountId,
        routingDryRunDecisionId: decision.id,
        routedAt: minutesAgo(1),
        receivedAt: minutesAgo(1),
        rawPayloadJson: { email: PII_EMAIL, phone: PII_PHONE },
      },
    });
    const recovered = await runDeliveryHealthMonitor({
      db,
      env: envFor(world.clientAccountId, true),
      now: SCAN_NOW,
      send,
    });
    assert.equal(recovered.resolved, 1);
    assert.equal(recovered.findings, 0);
    assert.equal(sent.length, 2);
    assert.equal(sent[1]?.idempotencyKey?.includes("recovered"), true);
    assertNoPii(sent.map((message) => message.text).join("\n"));
    const closed = await db.deliveryHealthIncident.findFirstOrThrow({
      where: { clientAccountId: world.clientAccountId, failureClass: "missing_intake" },
    });
    assert.equal(closed.resolvedAt?.toISOString(), SCAN_NOW.toISOString());
  });

  test("a failed newer heartbeat notice is retried and recovery still sends", async () => {
    await resetHeartbeat();
    const world = await createClient("heartbeat-mail");
    const env = {
      ...envFor(world.clientAccountId, true),
      SA360_DELIVERY_HEALTH_NOTIFY_COOLDOWN_SECONDS: "60",
    };
    const sent: Sent[] = [];
    let failNext = false;
    const send = async (input: SendTransactionalEmailInput) => {
      if (failNext) {
        failNext = false;
        return { ok: false as const, error: "send_failed" };
      }
      sent.push({ subject: input.subject, text: input.text, idempotencyKey: input.idempotencyKey });
      return { ok: true as const, id: "mail_test" };
    };
    const explode = async () => {
      throw new Error("scanner_failed");
    };
    const firstAt = SCAN_NOW;
    await runDeliveryHealthMonitor({ db, env, now: firstAt, send, loadSnapshot: explode });
    const firstBeat = await db.deliveryHealthMonitorHeartbeat.findUniqueOrThrow({
      where: { id: DELIVERY_HEALTH_HEARTBEAT_ID },
    });
    assert.match(firstBeat.lastMonitorNotificationKey ?? "", /scanner_failed/);
    assert.equal(firstBeat.lastMonitorNotifiedAt?.toISOString(), firstAt.toISOString());
    const firstKey = firstBeat.lastMonitorNotificationKey;
    const secondAt = new Date(firstAt.getTime() + 60_000);
    failNext = true;
    const failedSend = await runDeliveryHealthMonitor({ db, env, now: secondAt, send, loadSnapshot: explode });
    assert.equal(failedSend.ok, false);
    const afterFailure = await db.deliveryHealthMonitorHeartbeat.findUniqueOrThrow({
      where: { id: DELIVERY_HEALTH_HEARTBEAT_ID },
    });
    assert.equal(afterFailure.lastMonitorNotificationKey, firstKey);
    assert.equal(afterFailure.lastMonitorNotifiedAt?.toISOString(), firstAt.toISOString());
    assert.equal(sent.length, 1);
    const retried = await runDeliveryHealthMonitor({ db, env, now: secondAt, send, loadSnapshot: explode });
    assert.equal(retried.heartbeat, "failed");
    const afterRetry = await db.deliveryHealthMonitorHeartbeat.findUniqueOrThrow({
      where: { id: DELIVERY_HEALTH_HEARTBEAT_ID },
    });
    assert.notEqual(afterRetry.lastMonitorNotificationKey, firstKey);
    assert.match(afterRetry.lastMonitorNotificationKey ?? "", /scanner_failed/);
    assert.equal(afterRetry.lastMonitorNotifiedAt?.toISOString(), secondAt.toISOString());
    assert.equal(sent.length, 2);
    const emptySnapshot = {
      snapshot: {
        clients: [],
        leads: [],
        intents: [],
        jobs: [],
        rows: [],
        onboardingTestAttemptKeys: [],
        intake: [],
      },
      truncated: false,
    };
    failNext = true;
    const recoveryFailed = await runDeliveryHealthMonitor({
      db,
      env,
      now: secondAt,
      send,
      loadSnapshot: async () => emptySnapshot,
    });
    assert.equal(recoveryFailed.ok, true);
    const stillFailedNotice = await db.deliveryHealthMonitorHeartbeat.findUniqueOrThrow({
      where: { id: DELIVERY_HEALTH_HEARTBEAT_ID },
    });
    assert.equal(stillFailedNotice.lastMonitorNotificationKey, afterRetry.lastMonitorNotificationKey);
    assert.equal(stillFailedNotice.consecutiveFailures, 0);
    assert.equal(sent.length, 2);
    const recovered = await runDeliveryHealthMonitor({
      db,
      env,
      now: secondAt,
      send,
      loadSnapshot: async () => emptySnapshot,
    });
    assert.equal(recovered.heartbeat, "ok");
    assert.equal(sent.length, 3);
    assert.match(sent[2]?.idempotencyKey ?? "", /dh-monitor:recovered:/);
    assertNoPii(sent.map((message) => message.text).join("\n"));
    const beat = await db.deliveryHealthMonitorHeartbeat.findUniqueOrThrow({
      where: { id: DELIVERY_HEALTH_HEARTBEAT_ID },
    });
    assert.match(beat.lastMonitorNotificationKey ?? "", /dh-monitor:recovered:/);
    assert.equal(beat.lastSucceededAt?.toISOString(), secondAt.toISOString());
  });

  test("accepted notice state changes only after the sender accepts", async () => {
    await resetHeartbeat();
    const world = await createClient("notice-retry");
    const lead = await createLead(world.clientAccountId, 6);
    const { job } = await createJob({
      world,
      leadId: lead.id,
      status: "retryable",
      lastError: "network_error",
      rowsWritten: 0,
      rowStatus: "pending",
      finishedAt: null,
      intentStatus: "retryable",
    });
    const sent: Sent[] = [];
    let accept = false;
    const send = async (input: SendTransactionalEmailInput) => {
      if (!accept) return { ok: false as const, error: "send_failed" };
      sent.push({ subject: input.subject, text: input.text, idempotencyKey: input.idempotencyKey });
      return { ok: true as const, id: "mail_test" };
    };
    const env = envFor(world.clientAccountId, true);
    const incident = () =>
      db.deliveryHealthIncident.findFirstOrThrow({
        where: { clientAccountId: world.clientAccountId, failureClass: "sheets_receipt_delayed" },
      });
    const incidentMails = () => sent.filter((message) => message.idempotencyKey?.startsWith("dh:"));

    await runDeliveryHealthMonitor({ db, env, now: SCAN_NOW, send });
    assert.equal(incidentMails().length, 0);
    let row = await incident();
    assert.equal(row.lastNotifiedAt, null);
    assert.equal(row.lastNotificationKey, null);
    assert.equal(row.lastNotificationKind, null);
    assert.equal(row.lastNotifiedSeverity, null);
    assert.equal(row.resolvedAt, null);

    accept = true;
    await runDeliveryHealthMonitor({ db, env, now: SCAN_NOW, send });
    assert.equal(incidentMails().length, 1);
    const openedKey = incidentMails()[0]?.idempotencyKey ?? "";
    assert.match(openedKey, /:opened:warning$/);
    row = await incident();
    assert.equal(row.lastNotificationKey, openedKey);
    assert.equal(row.lastNotificationKind, "opened");
    assert.equal(row.lastNotifiedSeverity, "warning");
    const acceptedAt = row.lastNotifiedAt;
    assert.ok(acceptedAt);

    accept = false;
    const later = new Date(SCAN_NOW.getTime() + 10 * 60 * 1000);
    const escalatedFail = await runDeliveryHealthMonitor({ db, env, now: later, send });
    assert.equal(escalatedFail.notified, 0);
    assert.equal(incidentMails().length, 1);
    row = await incident();
    assert.equal(row.severity, "critical");
    assert.equal(row.lastNotificationKey, openedKey);
    assert.equal(row.lastNotificationKind, "opened");
    assert.equal(row.lastNotifiedSeverity, "warning");
    assert.equal(row.lastNotifiedAt?.toISOString(), acceptedAt?.toISOString());
    assert.equal(row.resolvedAt, null);

    accept = true;
    await runDeliveryHealthMonitor({ db, env, now: later, send });
    await runDeliveryHealthMonitor({ db, env, now: later, send });
    const escalations = incidentMails().filter((message) => message.idempotencyKey?.includes(":escalated:critical"));
    assert.equal(escalations.length, 1);
    const escalatedKey = escalations[0]?.idempotencyKey ?? "";
    row = await incident();
    assert.equal(row.lastNotificationKey, escalatedKey);
    assert.equal(row.lastNotificationKind, "escalated");
    assert.equal(row.lastNotifiedSeverity, "critical");
    const escalatedAt = row.lastNotifiedAt;

    await db.companySheetsDeliveryRow.updateMany({ where: { jobId: job.id }, data: { status: "written" } });
    await db.companySheetsDeliveryJob.update({
      where: { id: job.id },
      data: { status: "succeeded", rowsWritten: 1, finishedAt: minutesAgo(1), lastError: null, uncertainReason: null },
    });
    await db.companySheetsDispatchIntent.updateMany({
      where: { jobId: job.id },
      data: { status: "completed", lastError: null },
    });
    accept = false;
    const recoveryFailed = await runDeliveryHealthMonitor({ db, env, now: later, send });
    assert.equal(recoveryFailed.resolved, 0);
    assert.equal(incidentMails().filter((message) => message.idempotencyKey?.includes(":recovered")).length, 0);
    row = await incident();
    assert.equal(row.resolvedAt, null);
    assert.equal(row.lastNotificationKey, escalatedKey);
    assert.equal(row.lastNotificationKind, "escalated");
    assert.equal(row.lastNotifiedAt?.toISOString(), escalatedAt?.toISOString());

    accept = true;
    const recovered = await runDeliveryHealthMonitor({ db, env, now: later, send });
    assert.equal(recovered.resolved, 1);
    const recoveries = incidentMails().filter((message) => message.idempotencyKey?.includes(":recovered"));
    assert.equal(recoveries.length, 1);
    await runDeliveryHealthMonitor({ db, env, now: later, send });
    assert.equal(incidentMails().filter((message) => message.idempotencyKey?.includes(":recovered")).length, 1);
    const closed = await incident();
    assert.equal(closed.resolvedAt?.toISOString(), later.toISOString());
    assert.equal(closed.lastNotificationKey, recoveries[0]?.idempotencyKey);
    assert.equal(closed.lastNotificationKind, "recovered");
    assertNoPii(incidentMails().map((message) => message.text).join("\n"));
  });

  test("a database failure after sender acceptance retries the same idempotency key", async () => {
    await resetHeartbeat();
    const world = await createClient("notice-db");
    const lead = await createLead(world.clientAccountId, 6);
    await createJob({
      world,
      leadId: lead.id,
      status: "retryable",
      lastError: "network_error",
      rowsWritten: 0,
      rowStatus: "pending",
      finishedAt: null,
      intentStatus: "retryable",
    });
    const sent: Sent[] = [];
    const send = async (input: SendTransactionalEmailInput) => {
      sent.push({ subject: input.subject, text: input.text, idempotencyKey: input.idempotencyKey });
      return { ok: true as const, id: "mail_test" };
    };
    const incidentMails = () => sent.filter((message) => message.idempotencyKey?.startsWith("dh:"));
    const originalUpdate = db.deliveryHealthIncident.update.bind(db.deliveryHealthIncident);
    let failAcceptedWrite = true;
    const incidentWrites = db.deliveryHealthIncident as unknown as {
      update: (args: { data?: { lastNotifiedAt?: Date | null } }) => Promise<unknown>;
    };
    const previousUpdate = incidentWrites.update;
    incidentWrites.update = async (args) => {
      if (failAcceptedWrite && args.data?.lastNotifiedAt) throw new Error("accepted_notice_write_failed");
      return originalUpdate(args as never);
    };
    try {
      const env = envFor(world.clientAccountId, true);
      const first = await runDeliveryHealthMonitor({ db, env, now: SCAN_NOW, send });
      assert.equal(first.ok, false);
      assert.equal(incidentMails().length, 1);
      const key = incidentMails()[0]?.idempotencyKey ?? "";
      assert.match(key, /:opened:warning$/);
      const pending = await db.deliveryHealthIncident.findFirstOrThrow({
        where: { clientAccountId: world.clientAccountId, failureClass: "sheets_receipt_delayed" },
      });
      assert.equal(pending.lastNotifiedAt, null);
      assert.equal(pending.lastNotificationKey, null);
      failAcceptedWrite = false;
      const second = await runDeliveryHealthMonitor({ db, env, now: SCAN_NOW, send });
      assert.equal(second.ok, true);
      assert.equal(second.notified, 1);
      assert.equal(incidentMails().length, 2);
      assert.equal(incidentMails()[1]?.idempotencyKey, key);
      const stored = await db.deliveryHealthIncident.findFirstOrThrow({
        where: { clientAccountId: world.clientAccountId, failureClass: "sheets_receipt_delayed" },
      });
      assert.equal(stored.lastNotificationKey, key);
      assert.equal(stored.lastNotificationKind, "opened");
      assert.ok(stored.lastNotifiedAt);
      const third = await runDeliveryHealthMonitor({ db, env, now: SCAN_NOW, send });
      assert.equal(third.notified, 0);
      assert.equal(incidentMails().length, 2);
    } finally {
      incidentWrites.update = previousUpdate;
    }
  });

  test("a lead outside the stored evidence sample cannot age out into a false recovery", async () => {
    await resetHeartbeat();
    const world = await createClient("evidence-cap");
    const leads = [];
    for (let index = 0; index < 21; index += 1) {
      leads.push(await createLead(world.clientAccountId, 10));
    }
    const env = envFor(world.clientAccountId, false);
    const opened = await runDeliveryHealthMonitor({ db, env, now: SCAN_NOW, send: async () => ({ ok: true, id: "unused" }) });
    assert.deepEqual(opened.failureClasses, ["missing_dispatch"]);
    const row = await db.deliveryHealthIncident.findFirstOrThrow({
      where: { clientAccountId: world.clientAccountId, failureClass: "missing_dispatch", resolvedAt: null },
    });
    const evidence = row.evidenceJson as { affectedCount?: number; subjects?: Array<{ sourceLeadEventId?: string | null }> };
    assert.equal(evidence.affectedCount, 21);
    assert.equal(evidence.subjects?.length, 21);
    const kept = leads[0];
    assert.ok(kept);
    const aged = new Date(SCAN_NOW.getTime() - 72 * 60 * 60 * 1000);
    for (const leadRow of leads) {
      await db.sourceLeadEvent.update({
        where: { id: leadRow.id },
        data: { receivedAt: aged, routedAt: aged },
      });
      if (leadRow.id === kept.id) continue;
      await createJob({ world, leadId: leadRow.id });
    }
    const again = await runDeliveryHealthMonitor({ db, env, now: SCAN_NOW, send: async () => ({ ok: true, id: "unused" }) });
    assert.deepEqual(again.failureClasses, ["missing_dispatch"]);
    assert.equal(again.resolved, 0);
    const stillOpen = await db.deliveryHealthIncident.findFirstOrThrow({
      where: { clientAccountId: world.clientAccountId, failureClass: "missing_dispatch", resolvedAt: null },
    });
    assert.equal(stillOpen.affectedCount, 1);
    assert.equal(JSON.stringify(stillOpen.evidenceJson).includes(PII_EMAIL), false);
  });
});
