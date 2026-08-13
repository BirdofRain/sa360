import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { seedPplAgedBetaFixtures } from "./ppl-beta-fixtures.js";
import {
  commitPplInventorySelection,
  releasePplAllocation,
} from "./inventory-selection.service.js";
import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { markSpreadsheetDelivered, commitBuyerCsvExport } from "./buyer-csv-export.service.js";
import { decideLeadReplacement, requestLeadReplacement } from "./replacement.service.js";

const integrationUrlRaw =
  process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim() ||
  process.env.SA360_TEST_DATABASE_URL?.trim() ||
  "";
const runIntegration = Boolean(integrationUrlRaw);

describe("PPL DB concurrency integration", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let fixtures: Awaited<ReturnType<typeof seedPplAgedBetaFixtures>>;
  let integrationUrl = "";

  before(async () => {
    integrationUrl = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = integrationUrl;
    process.env.SA360_PPL_SELECTION_ENABLED = "true";
    process.env.SA360_PPL_LOCAL_MIN_QTY = "1";
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    process.env.SA360_PPL_REPLACEMENT_ENABLED = "true";
    db = new PrismaClient({ datasources: { db: { url: integrationUrl } } });
  });


  after(async () => {
    await db?.$disconnect();
  });

  it("concurrent exact-qty commits: only one wins the exclusive item set", async () => {
    fixtures = await seedPplAgedBetaFixtures(db);
    const item = fixtures.cleanItems.find((row) => row.nicheKey === "vet" && row.state === "NC");
    assert.ok(item);

    const orderA = await db.leadOrder.create({
      data: {
        orderNumber: `PPL-CONC-A-${Date.now()}`,
        clientAccountId: fixtures.buyerClientId,
        status: "active",
        nicheKey: "vet",
        statesJson: ["NC"],
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
    const orderB = await db.leadOrder.create({
      data: {
        orderNumber: `PPL-CONC-B-${Date.now()}`,
        clientAccountId: fixtures.buyerClientId,
        status: "active",
        nicheKey: "vet",
        statesJson: ["NC"],
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

    // Shrink available NC vet stock to a single item for contention.
    await db.leadInventoryItem.updateMany({
      where: {
        nicheKey: "vet",
        normalizedState: "NC",
        status: "available",
        id: { not: item.id },
      },
      data: { status: "withdrawn", withdrawnAt: new Date() },
    });
    await db.leadInventoryItem.update({
      where: { id: item.id },
      data: { status: "available", reservedAt: null, committedAt: null },
    });

    const [resultA, resultB] = await Promise.all([
      commitPplInventorySelection(
        {
          orderId: orderA.id,
          requestedQuantity: 1,
          commerceAgeBucketKeys: [
            "COMMERCE_1_3_MO",
            "COMMERCE_3_6_MO",
            "COMMERCE_6_9_MO",
            "COMMERCE_12_MO_PLUS",
          ],
          idempotencyKey: `conc-a-${orderA.id}`,
        },
        db
      ),
      commitPplInventorySelection(
        {
          orderId: orderB.id,
          requestedQuantity: 1,
          commerceAgeBucketKeys: [
            "COMMERCE_1_3_MO",
            "COMMERCE_3_6_MO",
            "COMMERCE_6_9_MO",
            "COMMERCE_12_MO_PLUS",
          ],
          idempotencyKey: `conc-b-${orderB.id}`,
        },
        db
      ),
    ]);

    const wins = [resultA, resultB].filter((row) => row.ok);
    const losses = [resultA, resultB].filter((row) => !row.ok);
    assert.equal(wins.length, 1);
    assert.equal(losses.length, 1);
    if (!losses[0]!.ok) {
      assert.ok(
        losses[0]!.code === "shortage" ||
          losses[0]!.code === "reservation_conflict" ||
          losses[0]!.code === "no_inventory",
        `expected typed shortage/reservation_conflict/no_inventory, got ${losses[0]!.code}`
      );
      const serialized = JSON.stringify(losses[0]);
      assert.doesNotMatch(serialized, /40001|could not serialize|P2034|PrismaClient/i);
    }
    if (!wins[0]!.ok) throw new Error("expected winner");

    const winningItemId = wins[0]!.selectedItemIds[0]!;
    const activeForItem = await db.leadAllocation.findMany({
      where: {
        leadInventoryItemId: winningItemId,
        status: { in: ["reserved", "delivering", "committed"] },
      },
    });
    assert.equal(activeForItem.length, 1);

    const itemRow = await db.leadInventoryItem.findUniqueOrThrow({
      where: { id: winningItemId },
    });
    assert.equal(itemRow.status, "reserved");
    assert.equal(activeForItem[0]!.status, "reserved");

    // Replay winner is idempotent.
    const replay = await commitPplInventorySelection(
      {
        orderId: wins[0]!.orderId,
        requestedQuantity: 1,
        commerceAgeBucketKeys: [
          "COMMERCE_1_3_MO",
          "COMMERCE_3_6_MO",
          "COMMERCE_6_9_MO",
          "COMMERCE_12_MO_PLUS",
        ],
        idempotencyKey: wins[0]!.orderId === orderA.id ? `conc-a-${orderA.id}` : `conc-b-${orderB.id}`,
      },
      db
    );
    assert.equal(replay.ok, true);
    if (replay.ok) {
      assert.deepEqual(replay.allocationIds, wins[0]!.allocationIds);
    }

    // Failed exact-qty leaves no partial for loser.
    const loserOrderId = losses[0] && !losses[0].ok ? (resultA.ok ? orderB.id : orderA.id) : "";
    const loserAllocs = await db.leadAllocation.findMany({
      where: { leadOrderId: loserOrderId, status: { in: ["shadow", "reserved"] } },
    });
    assert.equal(loserAllocs.length, 0);

    // Pre-delivery release restores.
    const release = await releasePplAllocation(
      { allocationId: wins[0]!.allocationIds![0]!, reason: "concurrency_test_release" },
      db
    );
    assert.equal(release.ok, true);
    const restored = await db.leadInventoryItem.findUniqueOrThrow({
      where: { id: winningItemId },
    });
    assert.equal(restored.status, "available");
  });

  it("delivered inventory cannot be released; replacement cannot reselect original", async () => {
    // Re-seed clean state for this scenario
    fixtures = await seedPplAgedBetaFixtures(db);
    const commit = await commitPplInventorySelection(
      {
        orderId: fixtures.orderId,
        requestedQuantity: 1,
        commerceAgeBucketKeys: ["COMMERCE_1_3_MO", "COMMERCE_3_6_MO", "COMMERCE_6_9_MO", "COMMERCE_12_MO_PLUS"],
        idempotencyKey: `delivered-path-${fixtures.orderId}`,
      },
      db
    );
    assert.equal(commit.ok, true);
    if (!commit.ok) return;

    const exportCommit = await commitBuyerCsvExport(
      {
        orderId: fixtures.orderId,
        idempotencyKey: `export-${fixtures.orderId}`,
      },
      db
    );
    assert.equal(exportCommit.ok, true);
    if (!exportCommit.ok) return;

    // History must not exist yet.
    const before = await db.buyerDeliveredIdentity.count({
      where: { leadAllocationId: { in: exportCommit.allocationIds } },
    });
    assert.equal(before, 0);

    const delivered = await markSpreadsheetDelivered(
      {
        exportId: exportCommit.exportId,
        confirmationPhrase: "MARK SPREADSHEET DELIVERED",
        idempotencyKey: `delivered-${exportCommit.exportId}`,
        deliveredBy: "integration-test",
      },
      db
    );
    assert.equal(delivered.ok, true);
    if (!delivered.ok) return;

    const after = await db.buyerDeliveredIdentity.count({
      where: { leadAllocationId: { in: delivered.allocationIds } },
    });
    assert.equal(after, delivered.allocationIds.length);

    const releaseBlocked = await releasePplAllocation(
      { allocationId: delivered.allocationIds[0]!, reason: "should_fail" },
      db
    );
    assert.equal(releaseBlocked.ok, false);

    const originalItemId = commit.selectedItemIds[0]!;
    const originalAllocationId = delivered.allocationIds[0]!;
    const originalAlloc = await db.leadAllocation.findUniqueOrThrow({
      where: { id: originalAllocationId },
      select: {
        clientAccountId: true,
        sourceLeadEvent: { select: { normalizedPayloadJson: true } },
      },
    });
    const identity = readNormalizedLeadIdentity(
      originalAlloc.sourceLeadEvent.normalizedPayloadJson
    );
    assert.ok(identity?.phoneE164 || identity?.email);
    // Independent prior same-buyer delivery proof (history-lag / prior batch).
    await db.buyerDeliveredIdentity.create({
      data: {
        clientAccountId: originalAlloc.clientAccountId,
        phoneFingerprint: identity?.phoneE164
          ? fingerprintIdentityValue("phone", identity.phoneE164)
          : null,
        emailFingerprint: identity?.email
          ? fingerprintIdentityValue("email", identity.email)
          : null,
        sourceLeadEventId: `prior-event-${originalAllocationId}`,
        leadAllocationId: `prior-alloc-${originalAllocationId}`,
        leadInventoryItemId: null,
      },
    });

    const req = await requestLeadReplacement(
      {
        originalAllocationId,
        reason: "Buyer reported duplicate",
        requestId: `repl-${originalAllocationId}`,
        reasonCode: "duplicate",
      },
      db
    );
    assert.equal(req.ok, true);
    if (!req.ok) return;

    const decision = await decideLeadReplacement(
      {
        replacementId: req.item.id,
        action: "approve",
        confirmationPhrase: "APPROVE REPLACEMENT",
        requestId: `repl-dec-${req.item.id}`,
      },
      db
    );
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.ok(decision.item.replacementInventoryItemId);
    assert.notEqual(decision.item.replacementInventoryItemId, originalItemId);

    const original = await db.leadInventoryItem.findUniqueOrThrow({
      where: { id: originalItemId },
    });
    assert.notEqual(original.status, "available");
  });
});
