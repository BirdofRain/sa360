/**
 * Local Postgres proof for buyer inventory availability.
 * Uses SA360_TEST_DATABASE_URL only (localhost, database name contains "test").
 * Never points at a remote or production database.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";
import { CANONICAL_US_STATE_CODES } from "@sa360/shared";

import { fingerprintPhoneIdentity } from "../../lib/identity-fingerprint.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  BUYER_AVAILABILITY_MAX_CLASSIFIED_ROWS,
  lookupBuyerInventoryAvailability,
} from "./buyer-inventory-availability.service.js";

const integrationUrlRaw =
  process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim() ||
  process.env.SA360_TEST_DATABASE_URL?.trim() ||
  "";
const runIntegration = Boolean(integrationUrlRaw);

const BUYER_ID = "client_bav_jr_laird";
const OTHER_ID = "client_bav_other";
const EVALUATED_AT = new Date("2026-08-24T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
/** Enough rows that the 3–6 month selectable cohort exceeds one 100,000-row pass. */
const BULK_ROWS = 112_000;
const ARTIFACT_DIR = "/opt/cursor/artifacts";

function withApplicationName(databaseUrl: string, applicationName: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("application_name", applicationName);
  return url.toString();
}

function payload(phone: string, email: string) {
  return {
    contact: {
      first_name: "Ada",
      last_name: "Lee",
      phone_e164: phone,
      email,
      state: "GA",
    },
    lead_details: { consumer_age: 62 },
  };
}

function daysAgo(days: number): Date {
  return new Date(EVALUATED_AT.getTime() - days * DAY_MS);
}

