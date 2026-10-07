import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import nicholasFixture from "../../fixtures/leadcaptureio/leadcaptureio-webhook-sample-legacy-custom-domain-nicholas.json" with { type: "json" };
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  LEADCAPTURE_RECONCILE_CONFIRMATION,
  reconcileOneLeadCaptureSourceEventAssociation,
} from "./leadcapture-one-event-reconcile.service.js";
import { associateSourceFunnelByPageUrl } from "./source-funnel.service.js";
import { processLeadCaptureIoWebhookIntake } from "./source-lead-intake.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const CLIENT_ID = "lcrec_nick_dambruoso";
const OTHER_CLIENT_ID = "lcrec_other_client";
const ROUTE_KEY = "LCIO_LEGACY_RECONCILE_NICHOLAS_DAMBRUOSO_VET_FEX";
const PAGE_URL = "https://go.reconcileforvets.example/learn-nicholas-dambruoso";
const PARENT_URL_KEY = "go.reconcileforvets.example/learn-nicholas-dambruoso";
const UNREGISTERED_PAGE_URL = "https://go.unregistered.example/learn-nobody";
const OPERATOR = "integration-test-operator";

const ALL_CLIENT_IDS = [CLIENT_ID, OTHER_CLIENT_ID];

function legacyPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...(JSON.parse(JSON.stringify(nicholasFixture)) as Record<string, unknown>),
    sa360_route_key: ROUTE_KEY,
    lead_form: "",
    parent_url: PAGE_URL,
    ...overrides,
  };
}

