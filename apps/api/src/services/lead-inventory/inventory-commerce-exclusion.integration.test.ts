import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { reserveLeadAllocationAtomicTx } from "../fulfillment-execution/reservation.service.js";
import { queryEligibleInventoryCandidatesBounded } from "../ppl-fulfillment/inventory-selection.service.js";
import {
  excludeInventoryItemFromCommerce,
  INVENTORY_COMMERCE_EXCLUDE_CONFIRMATION,
} from "./inventory-commerce-exclusion.service.js";

const integrationUrlRaw =
  process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim() ||
  process.env.SA360_TEST_DATABASE_URL?.trim() ||
  "";
const runIntegration = Boolean(integrationUrlRaw);

describe("inventory commerce exclusion integration", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let safeDatabaseUrl = "";
  const itemId = "inv-commerce-exclusion-probe";
  const eventId = "evt-commerce-exclusion-probe";
  const nicheKey = "vet_commerce_exclusion_probe";
  const state = "WY";

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    safeDatabaseUrl = url;
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } } });

    await db.clientAccount.upsert({
      where: { clientAccountId: "client_commerce_exclusion_probe" },
      create: {
        clientAccountId: "client_commerce_exclusion_probe",
        clientDisplayName: "Commerce exclusion probe",
        status: "active",
        portalEnabled: false,
        primaryNicheKeys: [nicheKey],
      },
      update: { status: "active" },
    });

    const lot = await db.inventoryLot.upsert({
      where: { lotKey: "commerce-exclusion-probe-lot" },
      create: {
        lotKey: "commerce-exclusion-probe-lot",
        displayName: "Commerce exclusion probe lot",
        sourceProvider: "manual_import",
        sourceLane: "aged_csv_beta",
        nicheKey,
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        supplierAccountId: "supplier_commerce_exclusion_probe",
        status: "active",
        activatedAt: new Date(),
      },
      update: { status: "active", nicheKey },
    });

    const payload = {
      contact: {
        first_name: "Excl",
        last_name: "Probe",
        phone_e164: "+15553110001",
        email: "commerce.exclusion.probe@example.test",
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
        sourceLeadId: "commerce-excl-src-1",
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
        commerceExcludedAt: null,
        commerceExcludedReason: null,
        commerceExcludedBy: null,
        inventoryLotId: lot.id,
        normalizedState: state,
        nicheKey,
      },
    });
  });

  after(async () => {
    await db?.$disconnect();
  });

  it("selection then exclude then reserve: exclusion wins the race", async () => {
    await db.leadInventoryItem.update({
      where: { id: itemId },
      data: {
        status: "available",
        commerceExcludedAt: null,
        commerceExcludedReason: null,
        commerceExcludedBy: null,
      },
    });

    const evaluatedAt = new Date();
    const before = await queryEligibleInventoryCandidatesBounded(
      {
        nicheKey,
        states: [state],
        commerceAgeBucketKeys: ["COMMERCE_1_3_MO", "COMMERCE_3_6_MO"],
        clientAccountId: "client_commerce_exclusion_probe",
        exclusions: [],
        evaluatedAt,
        targetEligible: 5,
      },
      db
    );
    assert.ok(before.candidates.some((row) => row.item.id === itemId));

    const excluded = await excludeInventoryItemFromCommerce(
      {
        inventoryItemId: itemId,
        expectedSourceEventId: eventId,
        expectedDbHost: new URL(safeDatabaseUrl).hostname,
        reason: "synthetic_nextgen_canary",
        operator: "Sam",
        confirm: INVENTORY_COMMERCE_EXCLUDE_CONFIRMATION,
        databaseUrl: safeDatabaseUrl,
      },
      db
    );
    assert.equal(excluded.outcome, "EXCLUDED");

    const after = await queryEligibleInventoryCandidatesBounded(
      {
        nicheKey,
        states: [state],
        commerceAgeBucketKeys: ["COMMERCE_1_3_MO", "COMMERCE_3_6_MO"],
        clientAccountId: "client_commerce_exclusion_probe",
        exclusions: [],
        evaluatedAt,
        targetEligible: 5,
      },
      db
    );
    assert.equal(
      after.candidates.some((row) => row.item.id === itemId),
      false
    );

    const order = await db.leadOrder.create({
      data: {
        orderNumber: `EXCL-RACE-${Date.now()}`,
        clientAccountId: "client_commerce_exclusion_probe",
        status: "active",
        nicheKey,
        statesJson: [state],
        leadVolume: 1,
        deliveryCadence: "test",
        campaignType: "exclusion",
        crmPackage: "simulation_only",
        createdByRole: "admin",
        submittedAt: new Date(),
        activatedAt: new Date(),
        orderKind: "pay_per_lead",
        fulfillmentMode: "pooled_matching",
        requestedQuantity: 1,
      },
    });

    const allocation = await db.leadAllocation.create({
      data: {
        sourceLeadEventId: eventId,
        leadOrderId: order.id,
        clientAccountId: "client_commerce_exclusion_probe",
        leadInventoryItemId: itemId,
        status: "shadow",
        allocationPolicyVersion: "ppl-exclusion-probe",
        decisionReasonsJson: ["stale_selection_after_exclude"],
        candidateCount: 1,
        idempotencyKey: `ppl-exclusion-probe:${Date.now()}`,
        proposedAt: new Date(),
      },
    });

    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          reserveLeadAllocationAtomicTx(allocation.id, `res-${allocation.id}`, tx)
        ),
      /inventory_reserve_failed|capacity_claim_failed/
    );

    const item = await db.leadInventoryItem.findUniqueOrThrow({ where: { id: itemId } });
    assert.ok(item.commerceExcludedAt);
    assert.equal(item.status, "available");
  });
});
