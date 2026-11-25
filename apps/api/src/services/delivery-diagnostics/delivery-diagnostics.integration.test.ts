/**
 * Runs the diagnostics against the local test Postgres and Redis only.
 * Seeds synthetic incident-shaped data, then proves the routes and services
 * classify it correctly, return no consumer fields, and change nothing.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Queue } from "bullmq";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { EXTERNAL_WEBHOOK_DELIVERY_QUEUE } from "@sa360/shared";

import { ADMIN_KEY_HEADER } from "../../lib/admin-auth.js";
import { prisma } from "../../lib/db.js";
import { redis } from "../../lib/redis.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { adminDeliveryDiagnosticsRoutes } from "../../routes/admin-delivery-diagnostics.js";
import {
  contactStep,
  opportunityFailed,
  ownerFailed,
  tagStep,
  workflowCompleted,
  workflowSkipped,
  type FixtureStep,
} from "../../test/delivery-diagnostics-fixtures.js";
import { bullQueueReader } from "./infra-health.js";
import { withReadOnlyDb } from "./read-only.js";

const integrationUrl = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const enabled = Boolean(integrationUrl);
const db = prisma as PrismaClient;
const KEY = "delivery-diagnostics-integration-key";
const PII_EMAIL = "pii.consumer.diag@example.test";
const PII_PHONE = "+15555550199";
const PII_NAME = "Zelda Quincy";
const HOUR = 3600_000;

type SeedInput = {
  stamp: string;
  suffix: string;
  destination?: Partial<{
    deliveryMode: string;
    deliveryEnabled: boolean;
    workflowStartRequired: boolean;
    opportunityCreationEnabled: boolean;
    policy: Record<string, unknown>;
  }>;
  run?: { status: string; steps: FixtureStep[]; recordedWorkflowStartRequired?: boolean | null };
  outboxStatus?: string;
  availableAt?: Date;
};

async function seed(input: SeedInput) {
  const clientAccountId = `diag_${input.stamp}_${input.suffix}`;
  const locationId = `loc_${input.stamp}_${input.suffix}`;
  const leadUid = `lead_${input.stamp}_${input.suffix}`;
  const now = Date.now();
  await db.clientAccount.create({ data: { clientAccountId, clientDisplayName: PII_NAME, status: "active" } });
  await db.clientGhlDestination.create({
    data: {
      clientAccountId,
      destinationSubaccountIdGhl: locationId,
      locationName: `${PII_NAME} CRM`,
      destinationWorkflowIdGhl: "wf_diag",
      workflowTriggerMode: "direct_api",
      workflowStartRequired: input.destination?.workflowStartRequired ?? true,
      opportunityCreationEnabled: input.destination?.opportunityCreationEnabled ?? false,
      destinationPipelineIdGhl: input.destination?.opportunityCreationEnabled ? "pipe_diag" : null,
      destinationPipelineStageIdGhl: input.destination?.opportunityCreationEnabled ? "stage_diag" : null,
      sourceEnrichmentPolicyJson: (input.destination?.policy ?? {}) as object,
      deliveryMode: input.destination?.deliveryMode ?? "live",
      deliveryEnabled: input.destination?.deliveryEnabled ?? true,
      clientCutoverApproved: true,
      internalApprovalStatus: "approved",
      ghlConnectionStatus: "connected",
    },
  });
  const decision = await db.routingDryRunDecision.create({
    data: {
      masterClientAccountId: "lal_master_vet",
      sourceLeadUid: leadUid,
      matched: true,
      confidence: "confirmed_source",
      matchReason: "Confirmed parent URL association",
      destinationClientAccountId: clientAccountId,
      destinationSubaccountIdGhl: locationId,
      routingEventNameInternal: "routing_matched",
      attributionSnapshot: { routingAuthority: "source_association" },
    },
  });
  const plan = await db.leadDeliveryPlan.create({
    data: {
      routingDryRunDecisionId: decision.id,
      masterClientAccountId: "lal_master_vet",
      sourceLeadUid: leadUid,
      sourceEmail: PII_EMAIL,
      sourcePhoneE164: PII_PHONE,
      destinationClientAccountId: clientAccountId,
      destinationSubaccountIdGhl: locationId,
      deliveryMode: "live",
      status: "ready",
    },
  });
  const source = await db.sourceLeadEvent.create({
    data: {
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceType: "webhook",
      sourceLeadUid: leadUid,
      sourceCampaignId: `camp_${input.stamp}`,
      clientAccountIdResolved: clientAccountId,
      destinationLocationIdResolved: locationId,
      status: "routing_matched",
      rawPayloadJson: { contact: { first_name: PII_NAME, email: PII_EMAIL, phone: PII_PHONE } },
      normalizedPayloadJson: { contact: { first_name: PII_NAME, email: PII_EMAIL, phone_e164: PII_PHONE } },
      routingDryRunDecisionId: decision.id,
      receivedAt: new Date(now - 3 * HOUR),
      routedAt: new Date(now - 3 * HOUR + 1000),
    },
  });
  let runId: string | null = null;
  if (input.run) {
    const run = await db.ghlLiveDeliveryRun.create({
      data: {
        leadDeliveryPlanId: plan.id,
        routingDryRunDecisionId: decision.id,
        masterClientAccountId: "lal_master_vet",
        destinationClientAccountId: clientAccountId,
        destinationSubaccountIdGhl: locationId,
        mode: "ongoing_association",
        status: input.run.status,
        idempotencyKey: `ghl-association:${source.id}`,
        startedAt: new Date(now - 2 * HOUR),
        completedAt: new Date(now - 2 * HOUR + 5000),
        summary: `${input.run.status} for ${PII_EMAIL}`,
        errors: input.run.status === "failed" ? [`bad contact ${PII_EMAIL}`] : undefined,
        workflowStartRequired:
          input.run.recordedWorkflowStartRequired === undefined
            ? (input.destination?.workflowStartRequired ?? true)
            : input.run.recordedWorkflowStartRequired,
        stepRuns: {
          create: input.run.steps.map((step) => ({
            stepOrder: step.stepOrder,
            stepType: step.stepType,
            status: step.status,
            externalId: step.externalId,
            errorCode: step.errorCode,
            errorSummary: step.errorSummary,
            responseRedactedJson: step.responseRedactedJson as object,
          })),
        },
      },
    });
    runId = run.id;
  }
  await db.ghlAssociationDispatchOutbox.create({
    data: {
      idempotencyKey: `association:${source.id}`,
      status: input.outboxStatus ?? "settled",
      clientAccountId,
      sourceLeadEventId: source.id,
      routingDryRunDecisionId: decision.id,
      destinationLocationIdGhl: locationId,
      liveRunId: runId,
      outcome: input.run?.status ?? null,
      externalCallExecuted: Boolean(input.run),
      attemptCount: input.run ? 1 : 0,
      availableAt: input.availableAt ?? new Date(now - 2 * HOUR - 60_000),
      settledAt: (input.outboxStatus ?? "settled") === "settled" ? new Date(now - 2 * HOUR + 5000) : null,
    },
  });
  return { clientAccountId, locationId, leadUid, sourceId: source.id, runId };
}

async function seedSheets(stamp: string) {
  const clientAccountId = `diag_${stamp}_sheets`;
  const now = Date.now();
  await db.clientAccount.create({ data: { clientAccountId, clientDisplayName: PII_NAME, status: "active" } });
  const base = {
    clientAccountId,
    companyConnectionId: `conn_${stamp}`,
    spreadsheetId: `sheet_${stamp}`,
    spreadsheetUrl: `https://sheets.example.test/${stamp}`,
    worksheetId: 1,
    worksheetTitle: "Leads",
    controlBasis: "test",
    destinationUpdatedAt: new Date(now - 24 * HOUR),
    headerContract: [],
    rowsTotal: 1,
  };
  await db.companySheetsDeliveryJob.create({
    data: {
      ...base,
      kind: "lead",
      status: "succeeded",
      idempotencyKey: `sheets:${stamp}:noproof`,
      rowsWritten: 1,
      finishedAt: new Date(now - HOUR),
      createdAt: new Date(now - 2 * HOUR),
    },
  });
  await db.companySheetsDeliveryJob.create({
    data: { ...base, kind: "lead", status: "retryable", idempotencyKey: `sheets:${stamp}:retry`, attemptCount: 3, lastError: `http_429: quota for ${PII_EMAIL}` },
  });
  await db.companySheetsDeliveryJob.create({
    data: { ...base, kind: "lead", status: "uncertain", idempotencyKey: `sheets:${stamp}:uncertain`, uncertainReason: "append_started" },
  });
  await db.companySheetsDispatchIntent.create({
    data: {
      idempotencyKey: `intent:${stamp}:old`,
      kind: "campaign_lead",
      status: "pending",
      clientAccountId,
      sourceLeadEventId: `lead_event_${stamp}`,
      availableAt: new Date(now - 3 * HOUR),
      createdAt: new Date(now - 3 * HOUR),
    },
  });
  await db.companySheetsDispatchIntent.create({
    data: {
      idempotencyKey: `intent:${stamp}:hold`,
      kind: "campaign_lead",
      status: "awaiting_setup",
      clientAccountId,
      sourceLeadEventId: `lead_event_hold_${stamp}`,
      createdAt: new Date(now - 2 * HOUR),
    },
  });
  return { clientAccountId };
}

async function cleanup(stamp: string) {
  const prefix = `diag_${stamp}_`;
  const sources = await db.sourceLeadEvent.findMany({
    where: { clientAccountIdResolved: { startsWith: prefix } },
    select: { id: true, routingDryRunDecisionId: true },
  });
  const sourceIds = sources.map((row) => row.id);
  const decisionIds = sources.map((row) => row.routingDryRunDecisionId).filter((id): id is string => Boolean(id));
  await db.ghlAssociationDispatchOutbox.deleteMany({ where: { clientAccountId: { startsWith: prefix } } });
  await db.ghlLiveDeliveryRun.deleteMany({ where: { destinationClientAccountId: { startsWith: prefix } } });
  await db.leadDeliveryPlan.deleteMany({ where: { destinationClientAccountId: { startsWith: prefix } } });
  await db.sourceLeadEvent.deleteMany({ where: { id: { in: sourceIds } } });
  await db.routingDryRunDecision.deleteMany({ where: { id: { in: decisionIds } } });
  await db.companySheetsDispatchIntent.deleteMany({ where: { clientAccountId: { startsWith: prefix } } });
  await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: { startsWith: prefix } } });
  await db.clientAccount.deleteMany({ where: { clientAccountId: { startsWith: prefix } } });
}

async function tableCounts() {
  const [runs, steps, outbox, jobs, rows, intents, leads, destinations, incidents, heartbeats] = await Promise.all([
    db.ghlLiveDeliveryRun.count(),
    db.ghlLiveDeliveryStepRun.count(),
    db.ghlAssociationDispatchOutbox.count(),
    db.companySheetsDeliveryJob.count(),
    db.companySheetsDeliveryRow.count(),
    db.companySheetsDispatchIntent.count(),
    db.sourceLeadEvent.count(),
    db.clientGhlDestination.count(),
    db.deliveryHealthIncident.count(),
    db.deliveryHealthMonitorHeartbeat.count(),
  ]);
  return { runs, steps, outbox, jobs, rows, intents, leads, destinations, incidents, heartbeats };
}

async function redisKeys() {
  return (await redis.keys("*")).sort();
}

test("the read-only transaction rejects writes on the server and leaks no session settings", { skip: !enabled }, async () => {
  assertSafeTestDatabaseUrl(integrationUrl);
  const stamp = `ro_${Date.now()}`;
  const clientAccountId = `diag_${stamp}_x`;
  await assert.rejects(
    withReadOnlyDb(db, (tx) =>
      tx.clientAccount.create({ data: { clientAccountId, clientDisplayName: "never written", status: "active" } })
    ),
    /read-only transaction/i
  );
  await assert.rejects(
    withReadOnlyDb(db, (tx) => tx.$executeRaw`DELETE FROM "ClientAccount" WHERE "clientAccountId" = ${clientAccountId}`),
    /read-only transaction/i
  );
  await assert.rejects(
    withReadOnlyDb(db, (tx) => tx.$queryRaw`SELECT "clientAccountId" FROM "ClientAccount" LIMIT 1 FOR UPDATE`),
    /read-only transaction/i
  );
  assert.equal(await db.clientAccount.count({ where: { clientAccountId } }), 0);

  const inside = await withReadOnlyDb(db, async (tx) => {
    const [row] = await tx.$queryRaw<Array<{ statement_timeout: string; ro: string }>>`
      SELECT current_setting('statement_timeout') AS statement_timeout, current_setting('transaction_read_only') AS ro`;
    return row;
  });
  assert.equal(inside?.ro, "on");
  assert.equal(inside?.statement_timeout, "8s");

  const [after] = await db.$queryRaw<Array<{ statement_timeout: string; ro: string }>>`
    SELECT current_setting('statement_timeout') AS statement_timeout, current_setting('transaction_read_only') AS ro`;
  assert.equal(after?.ro, "off");
  assert.notEqual(after?.statement_timeout, "8s");
  await db.clientAccount.create({ data: { clientAccountId, clientDisplayName: "normal write still works", status: "active" } });
  await db.clientAccount.delete({ where: { clientAccountId } });
});

test(
  "diagnostics classify incident-shaped data, return no consumer fields, and change nothing",
  { skip: !enabled },
  async () => {
    assertSafeTestDatabaseUrl(integrationUrl);
    const stamp = `d${Date.now()}`;
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = async (input) => {
      fetches += 1;
      throw new Error(`diagnostics called the network: ${String(input)}`);
    };
    const previousKey = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = KEY;
    const webhookQueue = new Queue(EXTERNAL_WEBHOOK_DELIVERY_QUEUE, { connection: redis });
    let seededJobId: string | undefined;
    const app = Fastify();
    try {
      const partial = await seed({
        stamp,
        suffix: "partial",
        destination: { policy: { lalAiBot1VetWebform: true }, opportunityCreationEnabled: true },
        run: { status: "partial_success", steps: [contactStep(1), tagStep(2), workflowSkipped(3), ownerFailed(4)] },
      });
      const failedOpp = await seed({
        stamp,
        suffix: "oppfail",
        destination: { opportunityCreationEnabled: true, workflowStartRequired: false },
        run: {
          status: "failed",
          steps: [contactStep(1), tagStep(2), { ...opportunityFailed(3) }],
          recordedWorkflowStartRequired: false,
        },
      });
      const clean = await seed({
        stamp,
        suffix: "clean",
        run: { status: "succeeded", steps: [contactStep(1), tagStep(2), workflowCompleted(3)] },
      });
      const shadow = await seed({ stamp, suffix: "shadow", destination: { deliveryMode: "shadow" } });
      const overdue = await seed({
        stamp,
        suffix: "overdue",
        outboxStatus: "pending",
        availableAt: new Date(Date.now() - HOUR),
      });
      const sheets = await seedSheets(stamp);
      seededJobId = (await webhookQueue.add("diag-probe", { probe: true }, { jobId: `probe_${stamp}` })).id;
      await new Promise((resolve) => setTimeout(resolve, 50));

      await app.register(adminDeliveryDiagnosticsRoutes, { prefix: "/admin/v1", readQueue: bullQueueReader(redis) });
      const headers = { [ADMIN_KEY_HEADER]: KEY };
      const get = async (url: string) => app.inject({ method: "GET", url: `/admin/v1${url}`, headers });

      const countsBefore = await tableCounts();
      const keysBefore = await redisKeys();

      const partialDetail = await get(`/delivery-diagnostics/ghl-runs/${partial.runId}`);
      assert.equal(partialDetail.statusCode, 200);
      const detail = partialDetail.json();
      assert.equal(detail.run.status, "partial_success");
      assert.equal(detail.contact.status, "succeeded");
      assert.equal(detail.contact.externalId, "contact_1");
      assert.equal(detail.workflow.status, "skipped");
      assert.equal(detail.workflow.attempted, false);
      assert.equal(detail.workflow.requiredRecorded, true);
      assert.equal(detail.verdict.contactReceived, true);
      assert.equal(detail.verdict.canonical, false);
      assert.equal(detail.retry.disposition, "hold");
      assert.equal(detail.destinationConfig.workflowId, "wf_diag");
      assert.equal(detail.destinationConfig.lalAiBot1VetWebform, true);
      assert.equal(detail.destinationConfig.opportunityStepExpected, false);
      assert.equal(detail.opportunity.stepPresent, false);
      assert.deepEqual(detail.evidence, { storedBodiesReturned: false, consumerFieldsReturned: false, externalCallsMade: false });

      const failedDetail = (await get(`/delivery-diagnostics/ghl-runs/${failedOpp.runId}`)).json();
      assert.equal(failedDetail.opportunity.status, "failed");
      assert.equal(failedDetail.opportunity.httpStatus, 422);
      assert.equal(failedDetail.opportunity.errorCode, "http_422");
      assert.equal(failedDetail.opportunity.stepExpectedByDestination, true);

      const list = (await get(`/delivery-diagnostics/ghl-runs?status=failed&clientAccountId=${failedOpp.clientAccountId}`)).json();
      assert.equal(list.items.length, 1);
      assert.equal(list.items[0].id, failedOpp.runId);
      assert.equal(list.nextCursor, null);

      const summaryOf = async (clientAccountId: string) => {
        const response = await get(`/delivery-diagnostics/summary?window=24h&clientAccountId=${clientAccountId}`);
        assert.equal(response.statusCode, 200);
        return response.json();
      };

      const partialSummary = await summaryOf(partial.clientAccountId);
      assert.equal(partialSummary.ghl.available, true);
      assert.equal(partialSummary.ghl.data.windowFlow.intendedDeliveries, 1);
      assert.equal(partialSummary.ghl.data.windowFlow.byClass.contact_delivered_required_workflow_incomplete, 1);
      assert.equal(partialSummary.ghl.data.windowFlow.verifiedContactFulfillment, 1);
      assert.equal(partialSummary.ghl.data.windowFlow.canonicalDeliveries, 0);
      assert.equal(partialSummary.ghl.data.windowFlow.requiredWorkflow.incomplete, 1);
      assert.equal(partialSummary.ghl.data.windowFlow.optionalWarnings.byStepType.assign_owner, 1);
      assert.ok(partialSummary.attention.some((entry: { kind: string }) => entry.kind === "required_workflow_incomplete"));

      const oppSummary = await summaryOf(failedOpp.clientAccountId);
      assert.equal(oppSummary.ghl.data.windowFlow.byClass.terminal_required_step_failure, 1);
      assert.equal(oppSummary.ghl.data.windowFlow.terminalRequiredStepFailures, 1);
      assert.equal(oppSummary.ghl.data.attention[0].failedRequiredSteps[0].stepType, "create_or_update_opportunity");

      const cleanSummary = await summaryOf(clean.clientAccountId);
      assert.equal(cleanSummary.ghl.data.windowFlow.byClass.delivered_complete, 1);
      assert.equal(cleanSummary.ghl.data.windowFlow.canonicalDeliveries, 1);
      assert.equal(cleanSummary.ghl.data.lastContactStepSucceededAt !== null, true);

      const shadowSummary = await summaryOf(shadow.clientAccountId);
      assert.equal(shadowSummary.ghl.data.windowFlow.byClass.intentional_non_delivery, 1);
      assert.equal(shadowSummary.ghl.data.windowFlow.intentionalNonDelivery.shadow, 1);
      assert.equal(shadowSummary.ghl.data.windowFlow.terminalRequiredStepFailures, 0);
      assert.equal(shadowSummary.ghl.data.attention.length, 0);

      const overdueSummary = await summaryOf(overdue.clientAccountId);
      assert.equal(overdueSummary.ghl.data.windowFlow.byClass.pending_overdue, 1);
      assert.equal(overdueSummary.ghl.data.openWork.pending, 1);
      assert.ok(overdueSummary.ghl.data.openWork.oldestPendingAgeSeconds >= 3500);

      const sheetsSummary = await summaryOf(sheets.clientAccountId);
      assert.equal(sheetsSummary.sheets.available, true);
      const sheetsData = sheetsSummary.sheets.data;
      assert.equal(sheetsData.windowFlow.intentsByStatus.pending, 1);
      assert.equal(sheetsData.windowFlow.expectedHolds, 1);
      assert.equal(sheetsData.receipts.verifiedWithDurableRows, 0);
      assert.equal(sheetsData.receipts.missingProof, 1);
      assert.equal(sheetsData.openWork.retryableJobs, 1);
      assert.equal(sheetsData.openWork.uncertainJobs, 1);
      assert.equal(sheetsData.openWork.maxJobAttemptCount, 3);
      assert.equal(sheetsData.openWork.errorCodes.http_429, 1);
      assert.ok(sheetsData.openWork.oldestPendingIntentAgeSeconds >= 3 * 3600 - 60);
      assert.equal(sheetsData.lastSuccessfulDeliveryAt, null);
      assert.ok(sheetsSummary.sheets.monitorPreview);
      assert.ok(sheetsSummary.attention.some((entry: { kind: string }) => entry.kind === "succeeded_job_missing_durable_rows"));

      const campaignScoped = await get(
        `/delivery-diagnostics/summary?window=7d&clientAccountId=${partial.clientAccountId}&campaignId=camp_${stamp}`
      );
      assert.equal(campaignScoped.statusCode, 200);
      assert.equal(campaignScoped.json().ghl.data.windowFlow.intendedDeliveries, 1);
      const otherCampaign = (await get(`/delivery-diagnostics/summary?campaignId=camp_none_${stamp}`)).json();
      assert.equal(otherCampaign.ghl.data.windowFlow.intendedDeliveries, 0);
      assert.equal(otherCampaign.intake.data.totals.received, 0);

      const full = await get("/delivery-diagnostics/summary?window=24h");
      assert.equal(full.statusCode, 200);
      const fullJson = full.json();
      assert.equal(fullJson.infrastructure.available, true);
      assert.equal(fullJson.infrastructure.data.postgres.ok, true);
      assert.equal(fullJson.infrastructure.data.valkey.ok, true);
      const webhook = fullJson.infrastructure.data.queues.find(
        (queue: { queue: string }) => queue.queue === EXTERNAL_WEBHOOK_DELIVERY_QUEUE
      );
      assert.equal(webhook.available, true);
      assert.ok(webhook.waiting >= 1);
      assert.ok(webhook.oldestWaitingAt);
      assert.equal(fullJson.intake.available, true);
      assert.ok(fullJson.intake.data.totals.received >= 5);
      assert.equal(fullJson.readOnly, true);
      assert.ok(fullJson.coverage.length >= 5);

      const everything = [
        partialDetail.body,
        JSON.stringify(failedDetail),
        JSON.stringify(list),
        JSON.stringify(partialSummary),
        JSON.stringify(oppSummary),
        JSON.stringify(sheetsSummary),
        full.body,
      ].join("\n");
      for (const secret of [PII_EMAIL, PII_PHONE, PII_NAME, "pii.consumer", "normalizedPayloadJson", "rawPayloadJson", "vetOperationReceipt", "accessToken"]) {
        assert.equal(everything.includes(secret), false, `response leaked ${secret}`);
      }

      assert.deepEqual(await tableCounts(), countsBefore);
      assert.deepEqual(await redisKeys(), keysBefore);
      assert.equal(fetches, 0);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousKey === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = previousKey;
      await app.close();
      if (seededJobId) await webhookQueue.remove(seededJobId).catch(() => undefined);
      await webhookQueue.close();
      await cleanup(stamp);
    }
  }
);

const CLI = fileURLToPath(new URL("../../../../../scripts/delivery-diagnostics.readonly.mjs", import.meta.url));

function runCli(args: string[], env: Record<string, string>) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8", timeout: 30_000 },
      (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : error ? 1 : 0;
        resolve({ status: code, stdout, stderr });
      }
    );
  });
}

test("the operator CLI reads a seeded run over HTTP with the key from the environment only", { skip: !enabled }, async () => {
  assertSafeTestDatabaseUrl(integrationUrl);
  const stamp = `cli${Date.now()}`;
  const previousKey = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = KEY;
  const app = Fastify();
  try {
    const partial = await seed({
      stamp,
      suffix: "partial",
      destination: { policy: { lalAiBot1VetWebform: true } },
      run: { status: "partial_success", steps: [contactStep(1), tagStep(2), workflowSkipped(3), ownerFailed(4)] },
    });
    await app.register(adminDeliveryDiagnosticsRoutes, { prefix: "/admin/v1", readQueue: bullQueueReader(redis) });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;

    const ok = await runCli(["run", partial.runId!, "--base-url", base], { SA360_ADMIN_KEY: KEY });
    assert.equal(ok.status, 0, ok.stderr);
    const body = JSON.parse(ok.stdout);
    assert.equal(body.run.status, "partial_success");
    assert.equal(body.workflow.status, "skipped");
    assert.equal(ok.stdout.includes(PII_EMAIL), false);
    assert.equal(ok.stdout.includes(KEY), false);

    const list = await runCli(["runs", "--client", partial.clientAccountId, "--base-url", base], { SA360_ADMIN_KEY: KEY });
    assert.equal(list.status, 0, list.stderr);
    assert.equal(JSON.parse(list.stdout).items[0].id, partial.runId);

    const wrongKey = await runCli(["run", partial.runId!, "--base-url", base], { SA360_ADMIN_KEY: "wrong" });
    assert.equal(wrongKey.status, 1);
    assert.equal(JSON.parse(wrongKey.stdout).error, "Unauthorized");

    const keyArg = await runCli(["summary", "--admin-key", KEY, "--base-url", base], {});
    assert.equal(keyArg.status, 2);
    assert.equal(keyArg.stderr.includes(KEY), false);

    const plainHttp = await runCli(["summary", "--base-url", "http://sa360.example.test"], { SA360_ADMIN_KEY: KEY });
    assert.equal(plainHttp.status, 2);
    assert.match(plainHttp.stderr, /https/);

    const noKey = await runCli(["summary", "--base-url", base], {});
    assert.equal(noKey.status, 2);

    const badId = await runCli(["run", "bad id;drop", "--base-url", base], { SA360_ADMIN_KEY: KEY });
    assert.equal(badId.status, 2);
  } finally {
    if (previousKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousKey;
    await app.close();
    await cleanup(stamp);
  }
});