describe("buyer inventory availability postgres proof", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let mutator: PrismaClient;
  let probe: PrismaClient;
  let lotId = "";
  const databaseUrl = integrationUrlRaw;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(databaseUrl);
    db = new PrismaClient({
      datasources: { db: { url: withApplicationName(url, "bav_lookup") } },
    });
    mutator = new PrismaClient({
      datasources: { db: { url: withApplicationName(url, "bav_mutator") } },
    });
    probe = new PrismaClient({
      datasources: { db: { url: withApplicationName(url, "bav_probe") } },
    });
    await cleanup(db);
    await db.clientAccount.upsert({
      where: { clientAccountId: BUYER_ID },
      create: {
        clientAccountId: BUYER_ID,
        clientDisplayName: "JR Laird",
        status: "active",
        portalEnabled: false,
        primaryNicheKeys: ["trucker"],
      },
      update: { clientDisplayName: "JR Laird", status: "active" },
    });
    await db.clientAccount.upsert({
      where: { clientAccountId: OTHER_ID },
      create: {
        clientAccountId: OTHER_ID,
        clientDisplayName: "Other origin",
        status: "active",
        portalEnabled: false,
        primaryNicheKeys: ["trucker"],
      },
      update: { status: "active" },
    });
    const lot = await db.inventoryLot.upsert({
      where: { lotKey: "bav-availability-lot" },
      create: {
        lotKey: "bav-availability-lot",
        displayName: "Buyer availability proof lot",
        sourceProvider: "manual_import",
        sourceLane: "avail_bench_16e9",
        nicheKey: "trucker",
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        supplierAccountId: "supplier_bav_availability",
        status: "active",
        activatedAt: EVALUATED_AT,
      },
      update: {
        status: "active",
        supplierAccountId: "supplier_bav_availability",
        nicheKey: "trucker",
      },
    });
    lotId = lot.id;
  });

  after(async () => {
    if (db) {
      await cleanup(db);
      await db.$disconnect();
    }
    await mutator?.$disconnect();
    await probe?.$disconnect();
  });

  it("JR Laird / GA / trucker / all aged buckets excludes origin, prior delivery, and open claims", async () => {
    const beforeOrders = await db.leadOrder.count({ where: { clientAccountId: BUYER_ID } });
    const beforeAllocations = await db.leadAllocation.count({ where: { clientAccountId: BUYER_ID } });
    const beforeFunnels = await db.sourceFunnel.count({
      where: { id: { startsWith: "bav-" } },
    });
    const baseline = await lookupBuyerInventoryAvailability(
      {
        clientAccountId: BUYER_ID,
        nicheKey: "trucker",
        states: ["GA"],
        evaluatedAt: EVALUATED_AT,
      },
      db
    );
    assert.equal(baseline.ok, true);
    if (!baseline.ok) return;
    assert.equal(baseline.queryCompleteness, "complete");
    assert.equal(baseline.buyer.clientDisplayName, "JR Laird");
    assert.equal(baseline.nicheKey, "trucker");
    assert.deepEqual(baseline.states, ["GA"]);
    assert.equal(baseline.allAgedTiers, true);
    assert.equal(baseline.snapshot.consistent, true);
    assert.equal(baseline.snapshot.readOnly, true);

    await seedScenario(db, lotId);

    const ordersAtLookup = await db.leadOrder.count({ where: { clientAccountId: BUYER_ID } });
    const report = await lookupBuyerInventoryAvailability(
      {
        clientAccountId: BUYER_ID,
        nicheKey: "trucker",
        states: ["GA"],
        evaluatedAt: EVALUATED_AT,
      },
      db
    );
    assert.equal(report.ok, true);
    if (!report.ok) return;
    assert.equal(report.queryCompleteness, "complete");
    assert.equal(report.eligibleCountSemantics, "exact");
    assert.equal(report.snapshot.isolation, "repeatable_read");
    assert.equal(report.eligibleTotal - baseline.eligibleTotal, 6);
    const tierDelta = (key: string) => {
      const after = report.ageTiers.find((tier) => tier.commerceAgeBucketKey === key);
      const prior = baseline.ageTiers.find((tier) => tier.commerceAgeBucketKey === key);
      assert.equal(after?.countSemantics, "exact");
      return (after?.eligible ?? 0) - (prior?.eligible ?? 0);
    };
    assert.equal(tierDelta("COMMERCE_1_3_MO"), 2);
    assert.equal(tierDelta("COMMERCE_3_6_MO"), 1);
    assert.equal(tierDelta("COMMERCE_6_9_MO"), 1);
    assert.equal(tierDelta("COMMERCE_9_12_MO"), 1);
    assert.equal(tierDelta("COMMERCE_12_MO_PLUS"), 1);
    assert.equal(
      report.structuralCohort.stampedSameOrigin - baseline.structuralCohort.stampedSameOrigin,
      1
    );
    assert.equal(
      report.exclusionReasons.originClientReconciled.count -
        baseline.exclusionReasons.originClientReconciled.count,
      1
    );
    assert.equal(
      report.exclusionReasons.originUnresolved.count - baseline.exclusionReasons.originUnresolved.count,
      2
    );
    assert.equal(
      (report.provenance.unresolvedReasons.provider_not_reconcilable ?? 0) -
        (baseline.provenance.unresolvedReasons.provider_not_reconcilable ?? 0),
      1
    );
    assert.equal(
      (report.provenance.unresolvedReasons.source_not_confirmed ?? 0) -
        (baseline.provenance.unresolvedReasons.source_not_confirmed ?? 0),
      1
    );
    assert.equal(
      report.exclusionReasons.sameBuyerPriorDelivery.count -
        baseline.exclusionReasons.sameBuyerPriorDelivery.count,
      1
    );
    assert.equal(
      report.structuralCohort.openAllocationOnAvailable -
        baseline.structuralCohort.openAllocationOnAvailable,
      1
    );
    assert.equal(report.structuralCohort.reserved - baseline.structuralCohort.reserved, 1);
    assert.equal(report.effects.orderCreated, false);
    assert.equal(report.effects.reservationCreated, false);
    assert.equal(report.effects.deliveryRecorded, false);
    assert.equal(report.effects.csvGenerated, false);
    assert.equal(report.effects.sourceDataMutated, false);
    assert.equal(report.scan.usesSelectionRowCap, false);
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes("+1404"), false);
    assert.equal(serialized.includes("Ada"), false);
    assert.equal(serialized.includes("Lee"), false);
    assert.equal(serialized.includes("@bench.test"), false);
    assert.equal(serialized.includes("normalizedPayloadJson"), false);
    assert.equal(await db.leadOrder.count({ where: { clientAccountId: BUYER_ID } }), ordersAtLookup);
    assert.equal(
      await db.leadAllocation.count({ where: { clientAccountId: BUYER_ID } }),
      beforeAllocations + 1
    );
    assert.equal(beforeOrders + 1, ordersAtLookup);
    assert.equal(
      await db.sourceFunnel.count({ where: { id: { startsWith: "bav-" } } }),
      beforeFunnels + 2
    );
  });

  it("keeps the pre-mutation snapshot while inventory and source association change", async () => {
    await seedConcurrencyRows(db, lotId);
    let mutated = false;
    let inTransaction = 0;
    const report = await lookupBuyerInventoryAvailability(
      {
        clientAccountId: BUYER_ID,
        nicheKey: "trucker",
        states: ["SD"],
        evaluatedAt: EVALUATED_AT,
        pageSize: 1,
        afterClassificationPage: async ({ pagesRead }) => {
          if (pagesRead !== 1 || mutated) return;
          mutated = true;
          const sample = await probe.$queryRaw<Array<{ n: number }>>`
            SELECT count(*)::int AS n
            FROM pg_stat_activity
            WHERE application_name = 'bav_lookup'
              AND xact_start IS NOT NULL
          `;
          inTransaction = sample[0]?.n ?? 0;
          await mutator.leadInventoryItem.update({
            where: { id: "bav-sd-mid" },
            data: { status: "reserved", reservedAt: EVALUATED_AT },
          });
          await mutator.leadInventoryItem.update({
            where: { id: "bav-sd-young" },
            data: { originClientAccountId: BUYER_ID },
          });
          await mutator.sourceFunnel.update({
            where: { id: "bav-sd-funnel" },
            data: { originClientAccountId: BUYER_ID, associationStatus: "confirmed" },
          });
          await insertInventoryRow(mutator, {
            id: "bav-sd-inserted",
            eventId: "bav-sd-inserted-evt",
            lotId,
            ageDays: 35,
            phone: "+14045558099",
            origin: OTHER_ID,
            state: "SD",
            provider: "manual_import",
          });
        },
      },
      db
    );
    assert.equal(mutated, true);
    assert.equal(inTransaction, 1);
    assert.equal(report.ok, true);
    if (!report.ok) return;
    assert.equal(report.queryCompleteness, "complete");
    assert.equal(report.eligibleCountSemantics, "exact");
    assert.equal(report.eligibleTotal, 3);
    assert.equal(report.scan.selectableRowsExact, 3);
    assert.equal(report.scan.rowsClassified, 3);
    assert.equal(report.structuralCohort.reserved, 0);
    assert.equal(report.structuralCohort.stampedSameOrigin, 0);
    const liveYoung = await mutator.leadInventoryItem.findUniqueOrThrow({
      where: { id: "bav-sd-young" },
    });
    assert.equal(liveYoung.originClientAccountId, BUYER_ID);
    const liveMid = await mutator.leadInventoryItem.findUniqueOrThrow({
      where: { id: "bav-sd-mid" },
    });
    assert.equal(liveMid.status, "reserved");
    assert.equal(
      await mutator.leadInventoryItem.count({ where: { id: "bav-sd-inserted" } }),
      1
    );
  });

  it(
    "completes a nationwide 3–6 month count past the 100,000-row pass",
    { timeout: 900_000 },
    async () => {
    await db.leadInventoryItem.deleteMany({
      where: { OR: [{ id: { startsWith: "bav-" } }, { id: { startsWith: "bav100k-" } }] },
    });
    await db.sourceLeadEvent.deleteMany({
      where: { OR: [{ id: { startsWith: "bav-" } }, { id: { startsWith: "bav100k-" } }] },
    });
    const bulkEvaluatedAt = new Date("2026-08-24T12:00:00.000Z");
    const stateList = Prisma.join(CANONICAL_US_STATE_CODES.map((code) => Prisma.sql`${code}`));
    const insertStarted = Date.now();
    await db.$executeRaw`
      INSERT INTO "SourceLeadEvent" (
        id,
        "sourceProvider",
        "sourceSystem",
        "sourceType",
        status,
        "rawPayloadJson",
        "normalizedPayloadJson",
        "enrichmentMetadataJson",
        "receivedAt",
        "createdAt",
        "updatedAt"
      )
      SELECT
        'bav100k-evt-' || lpad(s.g::text, 6, '0'),
        'manual_import'::"SourceLeadProvider",
        'csv_import'::"SourceLeadSystem",
        'bulk_import'::"SourceLeadType",
        'approved'::"SourceLeadEventStatus",
        jsonb_build_object(
          'contact', jsonb_build_object(
            'first_name', 'Ada',
            'last_name', 'Lee',
            'phone_e164', '+1404' || lpad((200 + ((s.phone_key - 1) % 800))::text, 3, '0') || lpad((((s.phone_key - 1) / 800))::int::text, 4, '0'),
            'email', 'bav' || s.g::text || '@bench.test',
            'state', s.state_code
          ),
          'lead_details', jsonb_build_object('consumer_age', 62)
        ),
        jsonb_build_object(
          'contact', jsonb_build_object(
            'first_name', 'Ada',
            'last_name', 'Lee',
            'phone_e164', '+1404' || lpad((200 + ((s.phone_key - 1) % 800))::text, 3, '0') || lpad((((s.phone_key - 1) / 800))::int::text, 4, '0'),
            'email', 'bav' || s.g::text || '@bench.test',
            'state', s.state_code
          ),
          'lead_details', jsonb_build_object('consumer_age', 62)
        ),
        '{}'::jsonb,
        ${bulkEvaluatedAt}::timestamptz - interval '120 days' + (s.g * interval '1 millisecond'),
        NOW(),
        NOW()
      FROM (
        SELECT
          g,
          CASE WHEN g > 50 AND g % 50 = 0 THEN g - 50 ELSE g END AS phone_key,
          (ARRAY[${stateList}]::text[])[1 + ((g - 1) % 51)] AS state_code
        FROM generate_series(1, ${BULK_ROWS}) AS g
      ) s
    `;
    await db.$executeRaw`
      INSERT INTO "LeadInventoryItem" (
        id,
        "inventoryLotId",
        "sourceLeadEventId",
        "generatedAt",
        "normalizedState",
        "nicheKey",
        "sourceProvider",
        "sourceLane",
        "inventoryClass",
        "exclusivityMode",
        status,
        "availableAt",
        "originClientAccountId",
        "metadataJson",
        "createdAt",
        "updatedAt"
      )
      SELECT
        'bav100k-item-' || lpad(s.g::text, 6, '0'),
        ${lotId},
        'bav100k-evt-' || lpad(s.g::text, 6, '0'),
        ${bulkEvaluatedAt}::timestamptz - interval '120 days' + (s.g * interval '1 millisecond'),
        s.state_code,
        'trucker',
        'manual_import'::"SourceLeadProvider",
        'avail_bench_16e9',
        'aged'::"LeadInventoryClass",
        'exclusive'::"InventoryExclusivityMode",
        'available'::"LeadInventoryItemStatus",
        ${bulkEvaluatedAt}::timestamptz,
        CASE WHEN s.g % 17 = 0 THEN ${BUYER_ID} ELSE ${OTHER_ID} END,
        '{}'::jsonb,
        NOW(),
        NOW()
      FROM (
        SELECT
          g,
          (ARRAY[${stateList}]::text[])[1 + ((g - 1) % 51)] AS state_code
        FROM generate_series(1, ${BULK_ROWS}) AS g
      ) s
    `;
    await db.$executeRaw`ANALYZE "LeadInventoryItem"`;
    await db.$executeRaw`ANALYZE "InventoryLot"`;
    await db.$executeRaw`ANALYZE "LeadAllocation"`;
    const insertMs = Date.now() - insertStarted;

    await db.$executeRaw`
      INSERT INTO "SourceLeadEvent" (
        id, "sourceProvider", "sourceSystem", "sourceType", status,
        "rawPayloadJson", "normalizedPayloadJson", "enrichmentMetadataJson",
        "receivedAt", "createdAt", "updatedAt"
      )
      SELECT
        'bav-distractor-evt-' || g::text,
        'manual_import'::"SourceLeadProvider",
        'csv_import'::"SourceLeadSystem",
        'bulk_import'::"SourceLeadType",
        'approved'::"SourceLeadEventStatus",
        jsonb_build_object('contact', jsonb_build_object(
          'first_name', 'Ada', 'last_name', 'Lee',
          'phone_e164', '+1404555900' || g::text,
          'email', 'distractor' || g::text || '@bench.test',
          'state', 'GA'
        ), 'lead_details', jsonb_build_object('consumer_age', 62)),
        jsonb_build_object('contact', jsonb_build_object(
          'first_name', 'Ada', 'last_name', 'Lee',
          'phone_e164', '+1404555900' || g::text,
          'email', 'distractor' || g::text || '@bench.test',
          'state', 'GA'
        ), 'lead_details', jsonb_build_object('consumer_age', 62)),
        '{}'::jsonb,
        ${bulkEvaluatedAt}::timestamptz - CASE WHEN g <= 3 THEN interval '40 days' ELSE interval '120 days' END,
        NOW(), NOW()
      FROM generate_series(1, 6) AS g
    `;
    await db.$executeRaw`
      INSERT INTO "LeadInventoryItem" (
        id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState",
        "nicheKey", "sourceProvider", "sourceLane", "inventoryClass", "exclusivityMode",
        status, "availableAt", "originClientAccountId", "metadataJson", "createdAt", "updatedAt"
      )
      SELECT
        'bav-distractor-item-' || g::text,
        ${lotId},
        'bav-distractor-evt-' || g::text,
        ${bulkEvaluatedAt}::timestamptz - CASE WHEN g <= 3 THEN interval '40 days' ELSE interval '120 days' END,
        'GA',
        CASE WHEN g <= 3 THEN 'trucker' ELSE 'vet' END,
        'manual_import'::"SourceLeadProvider",
        'avail_bench_16e9',
        'aged'::"LeadInventoryClass",
        'exclusive'::"InventoryExclusivityMode",
        'available'::"LeadInventoryItemStatus",
        ${bulkEvaluatedAt}::timestamptz,
        ${OTHER_ID},
        '{}'::jsonb,
        NOW(), NOW()
      FROM generate_series(1, 6) AS g
    `;

    // Independent of the lookup. Same-origin rows are not selectable. Strict US
    // NANP (NPA/NXX not N11) matches buyer-ready for the trucker niche, and
    // oldest-first phone dedupe keeps one row per remaining number.
    const formulaExpected = await db.$queryRaw<Array<{ n: number; invalid: number }>>`
      WITH series AS (
        SELECT
          g,
          CASE WHEN g % 17 = 0 THEN 'buyer' ELSE 'other' END AS origin,
          CASE WHEN g > 50 AND g % 50 = 0 THEN g - 50 ELSE g END AS phone_key
        FROM generate_series(1, ${BULK_ROWS}) AS g
      ),
      phones AS (
        SELECT
          '+1404' || lpad((200 + ((phone_key - 1) % 800))::text, 3, '0')
            || lpad((((phone_key - 1) / 800))::int::text, 4, '0') AS phone,
          row_number() OVER (PARTITION BY phone_key ORDER BY g) AS rn
        FROM series
        WHERE origin = 'other'
      ),
      first_seen AS (
        SELECT
          phone,
          (
            length(phone) = 12
            AND substring(phone from 1 for 2) = '+1'
            AND substring(phone from 3 for 10) ~ '^[0-9]{10}$'
            AND substring(phone from 3 for 1) BETWEEN '2' AND '9'
            AND substring(phone from 6 for 1) BETWEEN '2' AND '9'
            AND substring(phone from 3 for 3) !~ '^[2-9]11$'
            AND substring(phone from 6 for 3) !~ '^[2-9]11$'
          ) AS nanp_ok
        FROM phones
        WHERE rn = 1
      )
      SELECT
        count(*) FILTER (WHERE nanp_ok)::int AS n,
        count(*) FILTER (WHERE NOT nanp_ok)::int AS invalid
      FROM first_seen
    `;
    const storedExpected = await db.$queryRaw<Array<{ n: number; invalid_rows: number }>>`
      WITH scanned AS (
        SELECT
          i.id,
          i."generatedAt",
          e."normalizedPayloadJson" #>> '{contact,phone_e164}' AS phone
        FROM "LeadInventoryItem" i
        JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
        WHERE i.id LIKE 'bav100k-item-%'
          AND i."nicheKey" = 'trucker'
          AND i."inventoryClass" = 'aged'::"LeadInventoryClass"
          AND i.status = 'available'::"LeadInventoryItemStatus"
          AND i."commerceExcludedAt" IS NULL
          AND i."originClientAccountId" = ${OTHER_ID}
          AND i."generatedAt" > ${bulkEvaluatedAt}::timestamptz - interval '180 days'
          AND i."generatedAt" <= ${bulkEvaluatedAt}::timestamptz - interval '90 days'
      ),
      marked AS (
        SELECT
          id,
          "generatedAt",
          phone,
          (
            length(phone) = 12
            AND substring(phone from 1 for 2) = '+1'
            AND substring(phone from 3 for 10) ~ '^[0-9]{10}$'
            AND substring(phone from 3 for 1) BETWEEN '2' AND '9'
            AND substring(phone from 6 for 1) BETWEEN '2' AND '9'
            AND substring(phone from 3 for 3) !~ '^[2-9]11$'
            AND substring(phone from 6 for 3) !~ '^[2-9]11$'
          ) AS nanp_ok
        FROM scanned
      ),
      ranked AS (
        SELECT
          nanp_ok,
          row_number() OVER (PARTITION BY phone ORDER BY "generatedAt" ASC, id ASC) AS rn
        FROM marked
        WHERE nanp_ok
      )
      SELECT
        (SELECT count(*)::int FROM ranked WHERE rn = 1) AS n,
        (SELECT count(*)::int FROM marked WHERE NOT nanp_ok) AS invalid_rows
    `;
    const texasExpected = await db.$queryRaw<Array<{ n: number }>>`
      WITH scanned AS (
        SELECT i.id, i."generatedAt", e."normalizedPayloadJson" #>> '{contact,phone_e164}' AS phone
        FROM "LeadInventoryItem" i
        JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
        WHERE i.id LIKE 'bav100k-item-%'
          AND i."nicheKey" = 'trucker'
          AND i."normalizedState" = 'TX'
          AND i."inventoryClass" = 'aged'::"LeadInventoryClass"
          AND i.status = 'available'::"LeadInventoryItemStatus"
          AND i."commerceExcludedAt" IS NULL
          AND i."originClientAccountId" = ${OTHER_ID}
          AND i."generatedAt" > ${bulkEvaluatedAt}::timestamptz - interval '180 days'
          AND i."generatedAt" <= ${bulkEvaluatedAt}::timestamptz - interval '90 days'
      ),
      marked AS (
        SELECT id, "generatedAt", phone
        FROM scanned
        WHERE length(phone) = 12
          AND substring(phone from 1 for 2) = '+1'
          AND substring(phone from 3 for 10) ~ '^[0-9]{10}$'
          AND substring(phone from 3 for 1) BETWEEN '2' AND '9'
          AND substring(phone from 6 for 1) BETWEEN '2' AND '9'
          AND substring(phone from 3 for 3) !~ '^[2-9]11$'
          AND substring(phone from 6 for 3) !~ '^[2-9]11$'
      ),
      ranked AS (
        SELECT row_number() OVER (PARTITION BY phone ORDER BY "generatedAt" ASC, id ASC) AS rn
        FROM marked
      )
      SELECT count(*)::int AS n FROM ranked WHERE rn = 1
    `;
    const expectedEligible = storedExpected[0]?.n ?? -1;
    const expectedInvalidPhones = storedExpected[0]?.invalid_rows ?? -1;
    const formulaEligible = formulaExpected[0]?.n ?? -2;
    const formulaInvalid = formulaExpected[0]?.invalid ?? -3;
    assert.equal(expectedEligible, formulaEligible);
    assert.equal(expectedInvalidPhones, formulaInvalid);
    assert.ok(expectedEligible > BUYER_AVAILABILITY_MAX_CLASSIFIED_ROWS);
    assert.ok(expectedInvalidPhones > 0);

    const heapBefore = process.memoryUsage().heapUsed;
    let inTransaction = 0;
    const started = Date.now();
    const report = await lookupBuyerInventoryAvailability(
      {
        clientAccountId: BUYER_ID,
        nicheKey: "trucker",
        commerceAgeBucketKeys: ["COMMERCE_3_6_MO"],
        evaluatedAt: bulkEvaluatedAt,
        afterClassificationPage: async ({ pagesRead }) => {
          if (pagesRead !== 1) return;
          const sample = await probe.$queryRaw<Array<{ n: number }>>`
            SELECT count(*)::int AS n
            FROM pg_stat_activity
            WHERE application_name = 'bav_lookup'
              AND xact_start IS NOT NULL
          `;
          inTransaction = sample[0]?.n ?? 0;
        },
      },
      db
    );
    const elapsedMs = Date.now() - started;
    const heapAfter = process.memoryUsage().heapUsed;

    assert.equal(report.ok, true);
    if (!report.ok) return;
    assert.equal(report.stateScope, "all");
    assert.equal(report.scan.classificationCeiling, BUYER_AVAILABILITY_MAX_CLASSIFIED_ROWS);
    assert.equal(report.scan.ceilingHit, false);
    assert.equal(report.scan.continuedPastPassCeiling, true);
    assert.ok(report.scan.classificationPasses > 1);
    assert.ok(report.scan.rowsClassified > BUYER_AVAILABILITY_MAX_CLASSIFIED_ROWS);
    assert.equal(report.scan.rowsUnclassified, 0);
    assert.equal(report.scan.usesSelectionRowCap, false);
    assert.equal(report.queryCompleteness, "complete");
    assert.equal(report.eligibleCountSemantics, "exact");
    assert.equal(report.eligibleTotal, expectedEligible);
    assert.equal(report.exclusionReasons.notBuyerReady.count, expectedInvalidPhones);
    assert.equal(
      report.exclusionReasons.buyerReadyRejections.phone_structurally_invalid,
      expectedInvalidPhones
    );
    assert.equal(report.exclusionReasons.currentBatchDuplicate.count, 1);
    assert.equal(report.structuralCohort.stampedSameOrigin > 0, true);
    assert.equal(
      report.eligibleTotal +
        report.exclusionReasons.notBuyerReady.count +
        report.exclusionReasons.currentBatchDuplicate.count,
      report.scan.rowsClassified
    );
    assert.equal(report.structuralCohort.countSemantics, "exact");
    assert.equal(
      report.ageTiers.find((tier) => tier.commerceAgeBucketKey === "COMMERCE_3_6_MO")?.eligible,
      expectedEligible
    );
    assert.equal(
      report.ageTiers.find((tier) => tier.commerceAgeBucketKey === "COMMERCE_3_6_MO")?.countSemantics,
      "exact"
    );
    assert.equal(report.snapshot.consistent, true);
    assert.equal(report.evaluatedAt, bulkEvaluatedAt.toISOString());
    assert.match(report.summary, /All states/);
    assert.match(report.summary, /Exact buyer-eligible count/);
    assert.equal(report.summary.includes("not a nationwide total"), false);
    assert.equal(inTransaction, 1);
    assert.ok(heapAfter - heapBefore < 512 * 1024 * 1024);
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes("@bench.test"), false);
    assert.equal(serialized.includes("+1404"), false);
    assert.equal(serialized.includes("Ada"), false);

    const selected = await lookupBuyerInventoryAvailability(
      {
        clientAccountId: BUYER_ID,
        nicheKey: "trucker",
        states: ["TX"],
        commerceAgeBucketKeys: ["COMMERCE_3_6_MO"],
        evaluatedAt: bulkEvaluatedAt,
      },
      db
    );
    assert.equal(selected.ok, true);
    if (!selected.ok) return;
    assert.equal(selected.stateScope, "selected");
    assert.deepEqual(selected.states, ["TX"]);
    assert.equal(selected.queryCompleteness, "complete");
    assert.equal(selected.eligibleCountSemantics, "exact");
    assert.equal(selected.eligibleTotal, texasExpected[0]?.n ?? -1);
    assert.equal(selected.exclusionReasons.originClientStamped.count, 0);
    assert.equal(selected.summary.includes("not a nationwide total"), false);

    const kentuckyExpected = await db.$queryRaw<Array<{ same_origin: number; eligible: number }>>`
      WITH scanned AS (
        SELECT
          i."originClientAccountId" AS origin,
          e."normalizedPayloadJson" #>> '{contact,phone_e164}' AS phone
        FROM "LeadInventoryItem" i
        JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
        WHERE i.id LIKE 'bav100k-item-%'
          AND i."nicheKey" = 'trucker'
          AND i."normalizedState" = 'KY'
          AND i."inventoryClass" = 'aged'::"LeadInventoryClass"
          AND i.status = 'available'::"LeadInventoryItemStatus"
          AND i."commerceExcludedAt" IS NULL
          AND i."generatedAt" > ${bulkEvaluatedAt}::timestamptz - interval '180 days'
          AND i."generatedAt" <= ${bulkEvaluatedAt}::timestamptz - interval '90 days'
      )
      SELECT
        count(*) FILTER (WHERE origin = ${BUYER_ID})::int AS same_origin,
        count(DISTINCT phone) FILTER (
          WHERE origin = ${OTHER_ID}
            AND length(phone) = 12
            AND substring(phone from 1 for 2) = '+1'
            AND substring(phone from 3 for 10) ~ '^[0-9]{10}$'
            AND substring(phone from 3 for 1) BETWEEN '2' AND '9'
            AND substring(phone from 6 for 1) BETWEEN '2' AND '9'
            AND substring(phone from 3 for 3) !~ '^[2-9]11$'
            AND substring(phone from 6 for 3) !~ '^[2-9]11$'
        )::int AS eligible
      FROM scanned
    `;
    const kentucky = await lookupBuyerInventoryAvailability(
      {
        clientAccountId: BUYER_ID,
        nicheKey: "trucker",
        states: ["KY"],
        commerceAgeBucketKeys: ["COMMERCE_3_6_MO"],
        evaluatedAt: bulkEvaluatedAt,
      },
      db
    );
    assert.equal(kentucky.ok, true);
    if (!kentucky.ok) return;
    assert.equal(kentucky.stateScope, "selected");
    assert.equal(kentucky.queryCompleteness, "complete");
    assert.equal(kentucky.eligibleCountSemantics, "exact");
    assert.equal(kentucky.eligibleTotal, kentuckyExpected[0]?.eligible ?? -1);
    assert.equal(
      kentucky.exclusionReasons.originClientStamped.count,
      kentuckyExpected[0]?.same_origin ?? -1
    );
    assert.ok((kentuckyExpected[0]?.same_origin ?? 0) > 0);
    assert.equal(kentuckyExpected[0]?.eligible, 0);
    assert.equal(
      kentucky.ageTiers.find((tier) => tier.commerceAgeBucketKey === "COMMERCE_3_6_MO")?.countSemantics,
      "exact"
    );

    const lte = (days: number) => new Date(bulkEvaluatedAt.getTime() - days * DAY_MS);
    const plans = await explainAvailabilityPlans(probe, {
      buyerId: BUYER_ID,
      lte30: lte(30),
      lte90: lte(90),
      lte180: lte(180),
      lte270: lte(270),
      lte365: lte(365),
    });
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    const metrics = {
      insertMs,
      lookupMs: elapsedMs,
      heapBefore,
      heapAfter,
      heapDelta: heapAfter - heapBefore,
      inTransactionConnections: inTransaction,
      pagesRead: report.scan.pagesRead,
      rowsClassified: report.scan.rowsClassified,
      selectableRowsExact: report.scan.selectableRowsExact,
      rowsUnclassified: report.scan.rowsUnclassified,
      classificationPasses: report.scan.classificationPasses,
      classificationCeiling: report.scan.classificationCeiling,
      continuedPastPassCeiling: report.scan.continuedPastPassCeiling,
      structuralRows: report.structuralCohort.rows,
      eligibleTotal: report.eligibleTotal,
      expectedEligible,
      texasEligible: selected.eligibleTotal,
      eligibleCountSemantics: report.eligibleCountSemantics,
      queryCompleteness: report.queryCompleteness,
    };
    writeFileSync(
      `${ARTIFACT_DIR}/buyer-availability-bench.json`,
      JSON.stringify(metrics, null, 2)
    );
    writeFileSync(
      `${ARTIFACT_DIR}/buyer-availability-explain.txt`,
      plans.join("\n\n----\n\n") || "no query captured"
    );
    assert.ok(plans.length >= 1);
    assert.match(plans[0] ?? "", /Scan|Index|Bitmap/i);
  });
});