describe("one-event LeadCapture source-association reconcile", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let dbHost: string;
  let databaseUrl: string;
  const createdEventIds: string[] = [];

  async function cleanup() {
    if (createdEventIds.length > 0) {
      await db.leadInventoryItem.deleteMany({
        where: { sourceLeadEventId: { in: createdEventIds } },
      });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    await db.sourceLeadEvent.deleteMany({ where: { sourceRouteKey: ROUTE_KEY } });
    await db.sourceFunnel.deleteMany({
      where: {
        OR: [
          { originClientAccountId: { in: ALL_CLIENT_IDS } },
          { suggestedClientAccountId: { in: ALL_CLIENT_IDS } },
          { provider: "leadcapture_io", parentUrlKey: PARENT_URL_KEY },
          {
            provider: "leadcapture_io",
            parentUrlKey: "go.unregistered.example/learn-nobody",
          },
        ],
      },
    });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: ALL_CLIENT_IDS } } });
  }

  /** The pre-fix shape: the lead arrived while routing could not use the association. */
  async function resetToPreFixState(sourceEventId: string) {
    await db.sourceLeadEvent.update({
      where: { id: sourceEventId },
      data: {
        status: "routing_unmatched",
        clientAccountIdResolved: null,
        routingRuleIdResolved: null,
        destinationLocationIdResolved: null,
        routingResultJson: { matched: false, reason: "no_matching_rule" },
      },
    });
    await db.leadInventoryItem.updateMany({
      where: { sourceLeadEventId: sourceEventId },
      data: { originClientAccountId: null },
    });
    await db.sourceFunnel.updateMany({
      where: { provider: "leadcapture_io", parentUrlKey: PARENT_URL_KEY },
      data: { firstSeenAt: null, lastSeenAt: null },
    });
  }

  function reconcileArgs(overrides: Record<string, unknown> = {}) {
    return {
      sourceEventId: createdEventIds[0]!,
      expectedSourceSystem: "leadcapture_io_legacy",
      expectedRoute: ROUTE_KEY,
      expectedLeadId: String(nicholasFixture.lead_id),
      expectedDestinationClientAccountId: CLIENT_ID,
      expectedDbHost: dbHost,
      operator: OPERATOR,
      confirm: LEADCAPTURE_RECONCILE_CONFIRMATION,
      databaseUrl,
      ...overrides,
    };
  }

  before(async () => {
    databaseUrl = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = databaseUrl;
    dbHost = new URL(databaseUrl).hostname;
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await cleanup();
    await db.clientAccount.createMany({
      data: [
        {
          clientAccountId: CLIENT_ID,
          clientDisplayName: "LCREC Nick D'Ambruoso",
          status: "active",
        },
        {
          clientAccountId: OTHER_CLIENT_ID,
          clientDisplayName: "LCREC Other Client",
          status: "active",
        },
      ],
    });

    // Lead arrives first, with no confirmed association in place.
    const intake = await processLeadCaptureIoWebhookIntake({
      rawPayload: legacyPayload(),
      routeKeyFromPath: ROUTE_KEY,
    });
    createdEventIds.push(intake.sourceEventId);
    assert.equal(intake.matched, false);

    // Operator then associates and confirms the page for the client.
    const associated = await associateSourceFunnelByPageUrl({
      originClientAccountId: CLIENT_ID,
      pageUrlOrSlug: PAGE_URL,
    });
    assert.equal(associated.parentUrlKey, PARENT_URL_KEY);
    await resetToPreFixState(intake.sourceEventId);
  });

  after(async () => {
    await cleanup();
    await db?.$disconnect();
  });

  it("refuses without the confirmation phrase, operator, or matching db host", async () => {
    const badConfirm = await reconcileOneLeadCaptureSourceEventAssociation(
      reconcileArgs({ confirm: "yes please", apply: true }),
      { prisma: db }
    );
    assert.equal(badConfirm.outcome, "REFUSED");
    assert.equal(badConfirm.reasonCode, "confirmation_mismatch");
    assert.equal(badConfirm.writesAttempted, false);

    const noOperator = await reconcileOneLeadCaptureSourceEventAssociation(
      reconcileArgs({ operator: "  ", apply: true }),
      { prisma: db }
    );
    assert.equal(noOperator.reasonCode, "operator_required");

    const wrongHost = await reconcileOneLeadCaptureSourceEventAssociation(
      reconcileArgs({ expectedDbHost: "db.production.example", apply: true }),
      { prisma: db }
    );
    assert.equal(wrongHost.reasonCode, "db_host_mismatch");

    const event = await db.sourceLeadEvent.findUnique({ where: { id: createdEventIds[0]! } });
    assert.equal(event?.clientAccountIdResolved, null);
  });

  it("refuses when the association resolves to a different client", async () => {
    const result = await reconcileOneLeadCaptureSourceEventAssociation(
      reconcileArgs({ expectedDestinationClientAccountId: OTHER_CLIENT_ID, apply: true }),
      { prisma: db }
    );
    assert.equal(result.outcome, "REFUSED");
    assert.equal(result.reasonCode, "destination_client_mismatch");
    assert.equal(result.writesAttempted, false);
    assert.equal(result.association?.originClientAccountId, CLIENT_ID);

    const event = await db.sourceLeadEvent.findUnique({ where: { id: createdEventIds[0]! } });
    assert.equal(event?.clientAccountIdResolved, null);
  });

  it("previews without writing anything", async () => {
    const result = await reconcileOneLeadCaptureSourceEventAssociation(reconcileArgs(), {
      prisma: db,
    });
    assert.equal(result.outcome, "PREVIEWED");
    assert.equal(result.ok, true);
    assert.equal(result.writesAttempted, false);
    assert.equal(result.association?.originClientAccountId, CLIENT_ID);
    assert.equal(result.association?.matchedBy, "parent_url_key");
    assert.equal(result.association?.matchEvidence, PARENT_URL_KEY);
    assert.equal(result.before?.clientAccountIdResolved, null);
    assert.equal(result.before?.sourceFunnelFirstSeenAt, null);
    assert.deepEqual(result.plannedActions, [
      "observe_source_funnel_first_seen_last_seen",
      "re_run_routing_dry_run_on_existing_event",
      "reuse_existing_inventory_item",
      "stamp_null_origin_client_on_existing_inventory",
    ]);

    const event = await db.sourceLeadEvent.findUnique({ where: { id: createdEventIds[0]! } });
    assert.equal(event?.clientAccountIdResolved, null);
    assert.equal(event?.status, "routing_unmatched");
    const funnel = await db.sourceFunnel.findUnique({
      where: {
        provider_parentUrlKey: { provider: "leadcapture_io", parentUrlKey: PARENT_URL_KEY },
      },
    });
    assert.equal(funnel?.firstSeenAt, null);
  });

  it("applies once: reuses the event and inventory, resolves the client, delivers nothing", async () => {
    const sourceEventId = createdEventIds[0]!;
    const inventoryBefore = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: sourceEventId },
    });
    assert.ok(inventoryBefore, "intake already created the inventory row");

    const result = await reconcileOneLeadCaptureSourceEventAssociation(
      reconcileArgs({ apply: true }),
      { prisma: db }
    );
    assert.equal(result.outcome, "RECONCILED");
    assert.equal(result.ok, true);
    assert.equal(result.routing?.destinationClientAccountId, CLIENT_ID);
    assert.equal(result.routing?.routingAuthority, "confirmed_source_association");
    assert.equal(result.routing?.matchedRuleId, null);
    assert.equal(result.inventory?.reused, true);
    assert.equal(result.inventory?.inventoryItemId, inventoryBefore.id);
    assert.equal(result.inventory?.originStampedCount, 1);
    assert.equal(result.after?.inventoryCount, 1);
    assert.equal(result.after?.inventoryWithExpectedOriginCount, 1);
    assert.ok(result.after?.sourceFunnelFirstSeenAt);

    const events = await db.sourceLeadEvent.findMany({ where: { sourceRouteKey: ROUTE_KEY } });
    assert.equal(events.length, 1, "reconcile must not create a second lead event");
    assert.equal(events[0]!.id, sourceEventId);
    assert.equal(events[0]!.clientAccountIdResolved, CLIENT_ID);
    assert.equal(events[0]!.status, "routing_matched");

    const inventory = await db.leadInventoryItem.findMany({
      where: { sourceLeadEventId: sourceEventId },
    });
    assert.equal(inventory.length, 1, "reconcile must not create a second inventory item");
    assert.equal(inventory[0]!.id, inventoryBefore.id);
    assert.equal(inventory[0]!.originClientAccountId, CLIENT_ID);

    assert.equal(events[0]!.deliveredAt, null);
    assert.equal(events[0]!.deliveryResultJson, null);
    assert.equal(await db.fulfillmentOutbox.count({ where: { sourceLeadEventId: sourceEventId } }), 0);
    assert.equal(await db.leadAllocation.count({ where: { sourceLeadEventId: sourceEventId } }), 0);
    assert.equal(
      await db.metaDispatchAttempt.count({
        where: { eventUuid: events[0]!.sourceLeadUid ?? "" },
      }),
      0
    );
  });

  it("is idempotent when applied twice", async () => {
    const sourceEventId = createdEventIds[0]!;
    const result = await reconcileOneLeadCaptureSourceEventAssociation(
      reconcileArgs({ apply: true }),
      { prisma: db }
    );
    assert.equal(result.outcome, "RECONCILED");
    assert.equal(result.inventory?.reused, true);
    assert.equal(result.inventory?.originStampedCount, 0, "origin was already correct");

    const events = await db.sourceLeadEvent.findMany({ where: { sourceRouteKey: ROUTE_KEY } });
    assert.equal(events.length, 1);
    const inventory = await db.leadInventoryItem.findMany({
      where: { sourceLeadEventId: sourceEventId },
    });
    assert.equal(inventory.length, 1);
    assert.equal(inventory[0]!.originClientAccountId, CLIENT_ID);
    assert.equal(await db.fulfillmentOutbox.count({ where: { sourceLeadEventId: sourceEventId } }), 0);
    assert.equal(await db.leadAllocation.count({ where: { sourceLeadEventId: sourceEventId } }), 0);
  });

  it("refuses an event whose page has no confirmed association", async () => {
    const intake = await processLeadCaptureIoWebhookIntake({
      rawPayload: legacyPayload({
        lead_id: "lc_reconcile_unregistered_001",
        email: "lcrec.unregistered@example.test",
        phone: "5550108399",
        parent_url: UNREGISTERED_PAGE_URL,
      }),
      routeKeyFromPath: ROUTE_KEY,
    });
    createdEventIds.push(intake.sourceEventId);

    const result = await reconcileOneLeadCaptureSourceEventAssociation(
      reconcileArgs({
        sourceEventId: intake.sourceEventId,
        expectedLeadId: "lc_reconcile_unregistered_001",
        apply: true,
      }),
      { prisma: db }
    );
    assert.equal(result.outcome, "REFUSED");
    assert.equal(result.reasonCode, "source_association_unmatched");
    assert.equal(result.writesAttempted, false);

    const event = await db.sourceLeadEvent.findUnique({ where: { id: intake.sourceEventId } });
    assert.equal(event?.clientAccountIdResolved, null);
  });

  it("refuses an event with a pre-existing delivery side effect", async () => {
    const sourceEventId = createdEventIds[0]!;
    await db.sourceLeadEvent.update({
      where: { id: sourceEventId },
      data: { deliveredAt: new Date() },
    });
    try {
      const result = await reconcileOneLeadCaptureSourceEventAssociation(
        reconcileArgs({ apply: true }),
        { prisma: db }
      );
      assert.equal(result.outcome, "REFUSED");
      assert.equal(result.reasonCode, "preexisting_side_effects");
      assert.match(result.reason ?? "", /ghl_delivery/);
      assert.equal(result.writesAttempted, false);
    } finally {
      await db.sourceLeadEvent.update({
        where: { id: sourceEventId },
        data: { deliveredAt: null },
      });
    }
  });

  it("refuses before writing when inventory already belongs to another origin client", async () => {
    const sourceEventId = createdEventIds[0]!;
    const conflicted = await db.leadInventoryItem.updateMany({
      where: { sourceLeadEventId: sourceEventId },
      data: { originClientAccountId: OTHER_CLIENT_ID },
    });
    assert.ok(conflicted.count > 0, "expected an inventory row to conflict");
    try {
      const result = await reconcileOneLeadCaptureSourceEventAssociation(
        reconcileArgs({ apply: true }),
        { prisma: db }
      );
      assert.equal(result.outcome, "REFUSED");
      assert.equal(result.reasonCode, "inventory_origin_conflict");
      assert.equal(result.writesAttempted, false);
      assert.equal(result.before?.inventoryWithConflictingOriginCount, conflicted.count);

      // The conflicting origin is left exactly as it was.
      const rows = await db.leadInventoryItem.findMany({
        where: { sourceLeadEventId: sourceEventId },
        select: { originClientAccountId: true },
      });
      for (const row of rows) {
        assert.equal(row.originClientAccountId, OTHER_CLIENT_ID);
      }
    } finally {
      await db.leadInventoryItem.updateMany({
        where: { sourceLeadEventId: sourceEventId },
        data: { originClientAccountId: CLIENT_ID },
      });
    }
  });

  it("resolves and safely reconciles inventory canonically owned by another source event", async () => {
    const canonicalEventId = createdEventIds[0]!;
    const canonicalInventory = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: canonicalEventId },
    });
    assert.ok(canonicalInventory);
    assert.equal(canonicalInventory.originClientAccountId, CLIENT_ID);

    const crossEvent = await processLeadCaptureIoWebhookIntake({
      rawPayload: legacyPayload({
        lead_id: "lc_reconcile_cross_event_jean_shape",
        email: nicholasFixture.email,
        phone: nicholasFixture.phone,
      }),
      routeKeyFromPath: ROUTE_KEY,
    });
    createdEventIds.push(crossEvent.sourceEventId);
    assert.notEqual(crossEvent.sourceEventId, canonicalEventId);
    assert.equal(
      await db.leadInventoryItem.count({
        where: { sourceLeadEventId: crossEvent.sourceEventId },
      }),
      0,
      "same-client soft identity should reuse the canonical item"
    );
    await resetToPreFixState(crossEvent.sourceEventId);

    const args = reconcileArgs({
      sourceEventId: crossEvent.sourceEventId,
      expectedLeadId: "lc_reconcile_cross_event_jean_shape",
    });
    const preview = await reconcileOneLeadCaptureSourceEventAssociation(args, { prisma: db });
    assert.equal(preview.outcome, "PREVIEWED");
    assert.equal(preview.before?.inventoryCandidateCount, 1);
    assert.equal(preview.before?.canonicalInventoryItemId, canonicalInventory.id);
    assert.equal(preview.before?.canonicalSourceLeadEventId, canonicalEventId);
    assert.equal(preview.before?.canonicalOriginClientAccountId, CLIENT_ID);
    assert.equal(preview.before?.consumerIdentityMatch, "phone_fingerprint");
    assert.ok(preview.plannedActions?.includes("reuse_existing_inventory_item"));

    const applied = await reconcileOneLeadCaptureSourceEventAssociation(
      { ...args, apply: true },
      { prisma: db }
    );
    assert.equal(applied.outcome, "RECONCILED");
    assert.equal(applied.inventory?.inventoryItemId, canonicalInventory.id);
    assert.equal(applied.inventory?.reused, true);
    assert.equal(applied.after?.canonicalInventoryItemId, canonicalInventory.id);
    assert.equal(applied.after?.canonicalSourceLeadEventId, canonicalEventId);
    assert.equal(applied.after?.canonicalOriginClientAccountId, CLIENT_ID);
    assert.equal(
      await db.leadInventoryItem.count({
        where: {
          OR: [
            { sourceLeadEventId: canonicalEventId },
            { sourceLeadEventId: crossEvent.sourceEventId },
          ],
        },
      }),
      1
    );
    assert.equal(
      await db.fulfillmentOutbox.count({
        where: {
          sourceLeadEventId: { in: [canonicalEventId, crossEvent.sourceEventId] },
        },
      }),
      0
    );
    assert.equal(
      await db.leadAllocation.count({
        where: {
          OR: [
            { sourceLeadEventId: { in: [canonicalEventId, crossEvent.sourceEventId] } },
            { leadInventoryItemId: canonicalInventory.id },
          ],
        },
      }),
      0
    );
  });
});
