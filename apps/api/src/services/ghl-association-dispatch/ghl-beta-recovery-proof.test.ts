/**
 * Local proof for the beta GHL location path.
 * A fake provider counts every contact write and workflow enrollment.
 * Crashes are injected after GHL accepts and before step receipts are stored.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { prisma } from "../../lib/db.js";
import { ROUTING_AUTHORITY_SOURCE_ASSOCIATION } from "../routing-source-association.service.js";
import { deliverConfirmedAssociationIfActivated } from "../association-ongoing-delivery.js";
import { markGhlLiveDeliveryRunRolledBack } from "../ghl-delivery-adapter/ghl-live-canary.service.js";
import {
  ASSOCIATION_DISPATCH_LEASE_MS,
  claimPendingAssociationOutbox,
  processDueGhlAssociationDispatches,
  recordGhlAssociationDispatchOutbox,
  settleGhlAssociationDispatchFromResult,
  type AssociationDispatchRecovery,
} from "./ghl-association-dispatch.js";
import { ongoingRunDisposition } from "../ghl-destination-authorization.js";
import { receiptFromPersistedStep } from "../ghl-delivery-adapter/vet-ghl-delivery-contract.js";
import { canonicalGhlDelivery, ghlContactReceived } from "../delivery-success/canonical-delivery.js";
import { getLeadDeliveryReadModelById } from "../lead-delivery/lead-delivery-read.service.js";
import { presentLeadDeliveryDetail } from "../lead-delivery/lead-delivery-present.service.js";

const CUSTOMER_MILESTONES = new Set([
  "source_lead_received",
  "lead_delivered",
  "first_touch_sent",
  "contact_replied",
  "appointment_set",
  "appointment_showed",
  "sold",
]);

const PORTAL_LABELS: Record<string, string> = {
  delivered: "Delivered",
  failed: "Failed",
  skipped: "Skipped",
  pending: "Pending",
  not_started: "Not started",
  partial: "In progress",
  simulated: "In progress",
  in_progress: "In progress",
  lead_delivered: "Delivered",
  client_contact_created: "Contact created",
  lead_delivery_started: "Delivery started",
};

function portalDeliveryStatusLabel(status: string): string {
  return PORTAL_LABELS[status] ?? status;
}

/** Same customer filter as portalCustomerLastEvent: snake_case events outside the customer set are hidden. */
function portalCustomerLastEvent(lastEvent: string | null | undefined): string | null {
  const trimmed = lastEvent?.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  if (/^[a-z]+(_[a-z0-9]+)+$/.test(key) && !CUSTOMER_MILESTONES.has(key)) return null;
  return PORTAL_LABELS[key] ?? trimmed;
}

const integrationUrl = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const enabled = Boolean(integrationUrl);

const WORKFLOW_ID = "wf_beta_recovery_proof";
const SHARED_FIELD = "fieldSharedBeta01";

type Provider = {
  contacts: Array<{ id: string; email: string | null }>;
  enrollments: Array<{ id: string; contactId: string; workflowId: string }>;
  contactWrites: number;
  enrollmentCalls: number;
  otherCalls: string[];
  workflowHttpStatus: number;
  contactPutHttpStatus: number;
};

