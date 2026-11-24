/**
 * Portal list and detail readers over synthetic association-location receipts.
 * The read itself must not call GoHighLevel or retry delivery.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { prisma } from "../../lib/db.js";
import {
  getLeadDeliveryReadModelById,
  listLeadDeliveryReadModel,
} from "./lead-delivery-read.service.js";
import { presentLeadDeliveryDetail, presentLeadDeliveryListRow } from "./lead-delivery-present.service.js";

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
  unknown: "Unknown",
  lead_delivered: "Delivered",
};

/** Same customer badge as portalDeliveryStatusLabel. */
function portalBadge(status: string): string {
  return PORTAL_LABELS[status] ?? status;
}

/** Same customer subline as portalCustomerLastEvent. */
function portalSubline(lastEvent: string | null): string | null {
  const trimmed = lastEvent?.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  if (/^[a-z]+(_[a-z0-9]+)+$/.test(key) && !CUSTOMER_MILESTONES.has(key)) return null;
  return PORTAL_LABELS[key] ?? trimmed;
}

const integrationUrl = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const enabled = Boolean(integrationUrl);
const db = prisma as PrismaClient;

function receipt(operation: string, outcome: string, externalId: string | null) {
  return {
    externalCallExecuted: outcome === "completed",
    vetOperationReceipt: {
      operation,
      outcome,
      externalId,
      httpStatus: outcome === "completed" ? 200 : outcome === "rejected" ? 422 : 500,
      idempotencyKey: `assoc:${operation}`,
    },
  };
}

const contactStep = {
  stepType: "create_or_update_contact",
  status: "succeeded",
  externalId: "contact_1",
  response: receipt("contact", "completed", "contact_1"),
};
const tagStep = {
  stepType: "add_tags",
  status: "succeeded",
  externalId: null,
  response: receipt("tags", "completed", null),
};
const workflowCompleted = {
  stepType: "start_workflow",
  status: "succeeded",
  externalId: "contact_1",
  response: receipt("workflow", "completed", "contact_1"),
};
const workflowSkipped = {
  stepType: "start_workflow",
  status: "skipped",
  externalId: null,
  response: {
    externalCallExecuted: false,
    vetOperationReceipt: {
      operation: "workflow",
      outcome: "skipped",
      externalId: null,
      httpStatus: null,
      idempotencyKey: "assoc:workflow",
    },
  },
};
const ownerFailed = {
  stepType: "assign_owner",
  status: "optional_failed",
  externalId: null,
  errorCode: "http_500",
  response: { externalCallExecuted: true, httpStatus: 500 },
};

async function seed(input: {
  stamp: string;
  suffix: string;
  workflowStartRequired: boolean;
  runStatus?: string;
  outboxStatus?: string;
  lastError?: string | null;
  steps?: Array<{
    stepType: string;
    status: string;
    externalId: string | null;
    errorCode?: string | null;
    response: unknown;
  }>;
  withDeliveredEvent?: boolean;
  sourceStatus?: "routing_matched" | "delivered";
  contactOnResult?: boolean;
  skipRun?: boolean;
}) {
  const clientAccountId = `alex_${input.stamp}_${input.suffix}`;
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
      destinationWorkflowIdGhl: "wf_beta_recovery_proof",
      workflowTriggerMode: "direct_api",
      workflowStartRequired: input.workflowStartRequired,
      defaultAssignedUserIdGhl: "user_owner_alex",
      opportunityCreationEnabled: false,
      deliveryMode: "live",
      deliveryEnabled: true,
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
      clientAccountIdResolved: clientAccountId,
      destinationLocationIdResolved: locationId,
      status: input.sourceStatus ?? "routing_matched",
      rawPayloadJson: { contact: { first_name: "Alex", last_name: "Gross" } },
      normalizedPayloadJson: {
        contact: {
          first_name: "Alex",
          last_name: "Gross",
          email: `${leadUid}@example.test`,
          phone_e164: "+15555550111",
        },
      },
      routingResultJson: { matched: true, routingAuthority: "source_association" },
      routingDryRunDecisionId: decision.id,
      deliveryResultJson: input.contactOnResult ? { contactIdGhl: "contact_1", status: "created" } : undefined,
      deliveredAt: input.sourceStatus === "delivered" ? new Date("2026-11-23T18:05:00.000Z") : null,
      routedAt: new Date("2026-11-23T18:00:00.000Z"),
      receivedAt: new Date("2026-11-23T17:59:00.000Z"),
    },
  });
  let runId: string | null = null;
  if (!input.skipRun) {
    const run = await db.ghlLiveDeliveryRun.create({
      data: {
        leadDeliveryPlanId: plan.id,
        routingDryRunDecisionId: decision.id,
        masterClientAccountId: "lal_master_vet",
        destinationClientAccountId: clientAccountId,
        destinationSubaccountIdGhl: locationId,
        mode: "ongoing_association",
        status: input.runStatus ?? "succeeded",
        idempotencyKey: `ghl-association:${source.id}`,
        completedAt: new Date("2026-11-23T18:05:00.000Z"),
        summary: input.runStatus ?? "succeeded",
        stepRuns: {
          create: (input.steps ?? []).map((step, index) => ({
            stepOrder: index + 1,
            stepType: step.stepType,
            status: step.status,
            externalId: step.externalId,
            errorCode: step.errorCode ?? null,
            responseRedactedJson: step.response as object,
          })),
        },
      },
    });
    runId = run.id;
    await db.ghlAssociationDispatchOutbox.create({
      data: {
        idempotencyKey: `association:${source.id}`,
        status: input.outboxStatus ?? "settled",
        clientAccountId,
        sourceLeadEventId: source.id,
        routingDryRunDecisionId: decision.id,
        destinationLocationIdGhl: locationId,
        liveRunId: run.id,
        outcome: input.runStatus ?? "succeeded",
        externalCallExecuted: true,
        attemptCount: 1,
        lastError: input.lastError ?? null,
        availableAt: new Date("2026-11-23T18:00:00.000Z"),
        settledAt: (input.outboxStatus ?? "settled") === "settled" ? new Date("2026-11-23T18:05:00.000Z") : null,
      },
    });
  }
  if (input.withDeliveredEvent) {
    await db.lifecycleEvent.create({
      data: {
        eventUuid: `evt_${source.id}`,
        clientAccountId,
        subaccountIdGhl: locationId,
        leadUid,
        contactIdGhl: "contact_1",
        eventNameInternal: "lead_delivered",
        eventNameMeta: "lead_delivered",
        payloadJson: { event: { event_name_internal: "lead_delivered" } },
        receivedAt: new Date("2026-11-23T18:05:01.000Z"),
      },
    });
  }
  return { sourceId: source.id, clientAccountId, leadUid, runId };
}

