import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient, type LeadInventoryItemStatus, type Prisma } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { backfillStoredConsumerAges } from "../aged-inventory-import/aged-inventory-import-consumer-age.js";
import {
  diagnosePplInventorySelection,
  type InventorySelectionFunnelReport,
} from "./inventory-selection-funnel-diagnostic.js";
import { queryEligibleInventoryCandidatesBounded } from "./inventory-selection.service.js";
import { listActiveExclusions } from "./protected-agent-exclusion.service.js";

const integrationUrlRaw =
  process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim() ||
  process.env.SA360_TEST_DATABASE_URL?.trim() ||
  "";
const runIntegration = Boolean(integrationUrlRaw);

const CLIENT_ID = "client_lo1055_diag";
const ORDER_ID = "ord_lo1055_diag";
const OPEN_SUPPLIER = "supplier_lo1055_diag_open";
const PROTECTED_SUPPLIER = "supplier_lo1055_diag_protected";
const SAME_BUYER_PHONE = "+15550105599";

type RowSpec = {
  id: string;
  nicheKey?: string;
  state?: string;
  ageDays?: number;
  inventoryClass?: "aged" | "fresh";
  lot?: "open" | "protected" | "archived";
  status?: LeadInventoryItemStatus;
  commerceExcluded?: boolean;
  phone?: string | null;
  first?: string;
  last?: string;
  omitIdentity?: boolean;
  consumerAge?: string | null;
  rawAge?: string | null;
  metadataAge?: string | null;
};

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86400000);
}

function phoneFor(spec: RowSpec, index: number): string | null {
  if (spec.omitIdentity) return null;
  if (spec.phone !== undefined) return spec.phone;
  return `+1555010${String(1000 + index)}`;
}

function wizardPayload(spec: RowSpec, index: number): Prisma.InputJsonValue {
  if (spec.omitIdentity) return {};
  const payload: Record<string, unknown> = {
    firstName: spec.first ?? "Ada",
    lastName: spec.last ?? "Stone",
    email: `${spec.id}@example.test`,
    phone_e164: phoneFor(spec, index),
    state: spec.state ?? "IN",
    generated_at: daysAgo(spec.ageDays ?? 45).toISOString(),
    niche_key: spec.nicheKey ?? "veteran",
    product_type: null,
  };
  if (spec.consumerAge) {
    payload.consumer_age = spec.consumerAge;
    payload.lead_details = { consumer_age: spec.consumerAge };
  }
  return payload as Prisma.InputJsonValue;
}