async function explainAvailabilityPlans(
  db: PrismaClient,
  bounds: {
    buyerId: string;
    lte30: Date;
    lte90: Date;
    lte180: Date;
    lte270: Date;
    lte365: Date;
  }
): Promise<string[]> {
  const render = (rows: Array<{ "QUERY PLAN": string }>) =>
    rows.map((row) => row["QUERY PLAN"]).join("\n");
  const cohort = await db.$queryRaw<Array<{ "QUERY PLAN": string }>>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    SELECT count(*)::int
    FROM "LeadInventoryItem" i
    WHERE i."inventoryClass" = 'aged'::"LeadInventoryClass"
      AND i."normalizedState" = 'ND'
      AND LOWER(i."nicheKey") = 'trucker'
      AND (
        i."generatedAt" <= ${bounds.lte365}
        OR (i."generatedAt" > ${bounds.lte365} AND i."generatedAt" <= ${bounds.lte270})
        OR (i."generatedAt" > ${bounds.lte270} AND i."generatedAt" <= ${bounds.lte180})
        OR (i."generatedAt" > ${bounds.lte180} AND i."generatedAt" <= ${bounds.lte90})
        OR (i."generatedAt" > ${bounds.lte90} AND i."generatedAt" <= ${bounds.lte30})
      )
  `;
  const page = await db.$queryRaw<Array<{ "QUERY PLAN": string }>>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    SELECT i.id, i."generatedAt"
    FROM "LeadInventoryItem" i
    JOIN "InventoryLot" l ON l.id = i."inventoryLotId"
    WHERE i."inventoryClass" = 'aged'::"LeadInventoryClass"
      AND i."normalizedState" = 'ND'
      AND LOWER(i."nicheKey") = 'trucker'
      AND i.status = 'available'::"LeadInventoryItemStatus"
      AND i."commerceExcludedAt" IS NULL
      AND l.status = 'active'::"InventoryLotStatus"
      AND NOT EXISTS (
        SELECT 1
        FROM "LeadAllocation" a
        WHERE a."leadInventoryItemId" = i.id
          AND a.status IN (
            'shadow'::"LeadAllocationStatus",
            'reserved'::"LeadAllocationStatus",
            'delivering'::"LeadAllocationStatus",
            'committed'::"LeadAllocationStatus",
            'review_required'::"LeadAllocationStatus"
          )
      )
      AND (
        (
          i."originClientAccountId" IS NOT NULL
          AND i."originClientAccountId" <> ${bounds.buyerId}
        )
        OR (
          i."originClientAccountId" IS NULL
          AND i."sourceProvider" = 'leadcapture_io'::"SourceLeadProvider"
        )
      )
      AND (
        i."generatedAt" <= ${bounds.lte365}
        OR (i."generatedAt" > ${bounds.lte365} AND i."generatedAt" <= ${bounds.lte270})
        OR (i."generatedAt" > ${bounds.lte270} AND i."generatedAt" <= ${bounds.lte180})
        OR (i."generatedAt" > ${bounds.lte180} AND i."generatedAt" <= ${bounds.lte90})
        OR (i."generatedAt" > ${bounds.lte90} AND i."generatedAt" <= ${bounds.lte30})
      )
    ORDER BY i."generatedAt" ASC, i.id ASC
    LIMIT 250
  `;
  return [`cohort count\n${render(cohort)}`, `selectable page\n${render(page)}`];
}

