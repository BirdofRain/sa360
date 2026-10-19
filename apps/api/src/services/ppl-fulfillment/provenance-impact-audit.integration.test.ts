/**
 * Local Postgres proof for the provenance impact audit.
 * Uses SA360_TEST_DATABASE_URL only (localhost, database name contains "test").
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { buildApp } from "../../app.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { PROVENANCE_ELIGIBILITY_MATRIX } from "./provenance-eligibility-matrix.js";
import { evaluateProvenanceEligibility } from "./provenance-eligibility.js";
import {
  evaluateCampaignAgreementInPostgres,
  evaluateProvenanceCodeInPostgres,
  runProvenanceImpactAudit,
  withProvenanceAuditSnapshot,
  type ProvenanceImpactAuditResult,
} from "./provenance-impact-audit.js";
import { classifyStoredCampaignLabels } from "./provenance-impact-query.js";

const integrationUrl =
  process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim() ||
  process.env.SA360_TEST_DATABASE_URL?.trim() ||
  "";
const runIntegration = Boolean(integrationUrl);

const PREFIX = "pia13d4";
const NICHE = "pia13d4_niche";
const CLIENT_ID = "pia13d4_origin";
const CLIENT_NAME = "PIA Secret Client Name";
const PHONE = "+15555550199";
const EMAIL = "pia-secret-13d4@example.test";
const FAKE_ACQ = "PIA_FAKE_ACQ_13d4";
const LABEL = {
  alpha: "PIA Secret Label Alpha",
  beta: "PIA Secret Label Beta",
  betaNormalized: "PIA Beta Normalized",
  betaRaw: "PIA Beta Raw",
  gamma: "PIA Secret Label Gamma",
  later: "PIA Later Workbook",
  delta: "PIA Secret Label Delta",
  epsilon: "PIA Secret Label Epsilon",
  zeta: "PIA Secret Label Zeta",
  eta: "PIA Secret Label Eta",
  theta: "PIA Secret Label Theta",
};
const SECRETS = [CLIENT_NAME, PHONE, EMAIL, FAKE_ACQ, "SecretFirst", "SecretLast", ...Object.values(LABEL)];

const LABEL_CASES = [
  { sourceCampaignName: null, normalizedCampaignName: null, rawLeadType: null },
  { sourceCampaignName: "  ", normalizedCampaignName: "", rawLeadType: " " },
  { sourceCampaignName: " Alpha ", normalizedCampaignName: null, rawLeadType: null },
  { sourceCampaignName: "Alpha", normalizedCampaignName: "Alpha", rawLeadType: " Alpha " },
  { sourceCampaignName: "Alpha", normalizedCampaignName: "Beta", rawLeadType: null },
  { sourceCampaignName: "Alpha", normalizedCampaignName: "Alpha", rawLeadType: "Later" },
  { sourceCampaignName: null, normalizedCampaignName: "Later workbook", rawLeadType: null },
] as const;

function mustReport(result: ProvenanceImpactAuditResult) {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected report");
  return result;
}

describe("provenance impact audit postgres proof", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let mutator: PrismaClient;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrl);
    db = new PrismaClient({ datasources: { db: { url } } });
    mutator = new PrismaClient({ datasources: { db: { url } } });
    await cleanup(db);
  });

  after(async () => {
    if (db) {
      await cleanup(db);
      await db.$disconnect();
    }
    await mutator?.$disconnect();
  });

  it("matches evaluateProvenanceEligibility for every branch, including LeadCapture and csv_import", async () => {
    for (const entry of PROVENANCE_ELIGIBILITY_MATRIX) {
      const code = await evaluateProvenanceCodeInPostgres(db, entry.input);
      assert.equal(code, evaluateProvenanceEligibility(entry.input).code, entry.name);
    }
    const before = await db.leadInventoryItem.count();
    const injected = await evaluateProvenanceCodeInPostgres(db, {
      itemSourceProvider: "leadcapture_io'; DROP TABLE \"LeadInventoryItem\"; --",
      eventSourceProvider: "manual_import",
      eventSourceSystem: "webhook",
    });
    assert.equal(injected, "unresolved_origin");
    assert.equal(await db.leadInventoryItem.count(), before);
  });

  it("matches classifyStoredCampaignLabels for every stored-label branch", async () => {
    for (const input of LABEL_CASES) {
      const agreement = await evaluateCampaignAgreementInPostgres(db, input);
      assert.equal(agreement, classifyStoredCampaignLabels(input).agreement);
    }
  });

  it("rejects writes inside the audit transaction and keeps one snapshot", async () => {
    await seed(db);
    const item = await db.leadInventoryItem.findUniqueOrThrow({ where: { id: `${PREFIX}-item-1` } });
    const footprintBefore = await footprint(db);
    await assert.rejects(
      () =>
        withProvenanceAuditSnapshot(db, async (tx) => {
          await tx.$executeRaw`
            UPDATE "LeadInventoryItem"
            SET "nicheKey" = 'mutated'
            WHERE id = ${`${PREFIX}-item-1`}
          `;
        }),
      /read-only transaction|cannot execute UPDATE/i
    );
    const unchanged = await db.leadInventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(unchanged.nicheKey, item.nicheKey);
    assert.equal(unchanged.updatedAt.getTime(), item.updatedAt.getTime());
    assert.equal(unchanged.status, item.status);

    const before = mustReport(await runProvenanceImpactAudit(db));
    assert.deepEqual(await footprint(db), footprintBefore);
    const during = mustReport(
      await runProvenanceImpactAudit(db, {
        afterSnapshotOpened: async () => {
          await insertInventory(mutator, {
            id: `${PREFIX}-item-snap`,
            eventId: `${PREFIX}-evt-snap`,
            lotKey: `${PREFIX}-active`,
            provider: "manual_import",
            eventProvider: "manual_import",
            system: "csv_import",
            sourceType: "bulk_import",
            inventoryClass: "aged",
            status: "available",
            campaign: "PIA Snapshot Label",
          });
        },
      })
    );
    const after = mustReport(await runProvenanceImpactAudit(db));
    assert.equal(during.structuralGate.availableBeforeGate, before.structuralGate.availableBeforeGate);
    assert.equal(after.structuralGate.availableBeforeGate, before.structuralGate.availableBeforeGate + 1);
    assert.equal(nicheCount(during, "before"), nicheCount(before, "before"));
    assert.equal(nicheCount(after, "before"), nicheCount(before, "before") + 1);
    assert.equal(during.snapshot.consistent, true);
    assert.equal(during.snapshot.isolation, "repeatable_read");
    assert.equal(during.snapshot.readOnly, true);
    assert.deepEqual(await footprint(db), {
      ...footprintBefore,
      items: footprintBefore.items + 1,
      events: footprintBefore.events + 1,
    });
  });

  it("reconciles the seeded cohort, hides contact data, and does not modify records", async () => {
    await cleanup(db);
    const before = mustReport(await runProvenanceImpactAudit(db));
    await seed(db);
    const footprintBefore = await footprint(db);
    const after = mustReport(await runProvenanceImpactAudit(db));
    assert.deepEqual(await footprint(db), footprintBefore);
    assert.equal(after.productionImpactMeasured, false);
    assert.equal(after.countSemantics, "exact");
    assert.equal(after.rowCeilingApplied, false);
    assert.equal(after.verifiedAcquisitionEvidence.persistedVerifiedRecord, false);
    assert.equal(after.buyerSpecificEligibility.applied, false);
    assert.equal(after.database.name.toLowerCase().includes("test"), true);

    const gate = (report: typeof after) => report.structuralGate;
    assert.equal(gate(after).availableBeforeGate - gate(before).availableBeforeGate, 8);
    assert.equal(gate(after).blockedByGate - gate(before).blockedByGate, 6);
    assert.equal(gate(after).remainingAfterGate - gate(before).remainingAfterGate, 2);
    assert.equal(
      gate(after).byCode.eligible_confirmed_origin - gate(before).byCode.eligible_confirmed_origin,
      1
    );
    assert.equal(
      gate(after).byCode.eligible_leadcapture_unstamped -
        gate(before).byCode.eligible_leadcapture_unstamped,
      1
    );
    assert.equal(gate(after).byCode.eligible_verified_acquisition, 0);
    assert.equal(gate(after).byCode.unresolved_origin - gate(before).byCode.unresolved_origin, 6);
    assert.equal(nicheCount(after, "before"), 8);
    assert.equal(nicheCount(after, "blocked"), 6);
    assert.equal(nicheCount(after, "remaining"), 2);

    const reserved = after.reservedAndAllocations;
    const reservedBefore = before.reservedAndAllocations;
    assert.equal(reserved.reservedItemsUnresolved - reservedBefore.reservedItemsUnresolved, 2);
    assert.equal(reserved.reservedItemsEligible - reservedBefore.reservedItemsEligible, 1);
    assert.equal(reserved.openAllocationsUnresolved - reservedBefore.openAllocationsUnresolved, 3);
    assert.equal(reserved.openAllocationsEligible - reservedBefore.openAllocationsEligible, 1);
    assert.equal(
      reserved.ordersWithUnresolvedReservedAllocations -
        reservedBefore.ordersWithUnresolvedReservedAllocations,
      2
    );
    assert.equal(
      reserved.ordersWithMixedEligibleAndUnresolvedReservedAllocations -
        reservedBefore.ordersWithMixedEligibleAndUnresolvedReservedAllocations,
      1
    );
    assert.ok(reserved.unresolvedReservedOrderNumbers.includes("PIA13D4-MIX"));
    assert.ok(reserved.unresolvedReservedOrderNumbers.includes("PIA13D4-RISK"));
    assert.deepEqual(
      reserved.mixedReservedOrderNumbers.filter((orderNumber) => orderNumber.startsWith("PIA13D4")),
      ["PIA13D4-MIX"]
    );

    const labels = after.historicalCampaignLabels;
    const labelsBefore = before.historicalCampaignLabels;
    assert.equal(labels.events - labelsBefore.events, 10);
    assert.equal(
      labels.eventsWithNonemptySourceCampaignName - labelsBefore.eventsWithNonemptySourceCampaignName,
      8
    );
    assert.equal(labels.distinctSourceCampaignNameCount - labelsBefore.distinctSourceCampaignNameCount, 8);
    assert.equal(labels.recoverableConsistentEvents - labelsBefore.recoverableConsistentEvents, 7);
    assert.equal(labels.conflictingEvents - labelsBefore.conflictingEvents, 1);
    assert.equal(labels.missingEvents - labelsBefore.missingEvents, 2);
    assert.equal(labels.distinctRecoverableLabelCount - labelsBefore.distinctRecoverableLabelCount, 7);
    assert.equal(labels.distinctConflictingLabelCount - labelsBefore.distinctConflictingLabelCount, 1);
    assert.equal(
      labels.inventoryRowsWithNonemptySourceCampaignName -
        labelsBefore.inventoryRowsWithNonemptySourceCampaignName,
      8
    );
    assert.equal(
      after.furtherEvidenceRequired.unresolvedInStructuralGate -
        before.furtherEvidenceRequired.unresolvedInStructuralGate,
      6
    );
    assert.equal(after.furtherEvidenceRequired.verifiedAcquisitionCannotClearRows, true);

    const serialized = JSON.stringify(after);
    for (const secret of SECRETS) assert.equal(serialized.includes(secret), false, secret);
    assert.equal(serialized.includes("sourceCampaignName"), false);
    assert.equal(serialized.includes("rawPayloadJson"), false);
    assert.equal(serialized.includes(CLIENT_ID), false);
  });

  it("serves the admin key and the audit key, and a statement timeout is not a zero", async () => {
    const prevFlag = process.env.SA360_PROVENANCE_AUDIT_ENABLED;
    const prevAudit = process.env.SA360_AUDIT_READONLY_KEY;
    const prevAdmin = process.env.ADMIN_API_KEY;
    process.env.SA360_PROVENANCE_AUDIT_ENABLED = "true";
    process.env.ADMIN_API_KEY = "admin-key-0123456789abc";
    process.env.SA360_AUDIT_READONLY_KEY = "audit-only-key-0123456789";
    const app = await buildApp();
    try {
      const admin = await app.inject({
        method: "GET",
        url: "/admin/v1/fulfillment-ops/provenance-impact",
        headers: { "x-sa360-admin-key": "admin-key-0123456789abc" },
      });
      assert.equal(admin.statusCode, 200);
      const body = admin.json();
      assert.equal(body.complete, true);
      assert.equal(body.productionImpactMeasured, false);
      assert.equal(body.structuralGate.byCode.eligible_verified_acquisition, 0);
      const serialized = JSON.stringify(body);
      for (const secret of SECRETS) assert.equal(serialized.includes(secret), false);
      assert.equal(serialized.includes("admin-key-0123456789abc"), false);
      assert.equal(serialized.includes("audit-only-key-0123456789"), false);

      const audit = await app.inject({
        method: "GET",
        url: "/admin/v1/fulfillment-ops/provenance-impact",
        headers: { "x-sa360-provenance-audit-key": "audit-only-key-0123456789" },
      });
      assert.equal(audit.statusCode, 200);
      assert.equal(audit.json().structuralGate.availableBeforeGate, body.structuralGate.availableBeforeGate);
    } finally {
      await app.close();
      if (prevFlag === undefined) delete process.env.SA360_PROVENANCE_AUDIT_ENABLED;
      else process.env.SA360_PROVENANCE_AUDIT_ENABLED = prevFlag;
      if (prevAudit === undefined) delete process.env.SA360_AUDIT_READONLY_KEY;
      else process.env.SA360_AUDIT_READONLY_KEY = prevAudit;
      if (prevAdmin === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = prevAdmin;
    }

    await assert.rejects(
      () =>
        withProvenanceAuditSnapshot(
          db,
          async (tx) => {
            await tx.$queryRaw`SELECT pg_sleep(2)`;
          },
          { statementTimeoutMs: 50 }
        ),
      /statement timeout|canceling statement/i
    );
  });
});

function nicheCount(
  report: ReturnType<typeof mustReport>,
  field: "before" | "blocked" | "remaining"
): number {
  return report.breakdowns.byNiche.find((row) => row.key === NICHE)?.[field] ?? 0;
}

async function footprint(db: PrismaClient) {
  const [items, events, allocations, orders, lots, clients] = await Promise.all([
    db.leadInventoryItem.count(),
    db.sourceLeadEvent.count(),
    db.leadAllocation.count(),
    db.leadOrder.count(),
    db.inventoryLot.count(),
    db.clientAccount.count(),
  ]);
  return { items, events, allocations, orders, lots, clients };
}

async function cleanup(db: PrismaClient) {
  await db.leadAllocation.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.leadInventoryItem.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.sourceLeadEvent.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.leadOrder.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.inventoryLot.deleteMany({ where: { lotKey: { startsWith: PREFIX } } });
  await db.clientAccount.deleteMany({ where: { clientAccountId: CLIENT_ID } });
}

async function seed(db: PrismaClient) {
  await cleanup(db);
  await db.clientAccount.create({
    data: {
      clientAccountId: CLIENT_ID,
      clientDisplayName: CLIENT_NAME,
      status: "active",
      portalEnabled: false,
      primaryNicheKeys: [NICHE],
    },
  });
  await db.inventoryLot.create({
    data: {
      lotKey: `${PREFIX}-active`,
      displayName: "Provenance audit active lot",
      sourceProvider: "manual_import",
      sourceLane: PREFIX,
      nicheKey: NICHE,
      inventoryClass: "aged",
      exclusivityMode: "exclusive",
      status: "active",
    },
  });
  await db.inventoryLot.create({
    data: {
      lotKey: `${PREFIX}-paused`,
      displayName: "Provenance audit paused lot",
      sourceProvider: "manual_import",
      sourceLane: PREFIX,
      nicheKey: NICHE,
      inventoryClass: "aged",
      exclusivityMode: "exclusive",
      status: "paused",
    },
  });

  await insertInventory(db, {
    id: `${PREFIX}-item-1`,
    eventId: `${PREFIX}-evt-1`,
    lotKey: `${PREFIX}-active`,
    provider: "manual_import",
    eventProvider: "manual_import",
    system: "csv_import",
    sourceType: "bulk_import",
    inventoryClass: "aged",
    status: "available",
    campaign: LABEL.alpha,
    normalizedCampaign: LABEL.alpha,
    contact: true,
    metadata: { verifiedAcquisitionEvidenceId: FAKE_ACQ, acquisitionCostCents: 12345 },
    acquisitionCostCents: 12345,
    exclusivityMode: "exclusive",
  });
  await insertInventory(db, {
    id: `${PREFIX}-item-2`,
    eventId: `${PREFIX}-evt-2`,
    lotKey: `${PREFIX}-active`,
    provider: "manual_import",
    eventProvider: "manual_import",
    system: "csv_import",
    sourceType: "bulk_import",
    inventoryClass: "aged",
    status: "available",
    campaign: LABEL.beta,
    normalizedCampaign: LABEL.betaNormalized,
    rawLeadType: LABEL.betaRaw,
  });
  await insertInventory(db, {
    id: `${PREFIX}-item-3`,
    eventId: `${PREFIX}-evt-3`,
    lotKey: `${PREFIX}-active`,
    provider: "manual_import",
    eventProvider: "manual_import",
    system: "csv_import",
    sourceType: "bulk_import",
    inventoryClass: "aged",
    status: "available",
    origin: CLIENT_ID,
    campaign: LABEL.gamma,
    normalizedCampaign: LABEL.gamma,
  });
  await insertInventory(db, {
    id: `${PREFIX}-item-4`,
    eventId: `${PREFIX}-evt-4`,
    lotKey: `${PREFIX}-active`,
    provider: "leadcapture_io",
    eventProvider: "leadcapture_io",
    system: "leadcapture_io_nextgen",
    sourceType: "webhook",
    inventoryClass: "aged",
    status: "available",
  });
  await insertInventory(db, {
    id: `${PREFIX}-item-5`,
    eventId: `${PREFIX}-evt-5`,
    lotKey: `${PREFIX}-active`,
    provider: "leadcapture_io",
    eventProvider: "manual_import",
    system: "leadcapture_io_legacy",
    sourceType: "webhook",
    inventoryClass: "aged",
    status: "available",
  });
  await insertInventory(db, {
    id: `${PREFIX}-item-6`,
    eventId: `${PREFIX}-evt-6`,
    lotKey: `${PREFIX}-active`,
    provider: "leadcapture_io",
    eventProvider: "leadcapture_io",
    system: "csv_import",
    sourceType: "bulk_import",
    inventoryClass: "aged",
    status: "available",
  });
  await insertInventory(db, {
    id: `${PREFIX}-item-7`,
    eventId: `${PREFIX}-evt-7`,
    lotKey: `${PREFIX}-active`,
    provider: "manual_import",
    eventProvider: "manual_import",
    system: "csv_import",
    sourceType: "bulk_import",
    inventoryClass: "aged",
    status: "available",
    normalizedCampaign: LABEL.later,
  });
  await insertInventory(db, {
    id: `${PREFIX}-item-8`,
    eventId: `${PREFIX}-evt-8`,
    lotKey: `${PREFIX}-active`,
    provider: "manual_import",
    eventProvider: "manual_import",
    system: "csv_import",
    sourceType: "bulk_import",
    inventoryClass: "aged",
    status: "available",
    commerceExcluded: true,
    campaign: LABEL.delta,
    normalizedCampaign: LABEL.delta,
  });
  await insertInventory(db, {
    id: `${PREFIX}-item-9`,
    eventId: `${PREFIX}-evt-9`,
    lotKey: `${PREFIX}-active`,
    provider: "manual_import",
    eventProvider: "manual_import",
    system: "csv_import",
    sourceType: "bulk_import",
    inventoryClass: "aged",
    status: "reserved",
    campaign: LABEL.epsilon,
  });
  await insertInventory(db, {
    id: `${PREFIX}-item-10`,
    eventId: `${PREFIX}-evt-10`,
    lotKey: `${PREFIX}-paused`,
    provider: "manual_import",
    eventProvider: "manual_import",
    system: "csv_import",
    sourceType: "bulk_import",
    inventoryClass: "aged",
    status: "available",
    campaign: LABEL.zeta,
    normalizedCampaign: LABEL.zeta,
  });
  await insertInventory(db, {
    id: `${PREFIX}-item-11`,
    eventId: `${PREFIX}-evt-11`,
    lotKey: `${PREFIX}-active`,
    provider: "manual_import",
    eventProvider: "manual_import",
    system: "csv_import",
    sourceType: "bulk_import",
    inventoryClass: "fresh",
    status: "available",
    campaign: LABEL.eta,
    normalizedCampaign: LABEL.eta,
  });
  await insertInventory(db, {
    id: `${PREFIX}-item-12`,
    eventId: `${PREFIX}-evt-12`,
    lotKey: `${PREFIX}-active`,
    provider: "facebook",
    eventProvider: "facebook",
    system: "meta_lead_ads",
    sourceType: "lead_form",
    inventoryClass: "aged",
    status: "available",
  });
  await insertInventory(db, {
    id: `${PREFIX}-item-13`,
    eventId: `${PREFIX}-evt-13`,
    lotKey: `${PREFIX}-active`,
    provider: "leadcapture_io",
    eventProvider: "leadcapture_io",
    system: "leadcapture_io_nextgen",
    sourceType: "webhook",
    inventoryClass: "aged",
    status: "reserved",
  });
  await insertInventory(db, {
    id: `${PREFIX}-item-14`,
    eventId: `${PREFIX}-evt-14`,
    lotKey: `${PREFIX}-active`,
    provider: "manual_import",
    eventProvider: "manual_import",
    system: "csv_import",
    sourceType: "bulk_import",
    inventoryClass: "aged",
    status: "reserved",
    campaign: LABEL.theta,
  });

  await db.leadOrder.create({
    data: {
      id: `${PREFIX}-order-mix`,
      orderNumber: "PIA13D4-MIX",
      clientAccountId: CLIENT_ID,
      clientDisplayName: CLIENT_NAME,
      status: "active",
      nicheKey: NICHE,
      statesJson: ["GA"],
      leadVolume: 2,
      campaignType: "provenance-audit",
      crmPackage: "simulation_only",
      createdByRole: "admin",
      orderKind: "pay_per_lead",
      fulfillmentMode: "pooled_matching",
      requestedQuantity: 2,
    },
  });
  await db.leadOrder.create({
    data: {
      id: `${PREFIX}-order-risk`,
      orderNumber: "PIA13D4-RISK",
      clientAccountId: CLIENT_ID,
      clientDisplayName: CLIENT_NAME,
      status: "active",
      nicheKey: NICHE,
      statesJson: ["GA"],
      leadVolume: 1,
      campaignType: "provenance-audit",
      crmPackage: "simulation_only",
      createdByRole: "admin",
      orderKind: "pay_per_lead",
      fulfillmentMode: "pooled_matching",
      requestedQuantity: 1,
    },
  });
  await db.leadAllocation.create({
    data: {
      id: `${PREFIX}-alloc-shadow`,
      sourceLeadEventId: `${PREFIX}-evt-1`,
      leadOrderId: `${PREFIX}-order-risk`,
      leadInventoryItemId: `${PREFIX}-item-1`,
      clientAccountId: CLIENT_ID,
      status: "shadow",
      allocationPolicyVersion: "provenance-audit",
      idempotencyKey: `${PREFIX}-shadow`,
    },
  });
  await db.leadAllocation.create({
    data: {
      id: `${PREFIX}-alloc-mix-unresolved`,
      sourceLeadEventId: `${PREFIX}-evt-9`,
      leadOrderId: `${PREFIX}-order-mix`,
      leadInventoryItemId: `${PREFIX}-item-9`,
      clientAccountId: CLIENT_ID,
      status: "reserved",
      allocationPolicyVersion: "provenance-audit",
      idempotencyKey: `${PREFIX}-mix-unresolved`,
    },
  });
  await db.leadAllocation.create({
    data: {
      id: `${PREFIX}-alloc-mix-eligible`,
      sourceLeadEventId: `${PREFIX}-evt-13`,
      leadOrderId: `${PREFIX}-order-mix`,
      leadInventoryItemId: `${PREFIX}-item-13`,
      clientAccountId: CLIENT_ID,
      status: "reserved",
      allocationPolicyVersion: "provenance-audit",
      idempotencyKey: `${PREFIX}-mix-eligible`,
    },
  });
  await db.leadAllocation.create({
    data: {
      id: `${PREFIX}-alloc-risk`,
      sourceLeadEventId: `${PREFIX}-evt-14`,
      leadOrderId: `${PREFIX}-order-risk`,
      leadInventoryItemId: `${PREFIX}-item-14`,
      clientAccountId: CLIENT_ID,
      status: "reserved",
      allocationPolicyVersion: "provenance-audit",
      idempotencyKey: `${PREFIX}-risk`,
    },
  });
}

async function insertInventory(
  db: PrismaClient,
  input: {
    id: string;
    eventId: string;
    lotKey: string;
    provider: "manual_import" | "leadcapture_io" | "facebook";
    eventProvider: "manual_import" | "leadcapture_io" | "facebook";
    system: "csv_import" | "leadcapture_io_nextgen" | "leadcapture_io_legacy" | "meta_lead_ads";
    sourceType: "bulk_import" | "webhook" | "lead_form";
    inventoryClass: "aged" | "fresh";
    status: "available" | "reserved";
    origin?: string | null;
    campaign?: string | null;
    normalizedCampaign?: string | null;
    rawLeadType?: string | null;
    contact?: boolean;
    metadata?: Record<string, unknown>;
    acquisitionCostCents?: number;
    exclusivityMode?: "exclusive" | "configurable";
    commerceExcluded?: boolean;
  }
) {
  const lot = await db.inventoryLot.findUniqueOrThrow({ where: { lotKey: input.lotKey } });
  const rawPayload: Record<string, unknown> = input.contact
    ? {
        contact: { first_name: "SecretFirst", last_name: "SecretLast", phone_e164: PHONE, email: EMAIL },
      }
    : { importRequestId: PREFIX };
  if (input.rawLeadType) rawPayload.master = { lead_type: input.rawLeadType };
  const normalizedPayload = input.normalizedCampaign
    ? { campaign_name: input.normalizedCampaign, contact: rawPayload.contact }
    : { marker: PREFIX };
  await db.sourceLeadEvent.create({
    data: {
      id: input.eventId,
      sourceProvider: input.eventProvider,
      sourceSystem: input.system,
      sourceType: input.sourceType,
      sourceCampaignName: input.campaign ?? null,
      status: "approved",
      rawPayloadJson: rawPayload as Prisma.InputJsonValue,
      normalizedPayloadJson: normalizedPayload as Prisma.InputJsonValue,
    },
  });
  await db.leadInventoryItem.create({
    data: {
      id: input.id,
      inventoryLotId: lot.id,
      sourceLeadEventId: input.eventId,
      generatedAt: new Date("2026-01-15T00:00:00.000Z"),
      normalizedState: "GA",
      nicheKey: NICHE,
      sourceProvider: input.provider,
      sourceLane: PREFIX,
      inventoryClass: input.inventoryClass,
      exclusivityMode: input.exclusivityMode ?? "configurable",
      status: input.status,
      availableAt: input.status === "available" ? new Date("2026-02-01T00:00:00.000Z") : null,
      reservedAt: input.status === "reserved" ? new Date("2026-02-02T00:00:00.000Z") : null,
      originClientAccountId: input.origin ?? null,
      commerceExcludedAt: input.commerceExcluded ? new Date("2026-08-24T00:00:00.000Z") : null,
      acquisitionCostCents: input.acquisitionCostCents ?? null,
      metadataJson: (input.metadata ?? { marker: PREFIX }) as Prisma.InputJsonValue,
    },
  });
}