describe("LO-1055 selection inventory funnel", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const createdItemIds: string[] = [];
  const createdEventIds: string[] = [];

  const eligiblePhone = "+15550105501";
  const specs: RowSpec[] = [
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `lo1055-pending-${index}`,
      status: "pending_review" as const,
      consumerAge: null,
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `lo1055-noage-${index}`,
      consumerAge: null,
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `lo1055-ready-${index}`,
      consumerAge: "62",
      phone: index === 0 ? eligiblePhone : `+1555010551${index}`,
    })),
    { id: "lo1055-oh", state: "OH", consumerAge: "62" },
    { id: "lo1055-fresh-age", ageDays: 5, consumerAge: "62" },
    { id: "lo1055-fresh-class", inventoryClass: "fresh", consumerAge: "62" },
    { id: "lo1055-archived", lot: "archived", consumerAge: "62" },
    { id: "lo1055-commerce-ex", commerceExcluded: true, consumerAge: "62" },
    { id: "lo1055-protected", lot: "protected", consumerAge: "62" },
    { id: "lo1055-noid", omitIdentity: true, consumerAge: "62" },
    { id: "lo1055-short-first", first: "A", consumerAge: "62" },
    { id: "lo1055-multipart", last: "Ann Lee", consumerAge: "62" },
    { id: "lo1055-dup", phone: eligiblePhone, consumerAge: "62" },
    { id: "lo1055-reserved", status: "reserved", consumerAge: "62" },
    { id: "lo1055-committed", status: "committed", consumerAge: "62" },
    { id: "lo1055-raw-age", consumerAge: null, rawAge: "70" },
    { id: "lo1055-vet-fex", nicheKey: "vet_fex", consumerAge: "62" },
    { id: "lo1055-nurse", nicheKey: "nurse", consumerAge: "62" },
    { id: "lo1055-fulfilled", status: "fulfilled", consumerAge: "62" },
    { id: "lo1055-vet-case", nicheKey: "VET", consumerAge: "62" },
    { id: "lo1055-same-buyer", phone: SAME_BUYER_PHONE, consumerAge: "62" },
    { id: "lo1055-metadata-age", consumerAge: null, metadataAge: "64" },
  ];

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    process.env.SA360_PPL_SELECTION_ENABLED = "true";
    db = new PrismaClient({ datasources: { db: { url } } });

    await db.clientAccount.upsert({
      where: { clientAccountId: CLIENT_ID },
      create: {
        clientAccountId: CLIENT_ID,
        clientDisplayName: "LO-1055 diagnostic buyer",
        status: "active",
        portalEnabled: false,
        primaryNicheKeys: ["vet"],
      },
      update: { status: "active" },
    });

    await db.protectedAgentExclusion.upsert({
      where: {
        matchType_matchValue: {
          matchType: "supplier_account_id",
          matchValue: PROTECTED_SUPPLIER,
        },
      },
      create: {
        matchType: "supplier_account_id",
        matchValue: PROTECTED_SUPPLIER,
        active: true,
        note: "LO-1055 diagnostic protected supplier",
      },
      update: { active: true },
    });

    await db.leadOrder.upsert({
      where: { id: ORDER_ID },
      create: {
        id: ORDER_ID,
        orderNumber: "LO-1055-DIAG",
        clientAccountId: CLIENT_ID,
        clientDisplayName: "LO-1055 diagnostic buyer",
        status: "active",
        nicheKey: "vet",
        statesJson: ["IN", "SC", "AZ"],
        leadVolume: 85,
        deliveryCadence: "manual_ops_workbench",
        campaignType: "aged_leads",
        crmPackage: "simulation_only",
        createdByRole: "admin",
        submittedAt: new Date(),
        activatedAt: new Date(),
        orderKind: "pay_per_lead",
        fulfillmentMode: "pooled_matching",
        requestedQuantity: 85,
      },
      update: {
        status: "active",
        nicheKey: "vet",
        statesJson: ["IN", "SC", "AZ"],
        requestedQuantity: 85,
        leadVolume: 85,
        pausedAt: null,
        completedAt: null,
        canceledAt: null,
      },
    });

    await db.inventoryLot.upsert({
      where: { lotKey: "lo1055-diag-open" },
      create: {
        lotKey: "lo1055-diag-open",
        displayName: "LO-1055 diagnostic open lot",
        sourceProvider: "manual_import",
        sourceLane: "aged_inventory_csv",
        nicheKey: "vet",
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        supplierAccountId: OPEN_SUPPLIER,
        status: "active",
        activatedAt: new Date(),
      },
      update: { status: "active", supplierAccountId: OPEN_SUPPLIER },
    });
    await db.inventoryLot.upsert({
      where: { lotKey: "lo1055-diag-protected" },
      create: {
        lotKey: "lo1055-diag-protected",
        displayName: "LO-1055 diagnostic protected lot",
        sourceProvider: "manual_import",
        sourceLane: "aged_inventory_csv",
        nicheKey: "vet",
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        supplierAccountId: PROTECTED_SUPPLIER,
        status: "active",
        activatedAt: new Date(),
      },
      update: { status: "active", supplierAccountId: PROTECTED_SUPPLIER },
    });
    await db.inventoryLot.upsert({
      where: { lotKey: "lo1055-diag-archived" },
      create: {
        lotKey: "lo1055-diag-archived",
        displayName: "LO-1055 diagnostic archived lot",
        sourceProvider: "manual_import",
        sourceLane: "aged_inventory_csv",
        nicheKey: "vet",
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        supplierAccountId: OPEN_SUPPLIER,
        status: "archived",
        archivedAt: new Date(),
      },
      update: { status: "archived" },
    });

    const sameBuyerEventId = "evt-lo1055-same-buyer-prior";
    await db.sourceLeadEvent.upsert({
      where: { id: sameBuyerEventId },
      create: {
        id: sameBuyerEventId,
        sourceProvider: "manual_import",
        sourceSystem: "csv_import",
        sourceType: "bulk_import",
        sourceLeadId: sameBuyerEventId,
        status: "normalized",
        rawPayloadJson: { importRequestId: "lo1055", rowNumber: 0 },
        normalizedPayloadJson: {},
        receivedAt: new Date(),
      },
      update: {},
    });
    createdEventIds.push(sameBuyerEventId);
    await db.buyerDeliveredIdentity.upsert({
      where: {
        clientAccountId_sourceLeadEventId: {
          clientAccountId: CLIENT_ID,
          sourceLeadEventId: sameBuyerEventId,
        },
      },
      create: {
        clientAccountId: CLIENT_ID,
        phoneFingerprint: fingerprintIdentityValue("phone", SAME_BUYER_PHONE),
        emailFingerprint: null,
        sourceLeadEventId: sameBuyerEventId,
        leadAllocationId: "alloc-lo1055-prior",
      },
      update: {
        phoneFingerprint: fingerprintIdentityValue("phone", SAME_BUYER_PHONE),
      },
    });
  });

  after(async () => {
    if (!db) return;
    await db.buyerDeliveredIdentity.deleteMany({ where: { clientAccountId: CLIENT_ID } });
    await db.leadInventoryItem.deleteMany({ where: { id: { in: createdItemIds } } });
    await db.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    await db.leadOrder.deleteMany({ where: { id: ORDER_ID } });
    await db.inventoryLot.deleteMany({
      where: { lotKey: { in: ["lo1055-diag-open", "lo1055-diag-protected", "lo1055-diag-archived"] } },
    });
    await db.protectedAgentExclusion.deleteMany({
      where: { matchType: "supplier_account_id", matchValue: PROTECTED_SUPPLIER },
    });
    await db.$disconnect();
  });

  async function seed(): Promise<void> {
    const lots = await db.inventoryLot.findMany({
      where: { lotKey: { in: ["lo1055-diag-open", "lo1055-diag-protected", "lo1055-diag-archived"] } },
    });
    const lotId = (key: string) => lots.find((lot) => lot.lotKey === key)!.id;
    for (const [index, spec] of specs.entries()) {
      const eventId = `evt-${spec.id}`;
      const payload = wizardPayload(spec, index);
      const phone = phoneFor(spec, index);
      await db.sourceLeadEvent.upsert({
        where: { id: eventId },
        create: {
          id: eventId,
          sourceProvider: "manual_import",
          sourceSystem: "csv_import",
          sourceType: "bulk_import",
          sourceLeadId: spec.id,
          status: "normalized",
          rawPayloadJson: {
            importRequestId: "lo1055",
            rowNumber: 1,
            ...(spec.rawAge ? { master: { dob_age_raw: spec.rawAge } } : {}),
          },
          normalizedPayloadJson: payload,
          enrichmentMetadataJson: {
            sourceLane: "aged_inventory_csv",
            generatedAt: daysAgo(spec.ageDays ?? 45).toISOString(),
            importClass: "aged_inventory_csv",
          },
          receivedAt: new Date(),
        },
        update: {
          normalizedPayloadJson: payload,
          rawPayloadJson: {
            importRequestId: "lo1055",
            rowNumber: 1,
            ...(spec.rawAge ? { master: { dob_age_raw: spec.rawAge } } : {}),
          },
        },
      });
      createdEventIds.push(eventId);
      const lotKey =
        spec.lot === "protected"
          ? "lo1055-diag-protected"
          : spec.lot === "archived"
            ? "lo1055-diag-archived"
            : "lo1055-diag-open";
      const status = spec.status ?? "available";
      const availableAt = status === "available" ? new Date() : null;
      await db.leadInventoryItem.upsert({
        where: { id: spec.id },
        create: {
          id: spec.id,
          inventoryLotId: lotId(lotKey),
          sourceLeadEventId: eventId,
          generatedAt: daysAgo(spec.ageDays ?? 45),
          normalizedState: spec.state ?? "IN",
          nicheKey: spec.nicheKey ?? "veteran",
          sourceProvider: "manual_import",
          sourceLane: "aged_inventory_csv",
          inventoryClass: spec.inventoryClass ?? "aged",
          exclusivityMode: "exclusive",
          status,
          availableAt,
          commerceExcludedAt: spec.commerceExcluded ? new Date() : null,
          phoneFingerprint: phone ? fingerprintIdentityValue("phone", phone) : null,
          metadataJson: spec.metadataAge ? { consumer_age: spec.metadataAge } : { importRequestId: "lo1055" },
        },
        update: {
          status,
          availableAt,
          commerceExcludedAt: spec.commerceExcluded ? new Date() : null,
          nicheKey: spec.nicheKey ?? "veteran",
          normalizedState: spec.state ?? "IN",
          generatedAt: daysAgo(spec.ageDays ?? 45),
          inventoryClass: spec.inventoryClass ?? "aged",
          inventoryLotId: lotId(lotKey),
          metadataJson: spec.metadataAge ? { consumer_age: spec.metadataAge } : { importRequestId: "lo1055" },
        },
      });
      createdItemIds.push(spec.id);
    }
  }

  function delta(after: InventorySelectionFunnelReport, before: InventorySelectionFunnelReport) {
    return {
      nicheMatch: after.stages.nicheMatch - before.stages.nicheMatch,
      states: after.stages.states - before.stages.states,
      ageBucket: after.stages.ageBucket - before.stages.ageBucket,
      aged: after.stages.inventoryClassAged - before.stages.inventoryClassAged,
      activeLot: after.stages.activeLot - before.stages.activeLot,
      pending: after.stages.status.pending_review - before.stages.status.pending_review,
      available: after.stages.status.available - before.stages.status.available,
      reserved: after.stages.status.reserved - before.stages.status.reserved,
      committed: after.stages.status.committed - before.stages.status.committed,
      other: after.stages.status.other - before.stages.status.other,
      commerceSet: after.stages.commerceExcludedAt.set - before.stages.commerceExcludedAt.set,
      finalEligible: after.stages.finalEligible - before.stages.finalEligible,
      missingAge: after.stages.buyerReady.missing_consumer_age - before.stages.buyerReady.missing_consumer_age,
      shortFirst: after.stages.buyerReady.first_name_too_short - before.stages.buyerReady.first_name_too_short,
      multipartLast: after.stages.buyerReady.last_name_multipart - before.stages.buyerReady.last_name_multipart,
      protected: after.stages.protectedAgentExcluded - before.stages.protectedAgentExcluded,
      sameBuyer: after.stages.sameBuyerPriorDelivery - before.stages.sameBuyerPriorDelivery,
      duplicate: after.stages.withinSelectionDuplicate - before.stages.withinSelectionDuplicate,
      blockedSolely: after.otherwiseEligibleBlockedByMissingConsumerAge - before.otherwiseEligibleBlockedByMissingConsumerAge,
      eligibleMissing:
        after.eligibleMissingConsumerAge - before.eligibleMissingConsumerAge,
      recoverable: after.recoverableStoredConsumerAge - before.recoverableStoredConsumerAge,
      noStored: after.noStoredConsumerAge - before.noStoredConsumerAge,
      ageResolved: after.consumerAgePolicy.age_resolved - before.consumerAgePolicy.age_resolved,
      ageMissing: after.consumerAgePolicy.age_missing - before.consumerAgePolicy.age_missing,
      ageInvalid: after.consumerAgePolicy.age_invalid - before.consumerAgePolicy.age_invalid,
      ageEligible: after.consumerAgePolicy.age_eligible - before.consumerAgePolicy.age_eligible,
      ageOverMaximum:
        after.consumerAgePolicy.age_over_86_dead - before.consumerAgePolicy.age_over_86_dead,
      pendingNoAge:
        after.pendingReviewConsumerAge.noStoredConsumerAge -
        before.pendingReviewConsumerAge.noStoredConsumerAge,
    };
  }

  it("explains LO-1055 filters with commerce aliases and does not invent consumer age", async () => {
    const input = {
      orderId: ORDER_ID,
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      requestedQuantity: 85,
    };
    const before = await diagnosePplInventorySelection(input, db);
    assert.equal(before.ok, true);
    if (!before.ok) return;

    await seed();

    const after = await diagnosePplInventorySelection(input, db);
    assert.equal(after.ok, true);
    if (!after.ok) return;
    const report = after.report;
    assert.deepEqual(report.nicheAliases, ["vet", "veteran", "vet_fex", "n_vet", "n_veteran"]);
    assert.deepEqual(report.states, ["IN", "SC", "AZ"]);
    assert.deepEqual(report.commerceAgeBucketKeys, ["COMMERCE_1_3_MO"]);
    assert.equal(report.ageDayRanges[0]?.minDaysInclusive, 30);
    assert.equal(report.ageDayRanges[0]?.maxDaysExclusive, 90);
    assert.equal(report.requestedQuantity, 85);
    assert.equal(report.agedImportFieldLoss.historicalCanonicalMappingOmittedConsumerAge, true);
    assert.equal(report.agedImportFieldLoss.historicalRawPayloadRetainsSourceCells, false);
    assert.equal(report.agedImportFieldLoss.consumerAgeDerivedFromLeadGeneratedAt, false);
    assert.equal(JSON.stringify(report).includes("@example.test"), false);
    assert.equal(JSON.stringify(report).includes("+1555"), false);

    const change = delta(report, before.report);
    assert.equal(change.nicheMatch, specs.filter((row) => row.nicheKey !== "nurse").length);
    assert.equal(change.states, change.nicheMatch - 1);
    assert.equal(change.ageBucket, change.states - 1);
    assert.equal(change.aged, change.ageBucket - 1);
    assert.equal(change.activeLot, change.aged - 1);
    assert.equal(change.pending, 8);
    assert.equal(change.reserved, 1);
    assert.equal(change.committed, 1);
    assert.equal(change.other, 1);
    assert.equal(change.commerceSet, 1);
    assert.equal(change.missingAge, 6);
    assert.equal(change.shortFirst, 1);
    assert.equal(change.multipartLast, 1);
    assert.equal(change.protected, 1);
    assert.equal(change.sameBuyer, 1);
    assert.equal(change.duplicate, 1);
    // Consumer age is required. Five rows carry a canonical age; two more
    // resolve from the raw payload / item metadata; the remaining four have no
    // age source anywhere and are now excluded.
    const eligibleWithCanonicalAge = 5;
    const eligibleOnlyViaRecoveredAge = 2;
    const blockedWithNoAgeSource = 4;
    assert.equal(change.finalEligible, eligibleWithCanonicalAge + eligibleOnlyViaRecoveredAge);
    assert.equal(change.eligibleMissing, eligibleOnlyViaRecoveredAge);
    assert.equal(change.blockedSolely, blockedWithNoAgeSource);
    assert.equal(change.recoverable, eligibleOnlyViaRecoveredAge);
    assert.equal(change.noStored, 0);
    assert.equal(change.pendingNoAge, 8);

    assert.equal(change.ageMissing, blockedWithNoAgeSource);
    assert.equal(change.ageInvalid, 0);
    assert.equal(change.ageOverMaximum, 0);
    assert.equal(change.ageResolved, change.ageEligible);
    assert.equal(report.consumerAgePolicy.maximumSellableAge, 86);
    assert.equal(report.consumerAgePolicy.deadCategory, "Dead — Age over 86");
    assert.equal(report.consumerAgePolicy.ageRequiredCategory, "Ineligible — Age required");

    assert.equal(report.stages.finalEligible < report.requestedQuantity, true);
    assert.equal(report.causes.inventoryActivation, true);
    // Four rows are rejected for age and two of the cohort's ages live outside
    // the canonical nest, so both the import-field-loss and buyer-ready-policy
    // causes are now true.
    assert.equal(report.causes.importFieldLoss, true);
    assert.equal(report.causes.buyerReadyPolicy, true);

    const selected = await queryEligibleInventoryCandidatesBounded(
      {
        nicheKey: "vet",
        states: ["IN", "SC", "AZ"],
        commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
        clientAccountId: CLIENT_ID,
        exclusions: await listActiveExclusions(db),
        evaluatedAt: new Date(),
        targetEligible: 5000,
        maxScannedRows: 5000,
      },
      db
    );
    const ours = selected.candidates.filter((candidate) => candidate.item.id.startsWith("lo1055-"));
    assert.deepEqual(
      ours.map((candidate) => candidate.item.id).sort(),
      [
        "lo1055-metadata-age",
        "lo1055-raw-age",
        "lo1055-ready-0",
        "lo1055-ready-1",
        "lo1055-ready-2",
        "lo1055-vet-case",
        "lo1055-vet-fex",
      ].sort()
    );
    assert.equal(selected.exclusionCounts.consumerAgeMissing >= blockedWithNoAgeSource, true);

    const backfill = await backfillStoredConsumerAges(
      ["lo1055-raw-age", "lo1055-metadata-age", "lo1055-noage-0"],
      db
    );
    assert.deepEqual(backfill.updatedIds.sort(), ["lo1055-metadata-age", "lo1055-raw-age"]);
    assert.equal(backfill.unchangedIds.includes("lo1055-noage-0"), true);

    const restored = await diagnosePplInventorySelection(input, db);
    assert.equal(restored.ok, true);
    if (!restored.ok) return;
    assert.equal(restored.report.stages.finalEligible - report.stages.finalEligible, 0);
    assert.equal(
      restored.report.eligibleMissingConsumerAge - report.eligibleMissingConsumerAge,
      -eligibleOnlyViaRecoveredAge
    );
    // Promoting a recoverable age does not rescue a row that has no age source.
    assert.equal(delta(restored.report, before.report).blockedSolely, blockedWithNoAgeSource);
  });
});
