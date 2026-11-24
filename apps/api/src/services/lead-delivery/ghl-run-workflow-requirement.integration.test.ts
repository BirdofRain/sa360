/**
 * Association location API stores the workflow requirement before the first
 * GoHighLevel write. A later destination edit does not change that run.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { prisma } from "../../lib/db.js";
import { deliverConfirmedAssociationIfActivated } from "../association-ongoing-delivery.js";
import {
  claimPendingAssociationOutbox,
  recordGhlAssociationDispatchOutbox,
  settleGhlAssociationDispatchFromResult,
} from "../ghl-association-dispatch/ghl-association-dispatch.js";
import { executeRecordedGhlDelivery } from "../ghl-delivery-adapter/ghl-live-canary.service.js";
import { findDeliveryPlanByRoutingDecisionId } from "../../repositories/lead-delivery-plan.repository.js";
import { ROUTING_AUTHORITY_SOURCE_ASSOCIATION } from "../routing-source-association.service.js";
import {
  getLeadDeliveryReadModelById,
  listLeadDeliveryReadModel,
} from "./lead-delivery-read.service.js";
import { presentLeadDeliveryDetail, presentLeadDeliveryListRow } from "./lead-delivery-present.service.js";

const integrationUrl = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const enabled = Boolean(integrationUrl);
const db = prisma as PrismaClient;
const WORKFLOW_ID = "wf_requirement_freeze";

const CUSTOMER = new Set([
  "source_lead_received",
  "lead_delivered",
  "delivery_unverified",
  "first_touch_sent",
  "contact_replied",
  "appointment_set",
  "appointment_showed",
  "sold",
]);
const LABELS: Record<string, string> = {
  delivered: "Delivered",
  not_started: "Not started",
  unverified: "Delivery unverified",
  delivery_unverified: "Delivery unverified",
  failed: "Failed",
  lead_delivered: "Delivered",
};

function badge(status: string) {
  return LABELS[status] ?? status;
}
function subline(lastEvent: string | null) {
  const trimmed = lastEvent?.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  if (/^[a-z]+(_[a-z0-9]+)+$/.test(key) && !CUSTOMER.has(key)) return null;
  return LABELS[key] ?? trimmed;
}

type Provider = {
  contactWrites: number;
  enrollmentCalls: number;
  workflowHttpStatus: number;
  contactPutHttpStatus: number;
  requirementAtFirstWrite: boolean | null;
  clientAccountId: string | null;
};

function provider(): Provider {
  return {
    contactWrites: 0,
    enrollmentCalls: 0,
    workflowHttpStatus: 200,
    contactPutHttpStatus: 200,
    requirementAtFirstWrite: null,
    clientAccountId: null,
  };
}

async function listen(state: Provider): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const path = req.url?.split("?")[0] ?? "/";
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    if (method === "POST" && path.endsWith("/contacts/upsert")) {
      state.contactWrites += 1;
      if (state.clientAccountId && state.requirementAtFirstWrite === null) {
        const run = await db.ghlLiveDeliveryRun.findFirst({
          where: { destinationClientAccountId: state.clientAccountId },
          orderBy: { startedAt: "desc" },
          select: { workflowStartRequired: true },
        });
        state.requirementAtFirstWrite = run?.workflowStartRequired ?? null;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ contact: { id: "contact_1" } }));
      return;
    }
    if (method === "POST" && /\/contacts\/[^/]+\/workflow\/[^/]+$/.test(path)) {
      state.enrollmentCalls += 1;
      res.writeHead(state.workflowHttpStatus, { "content-type": "application/json" });
      res.end(JSON.stringify(state.workflowHttpStatus === 200 ? { enrollmentId: "enrollment_1" } : { message: "no" }));
      return;
    }
    if (method === "PUT" && /\/contacts\/[^/]+$/.test(path)) {
      res.writeHead(state.contactPutHttpStatus, { "content-type": "application/json" });
      res.end(JSON.stringify(state.contactPutHttpStatus === 200 ? { contact: { id: "contact_1" } } : { message: "owner" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake GHL did not bind");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function seed(input: {
  stamp: string;
  suffix: string;
  workflowStartRequired: boolean;
  workflowMode?: string;
  ownerId?: string | null;
}) {
  const clientAccountId = `alex_req_${input.stamp}_${input.suffix}`;
  const locationId = `loc_${input.stamp}_${input.suffix}`;
  const leadUid = `lead_${input.stamp}_${input.suffix}`;
  await db.clientAccount.create({
    data: { clientAccountId, clientDisplayName: "Alex Gross", status: "active" },
  });
  await db.clientGhlDestination.create({
    data: {
      clientAccountId,
      destinationSubaccountIdGhl: locationId,
      locationName: "Alex Gross CRM",
      destinationWorkflowIdGhl: input.workflowMode === "none" ? null : WORKFLOW_ID,
      workflowTriggerMode: input.workflowMode ?? "direct_api",
      workflowStartRequired: input.workflowStartRequired,
      defaultAssignedUserIdGhl: input.ownerId ?? null,
      opportunityCreationEnabled: false,
      deliveryMode: "live",
      deliveryEnabled: true,
      clientCutoverApproved: true,
      internalApprovalStatus: "approved",
      ghlConnectionStatus: "connected",
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
      confidence: "confirmed_source",
      matchReason: "Confirmed parent URL association",
      destinationClientAccountId: clientAccountId,
      destinationSubaccountIdGhl: locationId,
      routingEventNameInternal: "routing_matched",
      attributionSnapshot: { routingAuthority: ROUTING_AUTHORITY_SOURCE_ASSOCIATION },
    },
  });
  const body = {
    schema_version: "1.0",
    client_account_id: clientAccountId,
    subaccount_id_ghl: locationId,
    contact: { lead_uid: leadUid, first_name: "Alex", last_name: "Gross", email: `${leadUid}@example.test`, phone_e164: "+15555550111" },
    state: { routing_status: "matched", lifecycle_stage: "NEW" },
    event: { event_uuid: `evt_${leadUid}`, event_name_internal: "lead_created", event_name_meta: "lead_created", send_to_meta: false },
  };
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

async function deliver(seeded: Awaited<ReturnType<typeof seed>>) {
  await claimPendingAssociationOutbox(seeded.sourceId);
  const result = await deliverConfirmedAssociationIfActivated({
    sourceLeadEventId: seeded.sourceId,
    status: "routing_matched",
    routing: seeded.routing,
    lifecyclePayload: seeded.body as never,
  });
  await settleGhlAssociationDispatchFromResult(seeded.sourceId, result);
  return result;
}

async function portal(sourceId: string, clientAccountId: string) {
  const listed = await listLeadDeliveryReadModel({ clientAccountIdResolved: clientAccountId, limit: 5 });
  const listCtx = listed.items.find((item) => item.sourceLead.id === sourceId);
  const listRow = listCtx ? presentLeadDeliveryListRow(listCtx, "client") : null;
  const detailCtx = await getLeadDeliveryReadModelById(sourceId);
  const detail = detailCtx ? presentLeadDeliveryDetail(detailCtx, "client") : null;
  const admin = detailCtx ? presentLeadDeliveryDetail(detailCtx, "admin") : null;
  return {
    listBadge: listRow ? badge(listRow.deliveryStatus) : null,
    listSubline: listRow ? subline(listRow.lastEventName) : null,
    detailBadge: detail ? badge(detail.deliveryStatus) : null,
    detailSubline: detail ? subline(detail.lastEventName) : null,
    detailHeadline: !detail
      ? null
      : detail.deliveryStatus === "unverified"
        ? "Delivery unverified"
        : detail.delivery.deliveredAt
          ? "Delivered"
          : "Generated",
    liveRunStatus: admin?.delivery.liveRunStatus ?? null,
    optionalOwner: admin?.adminDetail?.ghlOptionalStepFailures?.some((step) => step.stepType === "assign_owner") ?? false,
  };
}

test("association delivery freezes workflowStartRequired for the portal", { skip: !enabled }, async () => {
  assertSafeTestDatabaseUrl(integrationUrl);
  process.env.SA360_GHL_ONGOING_DELIVERY_ENABLED = "true";
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "local-fake-ghl-token";
  const ghl = provider();
  const fake = await listen(ghl);
  process.env.GHL_API_BASE_URL = fake.baseUrl;
  const stamp = `${Date.now()}`;
  const seeded: Array<Awaited<ReturnType<typeof seed>>> = [];
  try {
    ghl.workflowHttpStatus = 500;
    ghl.clientAccountId = null;
    const optional = await seed({ stamp, suffix: "optional", workflowStartRequired: false });
    seeded.push(optional);
    ghl.clientAccountId = optional.clientAccountId;
    const optionalDelivery = await deliver(optional);
    assert.equal(ghl.requirementAtFirstWrite, false, JSON.stringify({ optionalDelivery, writes: ghl.contactWrites }));
    assert.equal(ghl.enrollmentCalls, 1);
    const optionalRun = await db.ghlLiveDeliveryRun.findFirst({
      where: { destinationClientAccountId: optional.clientAccountId },
      select: { id: true, workflowStartRequired: true, status: true, leadDeliveryPlanId: true },
    });
    assert.ok(optionalRun);
    assert.equal(optionalRun.workflowStartRequired, false);
    const optionalBefore = await portal(optional.sourceId, optional.clientAccountId);
    await db.clientGhlDestination.update({
      where: { clientAccountId: optional.clientAccountId },
      data: { workflowStartRequired: true, workflowTriggerMode: "direct_api", destinationWorkflowIdGhl: WORKFLOW_ID },
    });
    const callsBeforeRead = ghl.contactWrites + ghl.enrollmentCalls;
    const eventsBefore = await db.lifecycleEvent.count({ where: { leadUid: optional.leadUid } });
    const runBeforeRead = await db.ghlLiveDeliveryRun.findUnique({
      where: { id: optionalRun.id },
      select: { updatedAt: true, status: true, workflowStartRequired: true, _count: { select: { stepRuns: true } } },
    });
    const outboxBeforeRead = await db.ghlAssociationDispatchOutbox.findFirst({
      where: { sourceLeadEventId: optional.sourceId },
      select: { attemptCount: true, status: true, updatedAt: true },
    });
    const optionalAfter = await portal(optional.sourceId, optional.clientAccountId);
    const runAfterRead = await db.ghlLiveDeliveryRun.findUnique({
      where: { id: optionalRun.id },
      select: { updatedAt: true, status: true, workflowStartRequired: true, _count: { select: { stepRuns: true } } },
    });
    const outboxAfterRead = await db.ghlAssociationDispatchOutbox.findFirst({
      where: { sourceLeadEventId: optional.sourceId },
      select: { attemptCount: true, status: true, updatedAt: true },
    });
    assert.equal(ghl.contactWrites + ghl.enrollmentCalls, callsBeforeRead);
    assert.equal(await db.lifecycleEvent.count({ where: { leadUid: optional.leadUid } }), eventsBefore);
    assert.deepEqual(runAfterRead, runBeforeRead);
    assert.deepEqual(outboxAfterRead, outboxBeforeRead);
    assert.equal(optionalBefore.listBadge, "Delivered");
    assert.equal(optionalBefore.detailHeadline, "Delivered");
    assert.equal(optionalAfter.listBadge, "Delivered");
    assert.equal(optionalAfter.listSubline, "Delivered");
    assert.equal(optionalAfter.detailBadge, "Delivered");
    assert.equal(optionalAfter.detailHeadline, "Delivered");

    const plan = await findDeliveryPlanByRoutingDecisionId(optional.decisionId);
    assert.ok(plan && optionalRun);
    await db.ghlLiveDeliveryStepRun.deleteMany({ where: { liveRunId: optionalRun.id } });
    await db.ghlLiveDeliveryStepRun.create({
      data: {
        liveRunId: optionalRun.id,
        stepOrder: 1,
        stepType: "create_or_update_contact",
        status: "failed",
        responseRedactedJson: {
          externalCallExecuted: false,
          vetOperationReceipt: {
            operation: "contact",
            outcome: "failed_before_send",
            externalId: null,
            httpStatus: null,
            idempotencyKey: "assoc:contact",
          },
        },
      },
    });
    await db.ghlLiveDeliveryRun.update({ where: { id: optionalRun.id }, data: { status: "failed", completedAt: new Date() } });
    ghl.workflowHttpStatus = 500;
    ghl.enrollmentCalls = 0;
    const retried = await executeRecordedGhlDelivery({
      plan,
      mode: "ongoing_association",
      executedBy: "association_intake",
      operatorConfirmationText: null,
      lifecyclePayload: optional.body as never,
      reuseRunId: optionalRun.id,
    });
    const retriedRun = await db.ghlLiveDeliveryRun.findUnique({
      where: { id: optionalRun.id },
      include: { stepRuns: true },
    });
    assert.equal(retriedRun?.workflowStartRequired, false);
    assert.equal(recordedPlanAgrees(retriedRun?.workflowStartRequired, retriedRun?.stepRuns.find((step) => step.stepType === "start_workflow")?.status), true);
    assert.equal(retried.status, "partial_success");
    assert.equal(retriedRun?.stepRuns.find((step) => step.stepType === "start_workflow")?.status, "optional_failed");

    ghl.workflowHttpStatus = 500;
    ghl.contactPutHttpStatus = 200;
    ghl.requirementAtFirstWrite = null;
    const failed = await seed({ stamp, suffix: "failed", workflowStartRequired: true });
    seeded.push(failed);
    ghl.clientAccountId = failed.clientAccountId;
    await deliver(failed);
    assert.equal(ghl.requirementAtFirstWrite, true);
    const failedBefore = await portal(failed.sourceId, failed.clientAccountId);
    await db.clientGhlDestination.update({
      where: { clientAccountId: failed.clientAccountId },
      data: { workflowStartRequired: false },
    });
    const failedAfter = await portal(failed.sourceId, failed.clientAccountId);
    const failedRun = await db.ghlLiveDeliveryRun.findFirst({
      where: { destinationClientAccountId: failed.clientAccountId },
      select: { workflowStartRequired: true, status: true },
    });
    assert.equal(failedRun?.workflowStartRequired, true);
    assert.equal(failedRun?.status, "failed");
    assert.notEqual(failedBefore.listBadge, "Delivered");
    assert.notEqual(failedBefore.detailHeadline, "Delivered");
    assert.notEqual(failedAfter.listBadge, "Delivered");
    assert.notEqual(failedAfter.detailBadge, "Delivered");
    assert.notEqual(failedAfter.detailHeadline, "Delivered");
    const outbox = await db.ghlAssociationDispatchOutbox.findFirst({ where: { sourceLeadEventId: failed.sourceId } });
    assert.equal(outbox?.status, "uncertain");

    ghl.workflowHttpStatus = 200;
    ghl.contactPutHttpStatus = 500;
    ghl.requirementAtFirstWrite = null;
    const owner = await seed({ stamp, suffix: "owner", workflowStartRequired: true, ownerId: "user_owner_alex" });
    seeded.push(owner);
    ghl.clientAccountId = owner.clientAccountId;
    await deliver(owner);
    assert.equal(ghl.requirementAtFirstWrite, true);
    const ownerBefore = await portal(owner.sourceId, owner.clientAccountId);
    await db.clientGhlDestination.update({
      where: { clientAccountId: owner.clientAccountId },
      data: { workflowStartRequired: false },
    });
    const ownerAfter = await portal(owner.sourceId, owner.clientAccountId);
    assert.equal(ownerBefore.listBadge, "Delivered");
    assert.equal(ownerBefore.detailHeadline, "Delivered");
    assert.equal(ownerBefore.optionalOwner, true);
    assert.equal(ownerBefore.liveRunStatus, "partial_success");
    assert.equal(ownerAfter.listBadge, "Delivered");
    assert.equal(ownerAfter.listSubline, "Delivered");
    assert.equal(ownerAfter.detailBadge, "Delivered");
    assert.equal(ownerAfter.detailHeadline, "Delivered");
    assert.equal(ownerAfter.optionalOwner, true);
    assert.equal(ownerAfter.liveRunStatus, "partial_success");
  } finally {
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));
    const sources = await db.sourceLeadEvent.findMany({
      where: { clientAccountIdResolved: { startsWith: `alex_req_${stamp}_` } },
      select: { id: true, routingDryRunDecisionId: true, sourceLeadUid: true },
    });
    const sourceIds = sources.map((row) => row.id);
    const decisionIds = sources.map((row) => row.routingDryRunDecisionId).filter((id): id is string => Boolean(id));
    const leadUids = sources.map((row) => row.sourceLeadUid).filter((id): id is string => Boolean(id));
    await db.ghlAssociationDispatchOutbox.deleteMany({ where: { sourceLeadEventId: { in: sourceIds } } });
    await db.lifecycleEvent.deleteMany({ where: { leadUid: { in: leadUids } } });
    await db.leadDeliveryPlan.deleteMany({ where: { routingDryRunDecisionId: { in: decisionIds } } });
    await db.sourceLeadEvent.deleteMany({ where: { id: { in: sourceIds } } });
    await db.routingDryRunDecision.deleteMany({ where: { id: { in: decisionIds } } });
    await db.ghlLocationConnection.deleteMany({ where: { clientAccountId: { startsWith: `alex_req_${stamp}_` } } });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { startsWith: `alex_req_${stamp}_` } } });
  }
});

function recordedPlanAgrees(stored: boolean | null | undefined, workflowStepStatus: string | undefined): boolean {
  return stored === false && workflowStepStatus === "optional_failed";
}