async function cleanup(db: PrismaClient) {
  await db.leadAllocation.deleteMany({
    where: { OR: [{ id: { startsWith: "bav-" } }, { clientAccountId: BUYER_ID }] },
  });
  await db.buyerDeliveredIdentity.deleteMany({ where: { clientAccountId: BUYER_ID } });
  await db.leadInventoryItem.deleteMany({
    where: {
      OR: [{ id: { startsWith: "bav-" } }, { id: { startsWith: "bav100k-" } }],
    },
  });
  await db.sourceLeadEvent.deleteMany({
    where: {
      OR: [{ id: { startsWith: "bav-" } }, { id: { startsWith: "bav100k-" } }],
    },
  });
  await db.leadOrder.deleteMany({ where: { id: { startsWith: "bav-" } } });
  await db.sourceFunnel.deleteMany({
    where: {
      OR: [{ id: { startsWith: "bav-" } }, { providerFunnelId: { startsWith: "bav-" } }],
    },
  });
  await db.inventoryLot.deleteMany({ where: { lotKey: "bav-availability-lot" } });
  await db.clientAccount.deleteMany({
    where: { clientAccountId: { in: [BUYER_ID, OTHER_ID] } },
  });
}

async function insertInventoryRow(
  db: PrismaClient,
  input: {
    id: string;
    eventId: string;
    lotId: string;
    ageDays: number;
    phone: string;
    origin: string | null;
    state: string;
    provider: "manual_import" | "leadcapture_io";
    campaignId?: string;
    status?: "available" | "reserved";
  }
) {
  const body = payload(input.phone, `${input.id}@bench.test`);
  await db.sourceLeadEvent.create({
    data: {
      id: input.eventId,
      sourceProvider: input.provider,
      sourceSystem: input.provider === "leadcapture_io" ? "leadcapture_io_nextgen" : "csv_import",
      sourceType: input.provider === "leadcapture_io" ? "webhook" : "bulk_import",
      sourceCampaignId: input.campaignId ?? null,
      status: "approved",
      rawPayloadJson: body,
      normalizedPayloadJson: body,
      enrichmentMetadataJson: {},
      receivedAt: daysAgo(input.ageDays),
    },
  });
  await db.leadInventoryItem.create({
    data: {
      id: input.id,
      inventoryLotId: input.lotId,
      sourceLeadEventId: input.eventId,
      generatedAt: daysAgo(input.ageDays),
      normalizedState: input.state,
      nicheKey: "trucker",
      sourceProvider: input.provider,
      sourceLane: "avail_bench_16e9",
      inventoryClass: "aged",
      exclusivityMode: "exclusive",
      status: input.status ?? "available",
      availableAt: EVALUATED_AT,
      reservedAt: input.status === "reserved" ? EVALUATED_AT : null,
      originClientAccountId: input.origin,
      metadataJson: {},
    },
  });
}