async function listen(state: Provider): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const path = req.url?.split("?")[0] ?? "/";
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? (JSON.parse(raw) as { email?: string }) : {};
    if (method === "POST" && path.endsWith("/contacts/upsert")) {
      state.contactWrites += 1;
      const id = `contact_${state.contacts.length + 1}`;
      state.contacts.push({ id, email: body.email ?? null });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ contact: { id } }));
      return;
    }
    const enrollment = path.match(/\/contacts\/([^/]+)\/workflow\/([^/]+)$/);
    if (method === "POST" && enrollment) {
      state.enrollmentCalls += 1;
      if (state.workflowHttpStatus !== 200) {
        res.writeHead(state.workflowHttpStatus, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "workflow not accepted" }));
        return;
      }
      const id = `enrollment_${state.enrollments.length + 1}`;
      state.enrollments.push({
        id,
        contactId: decodeURIComponent(enrollment[1]!),
        workflowId: decodeURIComponent(enrollment[2]!),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ enrollmentId: id }));
      return;
    }
    if (method === "PUT" && /\/contacts\/[^/]+$/.test(path)) {
      state.otherCalls.push(`${method} ${path}`);
      res.writeHead(state.contactPutHttpStatus, { "content-type": "application/json" });
      res.end(JSON.stringify(state.contactPutHttpStatus === 200 ? { contact: { id: "owner_ok" } } : { message: "owner rejected" }));
      return;
    }
    state.otherCalls.push(`${method} ${path}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake GHL did not bind");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function provider(): Provider {
  return {
    contacts: [],
    enrollments: [],
    contactWrites: 0,
    enrollmentCalls: 0,
    otherCalls: [],
    workflowHttpStatus: 200,
    contactPutHttpStatus: 200,
  };
}

type Crash = { event: string | null; commit: boolean; blockReceiptWrite: boolean };

function installCrash(crash: Crash) {
  const originalCreate = prisma.lifecycleEvent.create.bind(prisma.lifecycleEvent);
  const originalUpdate = prisma.ghlLiveDeliveryRun.update.bind(prisma.ghlLiveDeliveryRun);
  const patchedCreate = async (args: Prisma.LifecycleEventCreateArgs) => {
    const name = String(args.data.eventNameInternal ?? "");
    if (crash.event && name === crash.event) {
      if (crash.commit) await originalCreate(args);
      throw new Error(`stop_before_receipt:${name}`);
    }
    return originalCreate(args);
  };
  const patchedUpdate = async (args: Prisma.GhlLiveDeliveryRunUpdateArgs) => {
    if (crash.blockReceiptWrite && args.data.stepRuns) throw new Error("stop_before_receipt:steps");
    return originalUpdate(args);
  };
  (prisma.lifecycleEvent as unknown as { create: typeof patchedCreate }).create = patchedCreate;
  (prisma.ghlLiveDeliveryRun as unknown as { update: typeof patchedUpdate }).update = patchedUpdate;
  return () => {
    (prisma.lifecycleEvent as unknown as { create: typeof originalCreate }).create = originalCreate;
    (prisma.ghlLiveDeliveryRun as unknown as { update: typeof originalUpdate }).update = originalUpdate;
  };
}

function payload(clientAccountId: string, locationId: string, leadUid: string) {
  return {
    schema_version: "1.0",
    client_account_id: clientAccountId,
    subaccount_id_ghl: locationId,
    contact: {
      lead_uid: leadUid,
      first_name: "Alex",
      last_name: "Gross",
      email: `${leadUid}@example.test`,
      phone_e164: "+15555550111",
    },
    state: { routing_status: "matched", lifecycle_stage: "NEW" },
    event: {
      event_uuid: `evt_${leadUid}`,
      event_name_internal: "lead_created",
      event_name_meta: "lead_created",
      send_to_meta: false,
    },
  };
}

async function seed(input: {
  stamp: string;
  suffix: string;
  fieldMap: Record<string, string>;
  workflowStartRequired?: boolean;
  ownerId?: string | null;
}) {
  const clientAccountId = `alex_gross_${input.stamp}_${input.suffix}`;
  const locationId = `loc_${input.stamp}_${input.suffix}`;
  const leadUid = `lead_${input.stamp}_${input.suffix}`;
  const db = prisma as PrismaClient;
  await db.clientAccount.create({
    data: { clientAccountId, clientDisplayName: "Alex Gross", status: "active" },
  });
  await db.clientGhlDestination.create({
    data: {
      clientAccountId,
      destinationSubaccountIdGhl: locationId,
      locationName: "Alex Gross CRM",
      destinationWorkflowIdGhl: WORKFLOW_ID,
      workflowTriggerMode: "direct_api",
      workflowStartRequired: input.workflowStartRequired !== false,
      defaultAssignedUserIdGhl: input.ownerId ?? null,
      opportunityCreationEnabled: false,
      deliveryMode: "live",
      deliveryEnabled: true,
      clientCutoverApproved: true,
      internalApprovalStatus: "approved",
      ghlConnectionStatus: "connected",
      sa360CustomFieldIdMapJson: input.fieldMap,
    },
  });
  await db.ghlLocationConnection.create({
    data: {
      clientAccountId,
      locationId,
      locationName: "Alex Gross CRM",
      accessTokenEncrypted: "not-a-real-token",
      refreshTokenEncrypted: "not-a-real-token",
      tokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      connectionStatus: "connected",
      authMode: "oauth",
    },
  });
  const decision = await db.routingDryRunDecision.create({
    data: {
      masterClientAccountId: "lal_master_vet",
      sourceLeadUid: leadUid,
      matched: true,
      matchedRuleId: null,
      confidence: "confirmed_source",
      matchReason: "Confirmed parent URL association",
      destinationClientAccountId: clientAccountId,
      destinationSubaccountIdGhl: locationId,
      routingEventNameInternal: "routing_matched",
      attributionSnapshot: { routingAuthority: ROUTING_AUTHORITY_SOURCE_ASSOCIATION },
    },
  });
  const body = payload(clientAccountId, locationId, leadUid);
  const source = await db.sourceLeadEvent.create({
    data: {
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceType: "webhook",
      sourceLeadUid: leadUid,
      clientAccountIdResolved: clientAccountId,
      destinationLocationIdResolved: locationId,
      status: "routing_matched",
      rawPayloadJson: body,
      normalizedPayloadJson: body,
      routingResultJson: { matched: true, routingAuthority: ROUTING_AUTHORITY_SOURCE_ASSOCIATION },
      routingDryRunDecisionId: decision.id,
      routedAt: new Date(),
    },
  });
  const routing = {
    matched: true,
    routingAuthority: ROUTING_AUTHORITY_SOURCE_ASSOCIATION,
    routingDryRunDecisionId: decision.id,
    destinationClientAccountId: clientAccountId,
    destinationLocationIdGhl: locationId,
  };
  await recordGhlAssociationDispatchOutbox(
    { sourceLeadEventId: source.id, status: "routing_matched", routing, resolvedAt: new Date(Date.now() - 60_000) },
    db
  );
  return { clientAccountId, locationId, leadUid, sourceId: source.id, decisionId: decision.id, routing, body };
}

async function snapshot(sourceId: string, ghl: Provider) {
  const run = await prisma.ghlLiveDeliveryRun.findFirst({
    where: { routingDryRunDecisionId: (await prisma.sourceLeadEvent.findUnique({ where: { id: sourceId } }))?.routingDryRunDecisionId ?? "" },
    include: { stepRuns: { orderBy: { stepOrder: "asc" } } },
  });
  const outbox = await prisma.ghlAssociationDispatchOutbox.findFirst({ where: { sourceLeadEventId: sourceId } });
  const events = await prisma.lifecycleEvent.findMany({
    where: { leadUid: (await prisma.sourceLeadEvent.findUnique({ where: { id: sourceId } }))?.sourceLeadUid ?? "" },
    orderBy: { receivedAt: "asc" },
    select: { eventNameInternal: true, contactIdGhl: true },
  });
  const receipts = (run?.stepRuns ?? []).map((step) => ({
    stepType: step.stepType,
    status: step.status,
    externalId: step.externalId,
    receipt: receiptFromPersistedStep(step),
  }));
  const ctx = await getLeadDeliveryReadModelById(sourceId);
  const detail = ctx ? presentLeadDeliveryDetail(ctx, "client") : null;
  const destination = run
    ? await prisma.clientGhlDestination.findUnique({ where: { clientAccountId: run.destinationClientAccountId } })
    : null;
  const canonical = run
    ? canonicalGhlDelivery({
        run: {
          id: run.id,
          mode: run.mode,
          status: run.status,
          completedAt: run.completedAt,
          destinationClientAccountId: run.destinationClientAccountId,
          idempotencyKey: run.idempotencyKey,
        },
        steps: run.stepRuns.map((step) => ({
          stepType: step.stepType,
          status: step.status,
          externalId: step.externalId,
          errorCode: step.errorCode,
          responseRedactedJson: step.responseRedactedJson,
        })),
        destination: destination
          ? {
              clientAccountId: destination.clientAccountId,
              workflowStartRequired: destination.workflowStartRequired,
            }
          : null,
        outbox: outbox
          ? {
              status: outbox.status,
              clientAccountId: outbox.clientAccountId,
              sourceLeadEventId: outbox.sourceLeadEventId,
              liveRunId: outbox.liveRunId,
              externalCallExecuted: outbox.externalCallExecuted,
              lastError: outbox.lastError,
            }
          : null,
        opportunityConfigured: false,
        onboardingTestAttemptKeys: [],
        onboardingProfileNotesEnabled: false,
        intakeSummaryNotesEnabled: false,
      })
    : null;
  const received = run
    ? ghlContactReceived({
        run: {
          id: run.id,
          mode: run.mode,
          status: run.status,
          completedAt: run.completedAt,
          destinationClientAccountId: run.destinationClientAccountId,
          destinationSubaccountIdGhl: run.destinationSubaccountIdGhl,
          idempotencyKey: run.idempotencyKey,
        },
        steps: run.stepRuns.map((step) => ({
          stepType: step.stepType,
          status: step.status,
          externalId: step.externalId,
          errorCode: step.errorCode,
          responseRedactedJson: step.responseRedactedJson,
        })),
        destination: destination
          ? { clientAccountId: destination.clientAccountId, locationIdGhl: destination.destinationSubaccountIdGhl }
          : null,
        outbox: outbox
          ? {
              status: outbox.status,
              clientAccountId: outbox.clientAccountId,
              sourceLeadEventId: outbox.sourceLeadEventId,
              destinationLocationIdGhl: outbox.destinationLocationIdGhl,
              liveRunId: outbox.liveRunId,
            }
          : null,
        sourceLead: {
          id: sourceId,
          bulkImportId: null,
          bulkImportRowId: null,
          sourceType: "webhook",
        },
        onboardingTestAttemptKeys: [],
      })
    : null;
  return {
    provider: {
      contactWrites: ghl.contactWrites,
      contacts: ghl.contacts.map((row) => row.id),
      enrollmentCalls: ghl.enrollmentCalls,
      enrollments: ghl.enrollments.map((row) => row.id),
      otherCalls: ghl.otherCalls,
    },
    run: run
      ? {
          id: run.id,
          status: run.status,
          summary: run.summary,
          errors: run.errors,
          disposition: ongoingRunDisposition(run),
        }
      : null,
    receipts,
    outbox: outbox
      ? {
          status: outbox.status,
          outcome: outbox.outcome,
          externalCallExecuted: outbox.externalCallExecuted,
          lastError: outbox.lastError,
          attemptCount: outbox.attemptCount,
        }
      : null,
    lifecycle: events,
    alex: detail
      ? {
          deliveryStatus: detail.deliveryStatus,
          deliveryLabel: portalDeliveryStatusLabel(detail.deliveryStatus),
          lastEventName: detail.lastEventName,
          customerLastEvent: portalCustomerLastEvent(detail.lastEventName),
          ghlContactStatus: detail.ghlContactStatus,
          contactIdGhl: detail.contactIdGhl,
          workflowStarted: detail.workflowStarted,
          liveRunStatus: detail.delivery.liveRunStatus,
        }
      : null,
    canonical: canonical ? { canonical: canonical.canonical, reasons: canonical.reasons } : null,
    contactReceived: received ? { received: received.received, reasons: received.reasons, contactId: received.contactId } : null,
  };
}

async function deliver(seeded: Awaited<ReturnType<typeof seed>>) {
  const claim = await claimPendingAssociationOutbox(seeded.sourceId);
  const result = await deliverConfirmedAssociationIfActivated({
    sourceLeadEventId: seeded.sourceId,
    status: "routing_matched",
    routing: seeded.routing,
    lifecyclePayload: seeded.body as never,
  });
  await settleGhlAssociationDispatchFromResult(seeded.sourceId, result);
  return { claim, result };
}

async function retryDrain(seeded: Awaited<ReturnType<typeof seed>>) {
  const row = await prisma.ghlAssociationDispatchOutbox.findFirst({ where: { sourceLeadEventId: seeded.sourceId } });
  if (!row) return { recovery: "missing" as const, drain: null };
  const aged = new Date(Date.now() - ASSOCIATION_DISPATCH_LEASE_MS - 5_000);
  if (row.status === "executing") {
    await prisma.ghlAssociationDispatchOutbox.update({ where: { id: row.id }, data: { executingAt: aged } });
  }
  const fresh = await prisma.ghlAssociationDispatchOutbox.findUnique({ where: { id: row.id } });
  const run = await prisma.ghlLiveDeliveryRun.findFirst({
    where: { routingDryRunDecisionId: seeded.decisionId },
    orderBy: { startedAt: "desc" },
    include: { stepRuns: true },
  });
  let recovery: AssociationDispatchRecovery | "missing" | "seen" = "missing";
  const drain = await processDueGhlAssociationDispatches({
    listDue: async () =>
      fresh
        ? [
            {
              id: fresh.id,
              status: fresh.status === "executing" ? "executing" : fresh.status,
              sourceLeadEventId: fresh.sourceLeadEventId,
              clientAccountId: fresh.clientAccountId,
              routingDryRunDecisionId: fresh.routingDryRunDecisionId,
              destinationLocationIdGhl: fresh.destinationLocationIdGhl,
              executingAt: fresh.status === "executing" ? aged : fresh.executingAt,
            },
          ]
        : [],
    claim: async (item, now) => {
      const claimed = await prisma.ghlAssociationDispatchOutbox.updateMany({
        where:
          item.status === "executing"
            ? { id: item.id, status: "executing", executingAt: { lt: new Date(now.getTime() - ASSOCIATION_DISPATCH_LEASE_MS) } }
            : { id: item.id, status: "pending" },
        data: { status: "executing", executingAt: now, attemptCount: { increment: 1 } },
      });
      return claimed.count === 1;
    },
    findRun: async () => {
      const current = await prisma.ghlLiveDeliveryRun.findFirst({
        where: { routingDryRunDecisionId: seeded.decisionId },
        orderBy: { startedAt: "desc" },
        include: { stepRuns: { select: { errorCode: true, responseRedactedJson: true, stepType: true, status: true, externalId: true } } },
      });
      if (!current) return null;
      recovery = "seen";
      return {
        id: current.id,
        status: current.status,
        stepRuns: current.stepRuns.map((step) => ({
          errorCode: step.errorCode,
          responseRedactedJson: step.responseRedactedJson,
        })),
      };
    },
    deliver: async () =>
      deliverConfirmedAssociationIfActivated({
        sourceLeadEventId: seeded.sourceId,
        status: "routing_matched",
        routing: seeded.routing,
        lifecyclePayload: seeded.body as never,
      }),
    settle: async (id, data) => {
      await prisma.ghlAssociationDispatchOutbox.update({
        where: { id },
        data: { ...data, settledAt: data.status === "settled" ? new Date() : null },
      });
    },
  });
  void run;
  return { recovery, drain };
}

async function cleanup(seeded: Awaited<ReturnType<typeof seed>>) {
  await prisma.ghlAssociationDispatchOutbox.deleteMany({ where: { sourceLeadEventId: seeded.sourceId } });
  await prisma.lifecycleEvent.deleteMany({ where: { leadUid: seeded.leadUid } });
  await prisma.sourceLeadEvent.deleteMany({ where: { id: seeded.sourceId } });
  await prisma.routingDryRunDecision.deleteMany({ where: { id: seeded.decisionId } }).catch(() => undefined);
  await prisma.ghlLocationConnection.deleteMany({ where: { locationId: seeded.locationId } });
  await prisma.clientAccount.deleteMany({ where: { clientAccountId: seeded.clientAccountId } });
}

test("beta GHL crash-before-receipt recovery", { skip: !enabled }, async () => {
  assertSafeTestDatabaseUrl(integrationUrl);
  process.env.SA360_GHL_ONGOING_DELIVERY_ENABLED = "true";
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "local-fake-ghl-token";
  process.env.GHL_API_BASE_URL = "https://ghl.invalid";
  const stamp = `${Date.now()}`;
  const reports: Record<string, unknown> = {};
  const case1 = provider();
  const case2 = provider();
  const fake1 = await listen(case1);
  const fake2 = await listen(case2);
  let seeded1: Awaited<ReturnType<typeof seed>> | null = null;
  let seeded2: Awaited<ReturnType<typeof seed>> | null = null;
  const crash: Crash = { event: null, commit: false, blockReceiptWrite: false };
  const restoreCrash = installCrash(crash);
  try {
    process.env.GHL_API_BASE_URL = fake1.baseUrl;
    seeded1 = await seed({ stamp, suffix: "contact", fieldMap: {} });
    crash.event = "client_contact_created";
    crash.commit = true;
    reports.case1Delivery = await deliver(seeded1);
    reports.case1AfterCrash = await snapshot(seeded1.sourceId, case1);
    crash.event = null;
    reports.case1Retry = await retryDrain(seeded1);
    reports.case1AfterRetry = await snapshot(seeded1.sourceId, case1);
    const directRetry = await deliverConfirmedAssociationIfActivated({
      sourceLeadEventId: seeded1.sourceId,
      status: "routing_matched",
      routing: seeded1.routing,
      lifecyclePayload: seeded1.body as never,
    });
    reports.case1DirectRetry = { outcome: directRetry.outcome, reason: directRetry.reason, externalCallExecuted: directRetry.externalCallExecuted };
    reports.case1AfterDirectRetry = await snapshot(seeded1.sourceId, case1);

    process.env.GHL_API_BASE_URL = fake2.baseUrl;
    seeded2 = await seed({
      stamp,
      suffix: "workflow",
      fieldMap: { sa360_lead_uid: SHARED_FIELD, sa360_lifecycle_stage: SHARED_FIELD },
    });
    crash.event = null;
    reports.case2First = await deliver(seeded2);
    reports.case2StoredContact = await snapshot(seeded2.sourceId, case2);
    await prisma.clientGhlDestination.update({
      where: { clientAccountId: seeded2.clientAccountId },
      data: { sa360CustomFieldIdMapJson: {} },
    });
    crash.event = null;
    crash.blockReceiptWrite = true;
    const outbox = await prisma.ghlAssociationDispatchOutbox.findFirst({ where: { sourceLeadEventId: seeded2.sourceId } });
    if (outbox && outbox.status !== "pending" && outbox.status !== "executing") {
      await prisma.ghlAssociationDispatchOutbox.update({
        where: { id: outbox.id },
        data: { status: "executing", executingAt: new Date(Date.now() - ASSOCIATION_DISPATCH_LEASE_MS - 5_000), settledAt: null },
      });
    }
    reports.case2EnrollmentCrash = await retryDrain(seeded2);
    reports.case2AfterEnrollmentCrash = await snapshot(seeded2.sourceId, case2);
    crash.event = null;
    if (outbox) {
      await prisma.ghlAssociationDispatchOutbox.update({
        where: { id: outbox.id },
        data: { status: "executing", executingAt: new Date(Date.now() - ASSOCIATION_DISPATCH_LEASE_MS - 5_000), settledAt: null },
      });
    }
    reports.case2RetryAgain = await retryDrain(seeded2);
    reports.case2AfterRetryAgain = await snapshot(seeded2.sourceId, case2);

    const afterContact = reports.case1AfterDirectRetry as {
      provider: { contactWrites: number; contacts: string[]; enrollmentCalls: number; enrollments: string[] };
      receipts: Array<{ receipt: { operation: string; outcome: string } | null }>;
      lifecycle: Array<{ eventNameInternal: string }>;
      alex: { customerLastEvent: string | null; deliveryLabel: string };
      canonical: { canonical: boolean };
      run: { status: string };
    };
    assert.equal(afterContact.provider.contactWrites, 1);
    assert.deepEqual(afterContact.provider.contacts, ["contact_1"]);
    assert.equal(afterContact.provider.enrollmentCalls, 0);
    assert.deepEqual(afterContact.provider.enrollments, []);
    assert.equal(afterContact.receipts.length, 0);
    assert.equal(afterContact.lifecycle.some((event) => event.eventNameInternal === "lead_delivered"), false);
    assert.notEqual(afterContact.alex.customerLastEvent, "Delivered");
    assert.equal(afterContact.canonical.canonical, false);
    assert.equal(afterContact.run.status, "executing");

    const storedContact = reports.case2StoredContact as {
      provider: { contactWrites: number; enrollmentCalls: number };
      contactReceived: { received: boolean; contactId: string | null };
      receipts: Array<{ stepType: string; receipt: { operation: string; outcome: string } | null }>;
    };
    assert.equal(storedContact.provider.contactWrites, 1);
    assert.equal(storedContact.provider.enrollmentCalls, 0);
    assert.equal(storedContact.contactReceived.received, true);
    assert.equal(storedContact.contactReceived.contactId, "contact_1");

    const afterEnrollment = reports.case2AfterRetryAgain as {
      provider: { contactWrites: number; contacts: string[]; enrollmentCalls: number; enrollments: string[] };
      receipts: Array<{ stepType: string; receipt: { operation: string; outcome: string; externalId: string | null } | null }>;
      lifecycle: Array<{ eventNameInternal: string }>;
      alex: { customerLastEvent: string | null };
      canonical: { canonical: boolean };
      run: { status: string };
    };
    assert.equal(afterEnrollment.provider.contactWrites, 1);
    assert.deepEqual(afterEnrollment.provider.contacts, ["contact_1"]);
    assert.equal(afterEnrollment.provider.enrollmentCalls, 1);
    assert.deepEqual(afterEnrollment.provider.enrollments, ["enrollment_1"]);
    const contactReceipt = afterEnrollment.receipts.find((step) => step.stepType === "create_or_update_contact");
    assert.equal(contactReceipt?.receipt?.outcome, "completed");
    assert.equal(contactReceipt?.receipt?.externalId, "contact_1");
    const workflowReceipt = afterEnrollment.receipts.find((step) => step.stepType === "start_workflow");
    assert.notEqual(workflowReceipt?.receipt?.outcome, "completed");
    assert.equal(afterEnrollment.lifecycle.some((event) => event.eventNameInternal === "lead_delivered"), false);
    assert.notEqual(afterEnrollment.alex.customerLastEvent, "Delivered");
    assert.equal(afterEnrollment.canonical.canonical, false);
    assert.equal(afterEnrollment.run.status, "executing");
  } finally {
    restoreCrash();
    await new Promise<void>((resolve) => fake1.server.close(() => resolve()));
    await new Promise<void>((resolve) => fake2.server.close(() => resolve()));
    if (seeded1) await cleanup(seeded1);
    if (seeded2) await cleanup(seeded2);
  }
});

type DeliveryView = Awaited<ReturnType<typeof snapshot>>;

function receiptOutcome(view: DeliveryView, stepType: string): string | null {
  return view.receipts.find((step) => step.stepType === stepType)?.receipt?.outcome ?? null;
}

test("required enrollment failure is not Delivered and recovery does not resend", { skip: !enabled }, async () => {
  assertSafeTestDatabaseUrl(integrationUrl);
  process.env.SA360_GHL_ONGOING_DELIVERY_ENABLED = "true";
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "local-fake-ghl-token";
  const stamp = `${Date.now()}`;
  const ghl = provider();
  const fake = await listen(ghl);
  process.env.GHL_API_BASE_URL = fake.baseUrl;
  const crash: Crash = { event: null, commit: false, blockReceiptWrite: false };
  const restoreCrash = installCrash(crash);
  const seeded: Array<Awaited<ReturnType<typeof seed>>> = [];
  const review: Record<string, unknown> = {};
  try {
    ghl.workflowHttpStatus = 500;
    const ambiguous = await seed({ stamp, suffix: "wf500", fieldMap: {} });
    seeded.push(ambiguous);
    await deliver(ambiguous);
    const ambiguousView = await snapshot(ambiguous.sourceId, ghl);
    review.requiredAmbiguous = {
      run: ambiguousView.run?.status,
      contact: receiptOutcome(ambiguousView, "create_or_update_contact"),
      workflow: receiptOutcome(ambiguousView, "start_workflow"),
      canonical: ambiguousView.canonical,
      leadDelivered: ambiguousView.lifecycle.some((event) => event.eventNameInternal === "lead_delivered"),
      alex: ambiguousView.alex,
      calls: ambiguousView.provider,
    };
    assert.equal(ambiguousView.run?.status, "failed");
    assert.equal(receiptOutcome(ambiguousView, "create_or_update_contact"), "completed");
    assert.equal(receiptOutcome(ambiguousView, "start_workflow"), "ambiguous");
    assert.equal(ambiguousView.canonical?.canonical, false);
    assert.equal(review.requiredAmbiguous && (review.requiredAmbiguous as { leadDelivered: boolean }).leadDelivered, false);
    assert.notEqual(ambiguousView.alex?.customerLastEvent, "Delivered");
    assert.notEqual(ambiguousView.alex?.deliveryLabel, "Delivered");
    assert.equal(ghl.contactWrites, 1);
    assert.equal(ghl.enrollmentCalls, 1);
    assert.equal(ghl.enrollments.length, 0);

    ghl.workflowHttpStatus = 422;
    ghl.contactWrites = 0;
    ghl.enrollmentCalls = 0;
    ghl.contacts.length = 0;
    ghl.enrollments.length = 0;
    const rejected = await seed({ stamp, suffix: "wf422", fieldMap: {} });
    seeded.push(rejected);
    await deliver(rejected);
    const rejectedView = await snapshot(rejected.sourceId, ghl);
    review.requiredRejected = {
      run: rejectedView.run?.status,
      contact: receiptOutcome(rejectedView, "create_or_update_contact"),
      workflow: receiptOutcome(rejectedView, "start_workflow"),
      canonical: rejectedView.canonical,
      leadDelivered: rejectedView.lifecycle.some((event) => event.eventNameInternal === "lead_delivered"),
      alex: rejectedView.alex,
      calls: { contactWrites: ghl.contactWrites, enrollmentCalls: ghl.enrollmentCalls, enrollments: ghl.enrollments.length },
    };
    assert.equal(rejectedView.run?.status, "failed");
    assert.equal(receiptOutcome(rejectedView, "start_workflow"), "rejected");
    assert.equal(rejectedView.canonical?.canonical, false);
    assert.equal(rejectedView.lifecycle.some((event) => event.eventNameInternal === "lead_delivered"), false);
    assert.notEqual(rejectedView.alex?.customerLastEvent, "Delivered");
    assert.notEqual(rejectedView.alex?.deliveryLabel, "Delivered");

    ghl.workflowHttpStatus = 200;
    ghl.contactPutHttpStatus = 500;
    ghl.contactWrites = 0;
    ghl.enrollmentCalls = 0;
    ghl.contacts.length = 0;
    ghl.enrollments.length = 0;
    const optional = await seed({ stamp, suffix: "owner", fieldMap: {}, ownerId: "user_owner_alex" });
    seeded.push(optional);
    await deliver(optional);
    const optionalView = await snapshot(optional.sourceId, ghl);
    review.optionalOwner = {
      run: optionalView.run?.status,
      contact: receiptOutcome(optionalView, "create_or_update_contact"),
      workflow: receiptOutcome(optionalView, "start_workflow"),
      owner: optionalView.receipts.find((step) => step.stepType === "assign_owner")?.status,
      canonical: optionalView.canonical,
      leadDelivered: optionalView.lifecycle.some((event) => event.eventNameInternal === "lead_delivered"),
      alex: optionalView.alex,
      calls: { contactWrites: ghl.contactWrites, enrollmentCalls: ghl.enrollmentCalls, enrollments: ghl.enrollments.length },
    };
    assert.equal(optionalView.run?.status, "partial_success");
    assert.equal(receiptOutcome(optionalView, "create_or_update_contact"), "completed");
    assert.equal(receiptOutcome(optionalView, "start_workflow"), "completed");
    assert.equal(optionalView.lifecycle.some((event) => event.eventNameInternal === "lead_delivered"), true);
    assert.equal(optionalView.canonical?.canonical, true, optionalView.canonical?.reasons.join(","));
    assert.equal(optionalView.alex?.deliveryLabel, "Delivered");
    assert.equal(optionalView.alex?.customerLastEvent, "Delivered");
    assert.equal(ghl.contactWrites, 1);
    assert.equal(ghl.enrollmentCalls, 1);
    assert.equal(ghl.enrollments.length, 1);

    ghl.contactPutHttpStatus = 200;
    ghl.contactWrites = 0;
    ghl.enrollmentCalls = 0;
    ghl.contacts.length = 0;
    ghl.enrollments.length = 0;
    crash.event = "lead_delivered";
    const missingEvent = await seed({ stamp, suffix: "event", fieldMap: {}, ownerId: "user_owner_alex" });
    seeded.push(missingEvent);
    await deliver(missingEvent);
    const beforeRetry = await snapshot(missingEvent.sourceId, ghl);
    const writesBefore = ghl.contactWrites;
    const enrollmentsBefore = ghl.enrollmentCalls;
    crash.event = null;
    await retryDrain(missingEvent);
    await deliverConfirmedAssociationIfActivated({
      sourceLeadEventId: missingEvent.sourceId,
      status: "routing_matched",
      routing: missingEvent.routing,
      lifecyclePayload: missingEvent.body as never,
    });
    const afterRetry = await snapshot(missingEvent.sourceId, ghl);
    review.missingDeliveredEvent = {
      before: beforeRetry.alex,
      after: afterRetry.alex,
      canonicalBefore: beforeRetry.canonical,
      run: afterRetry.run?.status,
      extraContactWrites: ghl.contactWrites - writesBefore,
      extraEnrollmentCalls: ghl.enrollmentCalls - enrollmentsBefore,
      leadDelivered: afterRetry.lifecycle.some((event) => event.eventNameInternal === "lead_delivered"),
    };
    assert.equal(beforeRetry.run?.status, "partial_success");
    assert.equal(receiptOutcome(beforeRetry, "start_workflow"), "completed");
    assert.equal(beforeRetry.lifecycle.some((event) => event.eventNameInternal === "lead_delivered"), false);
    assert.equal(beforeRetry.canonical?.canonical, true, beforeRetry.canonical?.reasons.join(","));
    assert.equal(beforeRetry.alex?.deliveryLabel, "Delivered");
    assert.equal(beforeRetry.alex?.customerLastEvent, "Delivered");
    assert.equal(ghl.contactWrites - writesBefore, 0);
    assert.equal(ghl.enrollmentCalls - enrollmentsBefore, 0);

    ghl.contactWrites = 0;
    ghl.enrollmentCalls = 0;
    ghl.contacts.length = 0;
    ghl.enrollments.length = 0;
    ghl.otherCalls.length = 0;
    const uncertain = await seed({
      stamp,
      suffix: "replay",
      fieldMap: { sa360_lead_uid: SHARED_FIELD, sa360_lifecycle_stage: SHARED_FIELD },
    });
    seeded.push(uncertain);
    await deliver(uncertain);
    await prisma.clientGhlDestination.update({
      where: { clientAccountId: uncertain.clientAccountId },
      data: { sa360CustomFieldIdMapJson: {} },
    });
    crash.blockReceiptWrite = true;
    await prisma.ghlAssociationDispatchOutbox.updateMany({
      where: { sourceLeadEventId: uncertain.sourceId },
      data: { status: "executing", executingAt: new Date(Date.now() - ASSOCIATION_DISPATCH_LEASE_MS - 5_000), settledAt: null },
    });
    await retryDrain(uncertain);
    crash.blockReceiptWrite = false;
    const afterCrash = await snapshot(uncertain.sourceId, ghl);
    await retryDrain(uncertain);
    await deliverConfirmedAssociationIfActivated({
      sourceLeadEventId: uncertain.sourceId,
      status: "routing_matched",
      routing: uncertain.routing,
      lifecyclePayload: uncertain.body as never,
    });
    if (afterCrash.run?.id) await markGhlLiveDeliveryRunRolledBack(afterCrash.run.id, "review");
    await deliverConfirmedAssociationIfActivated({
      sourceLeadEventId: uncertain.sourceId,
      status: "routing_matched",
      routing: uncertain.routing,
      lifecyclePayload: uncertain.body as never,
    });
    await prisma.ghlAssociationDispatchOutbox.updateMany({
      where: { sourceLeadEventId: uncertain.sourceId },
      data: { status: "executing", executingAt: new Date(Date.now() - ASSOCIATION_DISPATCH_LEASE_MS - 5_000), settledAt: null },
    });
    await retryDrain(uncertain);
    const afterRecovery = await snapshot(uncertain.sourceId, ghl);
    review.uncertainRecovery = {
      afterCrash: {
        run: afterCrash.run?.status,
        workflow: receiptOutcome(afterCrash, "start_workflow"),
        outbox: afterCrash.outbox,
        alex: afterCrash.alex,
      },
      afterRecovery: {
        run: afterRecovery.run?.status,
        workflow: receiptOutcome(afterRecovery, "start_workflow"),
        outbox: afterRecovery.outbox,
        alex: afterRecovery.alex,
      },
      contactWrites: ghl.contactWrites,
      enrollmentCalls: ghl.enrollmentCalls,
      enrollments: ghl.enrollments.length,
    };
    assert.equal(ghl.contactWrites, 1);
    assert.equal(ghl.enrollmentCalls, 1);
    assert.equal(ghl.enrollments.length, 1);
    assert.equal(receiptOutcome(afterRecovery, "start_workflow"), "failed_before_send");
    assert.notEqual(afterRecovery.alex?.customerLastEvent, "Delivered");
    void review;
  } finally {
    restoreCrash();
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));
    for (const row of seeded) await cleanup(row);
  }
});
