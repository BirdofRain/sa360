import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { commitPplInventorySelection } from "./inventory-selection.service.js";

const integrationUrl = process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim();
const runIntegration = Boolean(integrationUrl);

function assertLocalhost(url: string | undefined): string {
  const value = url?.trim() ?? "";
  const host = new URL(value).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`DATABASE_URL_remote_blocked:${host}`);
  }
  return value;
}

describe("PPL selection DB concurrency (PR1)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const buyerId = "client_pr55_selection_concurrency";
  const itemId = "pr55-selection-concurrency-item";
  const eventId = "pr55-selection-concurrency-evt";
  // Unique niche/state so this probe cannot select leftover beta-fixture inventory.
  const nicheKey = "vet_concurrency_probe";
  const state = "AK";

  before(async () => {
    const url = assertLocalhost(integrationUrl);
    process.env.DATABASE_URL = url;
    process.env.SA360_PPL_SELECTION_ENABLED = "true";
    process.env.SA360_PPL_LOCAL_MIN_QTY = "1";
    db = new PrismaClient({ datasources: { db: { url } } });

    await db.clientAccount.upsert({
      where: { clientAccountId: buyerId },
      create: {
        clientAccountId: buyerId,
        clientDisplayName: "PR55 selection concurrency",
        status: "active",
        portalEnabled: false,
        primaryNicheKeys: [nicheKey],
      },
      update: { status: "active" },
    });

    const lot = await db.inventoryLot.upsert({
      where: { lotKey: "pr55-selection-concurrency-lot" },
      create: {
        lotKey: "pr55-selection-concurrency-lot",
        displayName: "PR55 selection concurrency lot",
        sourceProvider: "manual_import",
        sourceLane: "aged_csv_beta",
        nicheKey,
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        // Explicit owner so fail-closed protected-agent rules do not exclude this probe
        // when other suites have seeded active ProtectedAgentExclusion rows.
        supplierAccountId: "supplier_pr55_selection_concurrency",
        status: "active",
        activatedAt: new Date(),
      },
      update: {
        status: "active",
        nicheKey,
        supplierAccountId: "supplier_pr55_selection_concurrency",
      },
    });

    const payload = {
      contact: {
        first_name: "Conc",
        last_name: "Lead",
        phone_e164: "+15551112201",
        email: "pr55.selection.conc@example.test",
        state,
      },
    };

    await db.sourceLeadEvent.upsert({
      where: { id: eventId },
      create: {
        id: eventId,
        sourceProvider: "manual_import",
        sourceSystem: "leadcapture_io_legacy",
        sourceType: "manual_entry",
        sourceLeadId: "pr55-sel-src-1",
        status: "approved",
        rawPayloadJson: payload,
        normalizedPayloadJson: payload,
        receivedAt: new Date(Date.now() - 90 * 86400000),
        normalizedAt: new Date(),
        approvedAt: new Date(),
      },
      update: { status: "approved", normalizedPayloadJson: payload },
    });

    await db.leadAllocation.deleteMany({ where: { leadInventoryItemId: itemId } });
    await db.leadInventoryItem.upsert({
      where: { id: itemId },
      create: {
        id: itemId,
        inventoryLotId: lot.id,
        sourceLeadEventId: eventId,
        generatedAt: new Date(Date.now() - 90 * 86400000),
        normalizedState: state,
        nicheKey,
        sourceProvider: "manual_import",
        sourceLane: "aged_csv_beta",
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        status: "available",
        availableAt: new Date(),
      },
      update: {
        status: "available",
        reservedAt: null,
        committedAt: null,
        inventoryLotId: lot.id,
        normalizedState: state,
        nicheKey,
      },
    });
  });

  after(async () => {
    await db?.$disconnect();
  });

  it("contending orders: one wins, loser gets typed conflict/shortage, no raw 40001", async () => {
    await db.leadAllocation.deleteMany({ where: { leadInventoryItemId: itemId } });
    await db.leadInventoryItem.update({
      where: { id: itemId },
      data: { status: "available", reservedAt: null, committedAt: null },
    });

    const mkOrder = async (suffix: string) =>
      db.leadOrder.create({
        data: {
          orderNumber: `PR55-SEL-${suffix}-${Date.now()}`,
          clientAccountId: buyerId,
          status: "active",
          nicheKey,
          statesJson: [state],
          leadVolume: 1,
          deliveryCadence: "test",
          campaignType: "concurrency",
          crmPackage: "simulation_only",
          createdByRole: "admin",
          submittedAt: new Date(),
          activatedAt: new Date(),
          orderKind: "pay_per_lead",
          fulfillmentMode: "pooled_matching",
          requestedQuantity: 1,
        },
      });

    const orderA = await mkOrder("A");
    const orderB = await mkOrder("B");
    const buckets = [
      "COMMERCE_1_3_MO",
      "COMMERCE_3_6_MO",
      "COMMERCE_6_12_MO",
      "COMMERCE_12_MO_PLUS",
    ];

    const [resultA, resultB] = await Promise.all([
      commitPplInventorySelection(
        {
          orderId: orderA.id,
          requestedQuantity: 1,
          commerceAgeBucketKeys: buckets,
          idempotencyKey: `pr55-sel-a-${orderA.id}`,
        },
        db
      ),
      commitPplInventorySelection(
        {
          orderId: orderB.id,
          requestedQuantity: 1,
          commerceAgeBucketKeys: buckets,
          idempotencyKey: `pr55-sel-b-${orderB.id}`,
        },
        db
      ),
    ]);

    const wins = [resultA, resultB].filter((row) => row.ok);
    const losses = [resultA, resultB].filter((row) => !row.ok);
    assert.equal(wins.length, 1, "exactly one reservation succeeds");
    assert.equal(losses.length, 1, "exactly one contender loses");

    const loss = losses[0]!;
    assert.equal(loss.ok, false);
    if (!loss.ok) {
      assert.ok(
        loss.code === "reservation_conflict" || loss.code === "shortage",
        `expected typed domain code, got ${loss.code}`
      );
      const serialized = JSON.stringify(loss);
      assert.doesNotMatch(serialized, /40001/);
      assert.doesNotMatch(serialized, /could not serialize/i);
      assert.doesNotMatch(serialized, /P2034/);
      assert.doesNotMatch(serialized, /PrismaClient/);
      assert.doesNotMatch(serialized, /Raw query failed/i);
      for (const reason of loss.reasons) {
        assert.doesNotMatch(reason, /40001|P2034|serialize|Prisma|Raw query/i);
      }
    }

    const active = await db.leadAllocation.findMany({
      where: {
        leadInventoryItemId: itemId,
        status: { in: ["reserved", "delivering", "committed"] },
      },
    });
    assert.equal(active.length, 1);

    const item = await db.leadInventoryItem.findUniqueOrThrow({ where: { id: itemId } });
    assert.equal(item.status, "reserved");

    // Idempotent replay of the winner still returns the successful reservation.
    const winner = wins[0]!;
    assert.equal(winner.ok, true);
    if (!winner.ok) return;
    const replay = await commitPplInventorySelection(
      {
        orderId: winner.orderId,
        requestedQuantity: 1,
        commerceAgeBucketKeys: buckets,
        idempotencyKey:
          winner.orderId === orderA.id
            ? `pr55-sel-a-${orderA.id}`
            : `pr55-sel-b-${orderB.id}`,
      },
      db
    );
    assert.equal(replay.ok, true);
    if (replay.ok) {
      assert.deepEqual(replay.allocationIds, winner.allocationIds);
    }

    const activeAfterReplay = await db.leadAllocation.count({
      where: {
        leadInventoryItemId: itemId,
        status: { in: ["reserved", "delivering", "committed"] },
      },
    });
    assert.equal(activeAfterReplay, 1);
  });
});