async function seedScenario(db: PrismaClient, lotId: string) {
  const rows: Array<Parameters<typeof insertInventoryRow>[1]> = [
    {
      id: "bav-ga-same",
      eventId: "bav-ga-same-evt",
      lotId,
      ageDays: 60,
      phone: "+14045558001",
      origin: BUYER_ID,
      state: "GA",
      provider: "manual_import",
    },
    {
      id: "bav-ga-other-1-3",
      eventId: "bav-ga-other-1-3-evt",
      lotId,
      ageDays: 61,
      phone: "+14045558002",
      origin: OTHER_ID,
      state: "GA",
      provider: "manual_import",
    },
    {
      id: "bav-ga-age-40",
      eventId: "bav-ga-age-40-evt",
      lotId,
      ageDays: 40,
      phone: "+14045558003",
      origin: OTHER_ID,
      state: "GA",
      provider: "manual_import",
    },
    {
      id: "bav-ga-age-100",
      eventId: "bav-ga-age-100-evt",
      lotId,
      ageDays: 100,
      phone: "+14045558004",
      origin: OTHER_ID,
      state: "GA",
      provider: "manual_import",
    },
    {
      id: "bav-ga-age-200",
      eventId: "bav-ga-age-200-evt",
      lotId,
      ageDays: 200,
      phone: "+14045558005",
      origin: OTHER_ID,
      state: "GA",
      provider: "manual_import",
    },
    {
      id: "bav-ga-age-300",
      eventId: "bav-ga-age-300-evt",
      lotId,
      ageDays: 300,
      phone: "+14045558006",
      origin: OTHER_ID,
      state: "GA",
      provider: "manual_import",
    },
    {
      id: "bav-ga-age-400",
      eventId: "bav-ga-age-400-evt",
      lotId,
      ageDays: 400,
      phone: "+14045558007",
      origin: OTHER_ID,
      state: "GA",
      provider: "manual_import",
    },
    {
      id: "bav-ga-reconciled-buyer",
      eventId: "bav-ga-reconciled-buyer-evt",
      lotId,
      ageDays: 81,
      phone: "+14045558008",
      origin: null,
      state: "GA",
      provider: "leadcapture_io",
      campaignId: "my.leadcapture.io/p/bav-jr-trucker",
    },
    {
      id: "bav-ga-unresolved-manual",
      eventId: "bav-ga-unresolved-manual-evt",
      lotId,
      ageDays: 70,
      phone: "+14045558009",
      origin: null,
      state: "GA",
      provider: "manual_import",
    },
    {
      id: "bav-ga-unconfirmed",
      eventId: "bav-ga-unconfirmed-evt",
      lotId,
      ageDays: 72,
      phone: "+14045558010",
      origin: null,
      state: "GA",
      provider: "leadcapture_io",
      campaignId: "bav-funnel-suggested",
    },
    {
      id: "bav-ga-prior",
      eventId: "bav-ga-prior-evt",
      lotId,
      ageDays: 90,
      phone: "+14045558011",
      origin: OTHER_ID,
      state: "GA",
      provider: "manual_import",
    },
    {
      id: "bav-ga-allocated",
      eventId: "bav-ga-allocated-evt",
      lotId,
      ageDays: 51,
      phone: "+14045558012",
      origin: OTHER_ID,
      state: "GA",
      provider: "manual_import",
    },
    {
      id: "bav-ga-reserved",
      eventId: "bav-ga-reserved-evt",
      lotId,
      ageDays: 50,
      phone: "+14045558013",
      origin: OTHER_ID,
      state: "GA",
      provider: "manual_import",
      status: "reserved",
    },
  ];
  for (const row of rows) await insertInventoryRow(db, row);

  await db.sourceFunnel.create({
    data: {
      id: "bav-funnel-buyer",
      provider: "leadcapture_io",
      providerFunnelId: null,
      parentUrlKey: "my.leadcapture.io/p/bav-jr-trucker",
      pageSlug: "bav-jr-trucker",
      associationStatus: "confirmed",
      originClientAccountId: BUYER_ID,
    },
  });
  await db.sourceFunnel.create({
    data: {
      id: "bav-funnel-suggested",
      provider: "leadcapture_io",
      providerFunnelId: "bav-funnel-suggested",
      associationStatus: "suggested",
      originClientAccountId: OTHER_ID,
    },
  });
  await db.leadOrder.create({
    data: {
      id: "bav-ga-order",
      orderNumber: "BAV-GA-ORDER",
      clientAccountId: BUYER_ID,
      clientDisplayName: "JR Laird",
      status: "active",
      nicheKey: "trucker",
      statesJson: ["GA"],
      leadVolume: 1,
      deliveryCadence: "test",
      campaignType: "availability_proof",
      crmPackage: "simulation_only",
      createdByRole: "admin",
      submittedAt: EVALUATED_AT,
      activatedAt: EVALUATED_AT,
      orderKind: "pay_per_lead",
      fulfillmentMode: "pooled_matching",
      requestedQuantity: 1,
    },
  });
  await db.leadAllocation.create({
    data: {
      id: "bav-ga-alloc",
      sourceLeadEventId: "bav-ga-allocated-evt",
      leadOrderId: "bav-ga-order",
      leadInventoryItemId: "bav-ga-allocated",
      clientAccountId: BUYER_ID,
      status: "reserved",
      allocationPolicyVersion: "buyer-availability-proof",
      decisionReasonsJson: [],
      idempotencyKey: "bav-ga-alloc",
      proposedAt: EVALUATED_AT,
    },
  });
  await db.buyerDeliveredIdentity.create({
    data: {
      id: "bav-ga-prior-identity",
      clientAccountId: BUYER_ID,
      phoneFingerprint: fingerprintPhoneIdentity("+14045558011"),
      sourceLeadEventId: "bav-ga-prior-evt",
      leadAllocationId: "bav-ga-prior-alloc",
      leadInventoryItemId: "bav-ga-prior",
    },
  });
}

async function seedConcurrencyRows(db: PrismaClient, lotId: string) {
  await insertInventoryRow(db, {
    id: "bav-sd-old",
    eventId: "bav-sd-old-evt",
    lotId,
    ageDays: 400,
    phone: "+14045558101",
    origin: OTHER_ID,
    state: "SD",
    provider: "manual_import",
  });
  await insertInventoryRow(db, {
    id: "bav-sd-mid",
    eventId: "bav-sd-mid-evt",
    lotId,
    ageDays: 200,
    phone: "+14045558102",
    origin: OTHER_ID,
    state: "SD",
    provider: "manual_import",
  });
  await insertInventoryRow(db, {
    id: "bav-sd-young",
    eventId: "bav-sd-young-evt",
    lotId,
    ageDays: 40,
    phone: "+14045558103",
    origin: null,
    state: "SD",
    provider: "leadcapture_io",
    campaignId: "bav-sd-funnel-form",
  });
  await db.sourceFunnel.create({
    data: {
      id: "bav-sd-funnel",
      provider: "leadcapture_io",
      providerFunnelId: "bav-sd-funnel-form",
      associationStatus: "confirmed",
      originClientAccountId: OTHER_ID,
    },
  });
}
