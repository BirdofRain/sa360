/**
 * Delivered-tab membership versus the customer badge.
 *
 * The source-status query is the previous tab. It keeps a delivered source row
 * even when the badge is Delivery unverified, and it misses a routing_matched
 * lead whose receipts are canonical. The customer list pages the badge instead,
 * after the same client, search, and receivedAt filters.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import Fastify from "fastify";

import { CLIENT_PORTAL_KEY_HEADER } from "../../lib/client-portal-auth.js";
import { prisma } from "../../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { listSourceLeadEvents } from "../../repositories/source-lead-event.repository.js";
import { clientPortalRoutes } from "../../routes/client-portal.js";
import {
  getLeadDeliveryReadModelById,
  listLeadDeliveryReadModel,
} from "./lead-delivery-read.service.js";
import { presentLeadDeliveryListRow } from "./lead-delivery-present.service.js";
import { listCustomerDeliveredLeadDelivery } from "./portal-delivered-list.js";
import { PORTAL_DELIVERED_MAX_SCAN, PORTAL_DELIVERED_SCAN_BATCH } from "./portal-delivered-membership.js";

const integrationUrl = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const enabled = Boolean(integrationUrl);
const db = prisma as PrismaClient;

function portalBadge(status: string): string {
  if (status === "delivered") return "Delivered";
  if (status === "unverified") return "Delivery unverified";
  if (status === "not_started") return "Not started";
  if (status === "failed") return "Failed";
  return status;
}

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
const ownerFailed = {
  stepType: "assign_owner",
  status: "optional_failed",
  externalId: null,
  errorCode: "http_500",
  response: { externalCallExecuted: true, httpStatus: 500 },
};
const workflowAmbiguous = {
  stepType: "start_workflow",
  status: "failed",
  externalId: null,
  response: receipt("workflow", "ambiguous", null),
};

type Kind = "filler" | "canonical" | "unverified" | "legacy" | "uncertain";

async function createClient(clientAccountId: string, locationId: string) {
  await db.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "Alex Gross",
      status: "active",
      portalEnabled: true,
    },
  });
  await db.clientGhlDestination.create({
    data: {
      clientAccountId,
      destinationSubaccountIdGhl: locationId,
      locationName: "Alex Gross CRM",
      destinationWorkflowIdGhl: "wf_beta_recovery_proof",
      workflowTriggerMode: "direct_api",
      workflowStartRequired: true,
      defaultAssignedUserIdGhl: "user_owner_alex",
      opportunityCreationEnabled: false,
      deliveryMode: "live",
      deliveryEnabled: true,
      clientCutoverApproved: true,
      internalApprovalStatus: "approved",
      ghlConnectionStatus: "connected",
    },
  });
}

async function createLead(input: {
  clientAccountId: string;
  locationId: string;
  stamp: string;
  key: string;
  receivedAt: string;
  campaign: string;
  kind: Kind;
}) {
  const leadUid = `lead_${input.stamp}_${input.key}`;
  const decision = await db.routingDryRunDecision.create({
    data: {
      masterClientAccountId: "lal_master_vet",
      sourceLeadUid: leadUid,
      matched: true,
      confidence: "confirmed_source",
      matchReason: "Confirmed parent URL association",
      destinationClientAccountId: input.clientAccountId,
      destinationSubaccountIdGhl: input.locationId,
      routingEventNameInternal: "routing_matched",
      attributionSnapshot: { routingAuthority: "source_association" },
    },
  });
  const plan = await db.leadDeliveryPlan.create({
    data: {
      routingDryRunDecisionId: decision.id,
      masterClientAccountId: "lal_master_vet",
      sourceLeadUid: leadUid,
      destinationClientAccountId: input.clientAccountId,
      destinationSubaccountIdGhl: input.locationId,
      deliveryMode: "live",
      status: "ready",
    },
  });
  const sourceStatus = input.kind === "legacy" || input.kind === "unverified" ? "delivered" : "routing_matched";
  const source = await db.sourceLeadEvent.create({
    data: {
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceType: "webhook",
      sourceLeadUid: leadUid,
      sourceCampaignName: input.campaign,
      clientAccountIdResolved: input.clientAccountId,
      destinationLocationIdResolved: input.locationId,
      status: sourceStatus,
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
      deliveredAt: sourceStatus === "delivered" ? new Date(input.receivedAt) : null,
      routedAt: new Date(input.receivedAt),
      receivedAt: new Date(input.receivedAt),
    },
  });
  if (input.kind === "filler" || input.kind === "legacy") {
    return { id: source.id, key: input.key };
  }
  const steps =
    input.kind === "canonical"
      ? [contactStep, tagStep, workflowCompleted, ownerFailed]
      : input.kind === "unverified"
        ? [contactStep, tagStep, ownerFailed]
        : [contactStep, tagStep, workflowAmbiguous];
  const run = await db.ghlLiveDeliveryRun.create({
    data: {
      leadDeliveryPlanId: plan.id,
      routingDryRunDecisionId: decision.id,
      masterClientAccountId: "lal_master_vet",
      destinationClientAccountId: input.clientAccountId,
      destinationSubaccountIdGhl: input.locationId,
      mode: "ongoing_association",
      status: input.kind === "uncertain" ? "failed" : "partial_success",
      idempotencyKey: `ghl-association:${source.id}`,
      completedAt: new Date(input.receivedAt),
      summary: input.kind,
      workflowStartRequired: input.kind === "unverified" ? null : true,
      stepRuns: {
        create: steps.map((step, index) => ({
          stepOrder: index + 1,
          stepType: step.stepType,
          status: step.status,
          externalId: step.externalId,
          errorCode: "errorCode" in step ? step.errorCode : null,
          responseRedactedJson: step.response as object,
        })),
      },
    },
  });
  await db.ghlAssociationDispatchOutbox.create({
    data: {
      idempotencyKey: `association:${source.id}`,
      status: input.kind === "uncertain" ? "uncertain" : "settled",
      clientAccountId: input.clientAccountId,
      sourceLeadEventId: source.id,
      routingDryRunDecisionId: decision.id,
      destinationLocationIdGhl: input.locationId,
      liveRunId: run.id,
      outcome: input.kind === "uncertain" ? "failed" : "partial_success",
      externalCallExecuted: true,
      attemptCount: 1,
      lastError: input.kind === "uncertain" ? "failed" : null,
      availableAt: new Date(input.receivedAt),
      settledAt: input.kind === "uncertain" ? null : new Date(input.receivedAt),
    },
  });
  return { id: source.id, key: input.key };
}

async function cleanup(stamp: string) {
  const clients = [`mem_${stamp}`, `mem_${stamp}_other`];
  const sources = await db.sourceLeadEvent.findMany({
    where: { clientAccountIdResolved: { in: clients } },
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
  await db.clientAccount.deleteMany({ where: { clientAccountId: { in: clients } } });
}

test("Delivered tab pages the badge under the same client, search, and date filters", { skip: !enabled }, async () => {
  assertSafeTestDatabaseUrl(integrationUrl);
  const stamp = `${Date.now()}`;
  const clientAccountId = `mem_${stamp}`;
  const otherClientId = `mem_${stamp}_other`;
  const locationId = `loc_${stamp}`;
  const otherLocationId = `loc_${stamp}_other`;
  const from = "2026-11-01T00:00:00.000Z";
  const to = "2026-11-30T23:59:59.999Z";
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async (input) => {
    fetches += 1;
    throw new Error(`portal read called the network: ${String(input)}`);
  };
  const previousKey = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";

  try {
    await createClient(clientAccountId, locationId);
    await createClient(otherClientId, otherLocationId);
    const specs: Array<{ key: string; receivedAt: string; campaign: string; kind: Kind; client?: string; location?: string }> = [
      { key: "filler_new", receivedAt: "2026-11-20T12:00:00.000Z", campaign: "Quartz", kind: "filler" },
      { key: "canonical_a", receivedAt: "2026-11-20T11:00:00.000Z", campaign: "Quartz", kind: "canonical" },
      { key: "unverified", receivedAt: "2026-11-20T10:00:00.000Z", campaign: "Quartz", kind: "unverified" },
      { key: "legacy_a", receivedAt: "2026-11-20T09:00:00.000Z", campaign: "Quartz", kind: "legacy" },
      { key: "uncertain", receivedAt: "2026-11-20T08:00:00.000Z", campaign: "Quartz", kind: "uncertain" },
      { key: "canonical_b", receivedAt: "2026-11-20T07:00:00.000Z", campaign: "Quartz", kind: "canonical" },
      { key: "filler_mid", receivedAt: "2026-11-20T06:00:00.000Z", campaign: "Quartz", kind: "filler" },
      { key: "legacy_b", receivedAt: "2026-11-20T05:00:00.000Z", campaign: "Quartz", kind: "legacy" },
      { key: "filler_old", receivedAt: "2026-11-20T04:00:00.000Z", campaign: "Quartz", kind: "filler" },
      { key: "canonical_c", receivedAt: "2026-11-20T03:00:00.000Z", campaign: "Quartz", kind: "canonical" },
      { key: "legacy_october", receivedAt: "2026-10-15T12:00:00.000Z", campaign: "Quartz", kind: "legacy" },
      { key: "other_campaign", receivedAt: "2026-11-20T13:00:00.000Z", campaign: "Pebble", kind: "canonical" },
    ];
    const ids = new Map<string, string>();
    for (const spec of specs) {
      const created = await createLead({
        clientAccountId,
        locationId,
        stamp,
        ...spec,
      });
      ids.set(spec.key, created.id);
    }
    const other = await createLead({
      clientAccountId: otherClientId,
      locationId: otherLocationId,
      stamp,
      key: "other_client",
      receivedAt: "2026-11-20T11:30:00.000Z",
      campaign: "Quartz",
      kind: "legacy",
    });
    ids.set("other_client", other.id);

    const filters = {
      clientAccountIdResolved: clientAccountId,
      search: "Quartz",
      receivedFrom: new Date(from),
      receivedTo: new Date(to),
    };
    const sourceStatusPage = await listLeadDeliveryReadModel({ ...filters, status: "delivered", limit: 50 });
    const sourceStatusIds = sourceStatusPage.items.map((item) => item.sourceLead.id);
    assert.deepEqual(sourceStatusIds, [
      ids.get("unverified"),
      ids.get("legacy_a"),
      ids.get("legacy_b"),
    ]);

    const runsBefore = await db.ghlLiveDeliveryRun.count({
      where: { destinationClientAccountId: { in: [clientAccountId, otherClientId] } },
    });
    const outboxBefore = await db.ghlAssociationDispatchOutbox.findMany({
      where: { clientAccountId: { in: [clientAccountId, otherClientId] } },
      select: { id: true, status: true, attemptCount: true, liveRunId: true },
      orderBy: { id: "asc" },
    });
    const eventsBefore = await db.lifecycleEvent.count({
      where: { clientAccountId: { in: [clientAccountId, otherClientId] } },
    });

    let readsThisPage = 0;
    let maxBatch = 0;
    const countingList: typeof listSourceLeadEvents = async (pageFilters, pageDb) => {
      maxBatch = Math.max(maxBatch, pageFilters.limit ?? 0);
      assert.equal(pageFilters.clientAccountIdResolved, clientAccountId);
      assert.equal(pageFilters.status, undefined);
      const page = await listSourceLeadEvents(pageFilters, pageDb);
      readsThisPage += page.items.length;
      assert.ok(readsThisPage <= PORTAL_DELIVERED_MAX_SCAN);
      return page;
    };

    const seen: string[] = [];
    const pageLengths: number[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 8; guard += 1) {
      readsThisPage = 0;
      const page = await listCustomerDeliveredLeadDelivery(
        { ...filters, limit: 2, cursor },
        { listSourceLeadEventsImpl: countingList }
      );
      assert.ok(maxBatch <= PORTAL_DELIVERED_SCAN_BATCH);
      const rows = page.items.map((item) => presentLeadDeliveryListRow(item, "client"));
      pageLengths.push(rows.length);
      for (const row of rows) {
        assert.equal(row.clientAccountId, clientAccountId);
        assert.equal(portalBadge(row.deliveryStatus), "Delivered");
        seen.push(row.id);
      }
      if (!page.nextCursor) break;
      assert.equal(seen.includes(page.nextCursor), true);
      cursor = page.nextCursor;
    }

    assert.deepEqual(seen, [
      ids.get("canonical_a"),
      ids.get("legacy_a"),
      ids.get("canonical_b"),
      ids.get("legacy_b"),
      ids.get("canonical_c"),
    ]);
    assert.deepEqual(pageLengths, [2, 2, 1]);
    assert.equal(new Set(seen).size, seen.length);
    for (const excluded of ["unverified", "uncertain", "filler_new", "legacy_october", "other_campaign", "other_client"]) {
      assert.equal(seen.includes(ids.get(excluded)!), false, excluded);
    }

    const unverified = await getLeadDeliveryReadModelById(ids.get("unverified")!);
    const uncertain = await getLeadDeliveryReadModelById(ids.get("uncertain")!);
    assert.equal(portalBadge(presentLeadDeliveryListRow(unverified!, "client").deliveryStatus), "Delivery unverified");
    assert.notEqual(portalBadge(presentLeadDeliveryListRow(uncertain!, "client").deliveryStatus), "Delivered");

    const withoutSearch = await listCustomerDeliveredLeadDelivery({
      clientAccountIdResolved: clientAccountId,
      receivedFrom: filters.receivedFrom,
      receivedTo: filters.receivedTo,
      limit: 20,
    });
    assert.equal(
      withoutSearch.items.some((item) => item.sourceLead.id === ids.get("other_campaign")),
      true
    );
    const withoutDate = await listCustomerDeliveredLeadDelivery({
      clientAccountIdResolved: clientAccountId,
      search: "Quartz",
      limit: 20,
    });
    assert.equal(
      withoutDate.items.some((item) => item.sourceLead.id === ids.get("legacy_october")),
      true
    );
    const otherTenant = await listCustomerDeliveredLeadDelivery({
      clientAccountIdResolved: otherClientId,
      search: "Quartz",
      receivedFrom: filters.receivedFrom,
      receivedTo: filters.receivedTo,
      limit: 20,
    });
    assert.deepEqual(
      otherTenant.items.map((item) => item.sourceLead.id),
      [ids.get("other_client")]
    );

    const runsAfter = await db.ghlLiveDeliveryRun.count({
      where: { destinationClientAccountId: { in: [clientAccountId, otherClientId] } },
    });
    const outboxAfter = await db.ghlAssociationDispatchOutbox.findMany({
      where: { clientAccountId: { in: [clientAccountId, otherClientId] } },
      select: { id: true, status: true, attemptCount: true, liveRunId: true },
      orderBy: { id: "asc" },
    });
    const eventsAfter = await db.lifecycleEvent.count({
      where: { clientAccountId: { in: [clientAccountId, otherClientId] } },
    });
    assert.equal(fetches, 0);
    assert.equal(runsAfter, runsBefore);
    assert.equal(eventsAfter, eventsBefore);
    assert.deepEqual(outboxAfter, outboxBefore);

    const app = Fastify({ logger: false });
    await app.register(clientPortalRoutes, { prefix: "/client/v1" });
    const reversed = await app.inject({
      method: "GET",
      url: `/client/v1/lead-delivery?clientAccountId=${clientAccountId}&status=delivered&from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}`,
      headers: { [CLIENT_PORTAL_KEY_HEADER]: "portal-secret" },
    });
    assert.equal(reversed.statusCode, 400);

    const httpSeen: string[] = [];
    let httpCursor = "";
    for (let guard = 0; guard < 8; guard += 1) {
      const params = new URLSearchParams({
        clientAccountId,
        status: "delivered",
        q: "Quartz",
        from,
        to,
        limit: "2",
      });
      if (httpCursor) params.set("cursor", httpCursor);
      const response = await app.inject({
        method: "GET",
        url: `/client/v1/lead-delivery?${params.toString()}`,
        headers: { [CLIENT_PORTAL_KEY_HEADER]: "portal-secret" },
      });
      assert.equal(response.statusCode, 200);
      const body = response.json() as {
        items: Array<{ id: string; deliveryStatus: string; clientAccountId: string | null }>;
        nextCursor: string | null;
      };
      for (const item of body.items) {
        assert.equal(portalBadge(item.deliveryStatus), "Delivered");
        assert.equal(item.clientAccountId, clientAccountId);
        httpSeen.push(item.id);
      }
      if (!body.nextCursor) break;
      httpCursor = body.nextCursor;
    }
    assert.deepEqual(httpSeen, seen);
    await app.close();
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.CLIENT_PORTAL_API_KEY;
    else process.env.CLIENT_PORTAL_API_KEY = previousKey;
    await cleanup(stamp);
  }
});