async function portalRead(sourceId: string, clientAccountId: string) {
  const listed = await listLeadDeliveryReadModel({ clientAccountIdResolved: clientAccountId, limit: 5 });
  const listCtx = listed.items.find((item) => item.sourceLead.id === sourceId) ?? null;
  const listRow = listCtx ? presentLeadDeliveryListRow(listCtx, "client") : null;
  const detailCtx = await getLeadDeliveryReadModelById(sourceId);
  const detail = detailCtx ? presentLeadDeliveryDetail(detailCtx, "client") : null;
  const admin = detailCtx ? presentLeadDeliveryDetail(detailCtx, "admin") : null;
  return { listRow, detail, admin };
}

function customerView(row: { deliveryStatus: string; lastEventName: string | null; delivery?: { deliveredAt: string | null } } | null) {
  return {
    badge: row ? portalBadge(row.deliveryStatus) : null,
    subline: row ? portalSubline(row.lastEventName) : null,
    headline: row?.delivery ? (row.delivery.deliveredAt ? "Delivered" : "Generated") : null,
  };
}

test("portal readers agree with canonical GHL receipts", { skip: !enabled }, async () => {
  assertSafeTestDatabaseUrl(integrationUrl);
  const stamp = `portal_${Date.now()}`;
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async (input) => {
    fetches += 1;
    throw new Error(`portal read called the network: ${String(input)}`);
  };
  const created: Array<Awaited<ReturnType<typeof seed>>> = [];
  try {
    const ownerWithEvent = await seed({
      stamp,
      suffix: "owner_event",
      workflowStartRequired: true,
      runStatus: "partial_success",
      withDeliveredEvent: true,
      steps: [contactStep, tagStep, workflowCompleted, ownerFailed],
    });
    const ownerMissingEvent = await seed({
      stamp,
      suffix: "owner_missing",
      workflowStartRequired: true,
      runStatus: "partial_success",
      withDeliveredEvent: false,
      steps: [contactStep, tagStep, workflowCompleted, ownerFailed],
    });
    const ambiguous = await seed({
      stamp,
      suffix: "ambiguous",
      workflowStartRequired: true,
      runStatus: "failed",
      outboxStatus: "uncertain",
      lastError: "failed",
      contactOnResult: true,
      steps: [
        contactStep,
        tagStep,
        { stepType: "start_workflow", status: "failed", externalId: null, response: receipt("workflow", "ambiguous", null) },
      ],
    });
    const rejected = await seed({
      stamp,
      suffix: "rejected",
      workflowStartRequired: true,
      runStatus: "failed",
      outboxStatus: "uncertain",
      lastError: "failed",
      contactOnResult: true,
      steps: [
        contactStep,
        tagStep,
        { stepType: "start_workflow", status: "failed", externalId: null, response: receipt("workflow", "rejected", null) },
      ],
    });
    const missingWorkflow = await seed({
      stamp,
      suffix: "missing_workflow",
      workflowStartRequired: true,
      runStatus: "partial_success",
      contactOnResult: true,
      steps: [contactStep, tagStep, ownerFailed],
    });
    const succeededRequired = await seed({
      stamp,
      suffix: "succeeded_required",
      workflowStartRequired: true,
      runStatus: "succeeded",
      withDeliveredEvent: true,
      steps: [contactStep, tagStep, workflowCompleted],
    });
    const workflowOptional = await seed({
      stamp,
      suffix: "workflow_optional",
      workflowStartRequired: false,
      runStatus: "succeeded",
      withDeliveredEvent: true,
      steps: [contactStep, tagStep, workflowSkipped],
    });
    const alreadyDelivered = await seed({
      stamp,
      suffix: "already_delivered",
      workflowStartRequired: true,
      sourceStatus: "delivered",
      skipRun: true,
    });
    created.push(
      ownerWithEvent,
      ownerMissingEvent,
      ambiguous,
      rejected,
      missingWorkflow,
      succeededRequired,
      workflowOptional,
      alreadyDelivered
    );

    const eventsBefore = await db.lifecycleEvent.count({
      where: { leadUid: { in: created.map((row) => row.leadUid) } },
    });
    const attemptsBefore = await db.ghlAssociationDispatchOutbox.findMany({
      where: { sourceLeadEventId: { in: created.map((row) => row.sourceId) } },
      select: { sourceLeadEventId: true, attemptCount: true, status: true },
    });

    const ownerEventView = await portalRead(ownerWithEvent.sourceId, ownerWithEvent.clientAccountId);
    const ownerMissingView = await portalRead(ownerMissingEvent.sourceId, ownerMissingEvent.clientAccountId);
    const ambiguousView = await portalRead(ambiguous.sourceId, ambiguous.clientAccountId);
    const rejectedView = await portalRead(rejected.sourceId, rejected.clientAccountId);
    const missingView = await portalRead(missingWorkflow.sourceId, missingWorkflow.clientAccountId);
    const succeededView = await portalRead(succeededRequired.sourceId, succeededRequired.clientAccountId);
    const optionalWorkflowView = await portalRead(workflowOptional.sourceId, workflowOptional.clientAccountId);
    const legacyView = await portalRead(alreadyDelivered.sourceId, alreadyDelivered.clientAccountId);

    const eventsAfter = await db.lifecycleEvent.count({
      where: { leadUid: { in: created.map((row) => row.leadUid) } },
    });
    const attemptsAfter = await db.ghlAssociationDispatchOutbox.findMany({
      where: { sourceLeadEventId: { in: created.map((row) => row.sourceId) } },
      select: { sourceLeadEventId: true, attemptCount: true, status: true },
    });

    assert.equal(fetches, 0);
    assert.equal(eventsAfter, eventsBefore);
    assert.deepEqual(attemptsAfter, attemptsBefore);

    for (const view of [ownerEventView, ownerMissingView]) {
      assert.equal(customerView(view.listRow).badge, "Delivered");
      assert.equal(customerView(view.listRow).subline, "Delivered");
      assert.equal(customerView(view.detail).badge, "Delivered");
      assert.equal(customerView(view.detail).subline, "Delivered");
      assert.equal(customerView(view.detail).headline, "Delivered");
      assert.equal(view.admin?.delivery.liveRunStatus, "partial_success");
      assert.equal(view.admin?.adminDetail?.ghlRunStatus, "partial_success");
      assert.deepEqual(view.admin?.adminDetail?.ghlCanonicalReasons, []);
      assert.ok(
        view.admin?.adminDetail?.ghlOptionalStepFailures?.some(
          (step) => step.stepType === "assign_owner" && step.status === "optional_failed"
        )
      );
      assert.equal(view.detail?.adminDetail, undefined);
    }
    assert.equal(
      await db.lifecycleEvent.count({ where: { leadUid: ownerMissingEvent.leadUid, eventNameInternal: "lead_delivered" } }),
      0
    );

    for (const view of [ambiguousView, rejectedView, missingView]) {
      assert.notEqual(customerView(view.listRow).badge, "Delivered");
      assert.notEqual(customerView(view.listRow).subline, "Delivered");
      assert.notEqual(customerView(view.detail).badge, "Delivered");
      assert.notEqual(customerView(view.detail).subline, "Delivered");
      assert.notEqual(customerView(view.detail).headline, "Delivered");
    }
    assert.ok(ambiguousView.admin?.adminDetail?.ghlCanonicalReasons?.includes("operation_outcome_ambiguous"));
    assert.ok(rejectedView.admin?.adminDetail?.ghlCanonicalReasons?.includes("operation_outcome_rejected"));
    assert.ok(missingView.admin?.adminDetail?.ghlCanonicalReasons?.includes("workflow_not_enrolled"));
    assert.equal(missingView.admin?.delivery.liveRunStatus, "partial_success");

    for (const view of [succeededView, optionalWorkflowView, legacyView]) {
      assert.equal(customerView(view.listRow).badge, "Delivered");
      assert.equal(customerView(view.listRow).subline, "Delivered");
      assert.equal(customerView(view.detail).badge, "Delivered");
    }
  } finally {
    globalThis.fetch = originalFetch;
    const sources = await db.sourceLeadEvent.findMany({
      where: { clientAccountIdResolved: { startsWith: `alex_${stamp}_` } },
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
    await db.clientAccount.deleteMany({ where: { clientAccountId: { startsWith: `alex_${stamp}_` } } });
  }
});
