/**
 * Local Postgres proof for the historical ownership preview.
 * Uses SA360_TEST_DATABASE_URL only (localhost, database name contains "test").
 * Registry rows in this file are fixtures. The preview service does not write them.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { buildApp } from "../../app.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { ownershipDecisionFromAliases } from "./historical-ownership-hypothetical.js";
import {
  runHistoricalCampaignCatalog,
  runHistoricalOwnershipPreview,
  withHistoricalOwnershipSnapshot,
} from "./historical-campaign-ownership-preview.js";

const integrationUrl = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrl);

const PREFIX = "hopv0";
const CLIENT_A = `${PREFIX}_a`;
const CLIENT_B = `${PREFIX}_b`;
const BUYER = `${PREFIX}_buyer`;
const BUYER_NAME = "Hop Secret Buyer";
const VET_LOT = `${PREFIX}-vet`;
const OTHER_LOT = `${PREFIX}-other`;
const VET_IMPORT = `${PREFIX}-vet-import`;
const OTHER_IMPORT = `${PREFIX}-other-import`;
const EMAIL = "hop-secret@example.test";
const WORKBOOK = "Hop Secret Workbook";
const LATER = "Hop Later Only Secret";
const PHONE = "+15555550199";
const ADMIN_KEY = "admin-key-0123456789abc";

describe("historical ownership preview postgres proof", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let createdOrder = false;
  let orderId = `${PREFIX}-order`;
  let request = 0;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrl);
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanup();
    await seed();
  });

  after(async () => {
    if (!db) return;
    await cleanup();
    await db.$disconnect();
  });

  async function setRegistryTriggers(enabled: boolean): Promise<void> {
    const verb = enabled ? "ENABLE" : "DISABLE";
    for (const table of ["HistoricalCampaignAliasEvent", "HistoricalCampaignAlias"]) {
      await db.$executeRawUnsafe(`ALTER TABLE "${table}" ${verb} TRIGGER USER`);
    }
  }

  async function cleanup(): Promise<void> {
    await db.leadAllocation.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await db.leadOrder.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await db.leadInventoryItem.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await db.sourceLeadEvent.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await db.inventoryLot.deleteMany({ where: { lotKey: { startsWith: PREFIX } } });
    await setRegistryTriggers(false);
    try {
      await db.historicalCampaignAliasEvent.deleteMany({ where: { requestId: { startsWith: PREFIX } } });
      await db.historicalCampaignAlias.deleteMany({ where: { scopeKey: { startsWith: PREFIX } } });
    } finally {
      await setRegistryTriggers(true);
    }
    await db.clientAccount.deleteMany({
      where: { clientAccountId: { in: [CLIENT_A, CLIENT_B, BUYER] } },
    });
  }

  async function seed(): Promise<void> {
    await db.clientAccount.createMany({
      data: [
        { clientAccountId: CLIENT_A, clientDisplayName: "Hop Secret Origin A", status: "active" },
        { clientAccountId: CLIENT_B, clientDisplayName: "Hop Secret Origin B", status: "active" },
        { clientAccountId: BUYER, clientDisplayName: BUYER_NAME, status: "active" },
      ],
    });
    await db.inventoryLot.createMany({
      data: [
        {
          lotKey: VET_LOT,
          displayName: "Hop vet lot",
          sourceProvider: "manual_import",
          sourceLane: PREFIX,
          nicheKey: "vet",
          inventoryClass: "aged",
          status: "active",
        },
        {
          lotKey: OTHER_LOT,
          displayName: "Hop other lot",
          sourceProvider: "manual_import",
          sourceLane: PREFIX,
          nicheKey: "trucker",
          inventoryClass: "aged",
          status: "active",
        },
      ],
    });
    await insertItem({ id: "a", lotKey: VET_LOT, campaign: "Vet Label", normalized: "Vet Label", email: EMAIL });
    await insertItem({ id: "b", lotKey: VET_LOT, campaign: "Vet Label", normalized: "Vet Label" });
    await insertItem({ id: "case", lotKey: VET_LOT, campaign: "vet label", normalized: "vet label" });
    await insertItem({
      id: "other-import",
      lotKey: VET_LOT,
      importRequest: OTHER_IMPORT,
      campaign: "Vet Label",
      normalized: "Vet Label",
    });
    await insertItem({
      id: "other-lot",
      lotKey: OTHER_LOT,
      importRequest: OTHER_IMPORT,
      niche: "trucker",
      campaign: "Vet Label",
      normalized: "Vet Label",
    });
    await insertItem({ id: "owned", lotKey: VET_LOT, campaign: "Owned Label", normalized: "Owned Label", origin: CLIENT_A });
    await insertItem({ id: "split-a", lotKey: VET_LOT, campaign: "Split Label", normalized: "Split Label", origin: CLIENT_A });
    await insertItem({
      id: "split-b",
      lotKey: VET_LOT,
      campaign: "Split Label",
      normalized: "Split Label",
      origin: CLIENT_B,
      status: "reserved",
    });
    await insertItem({ id: "conflict", lotKey: VET_LOT, campaign: "Conflict Label", normalized: WORKBOOK });
    await insertItem({ id: "missing", lotKey: VET_LOT });
    await insertItem({ id: "later", lotKey: VET_LOT, normalized: LATER });
    await insertItem({ id: "space", lotKey: VET_LOT, campaign: "  Space   Label " });
    for (let index = 0; index < 5; index += 1) {
      await insertItem({
        id: `reserved-${index}`,
        lotKey: VET_LOT,
        campaign: "Reserved Vet",
        normalized: "Reserved Vet",
        status: "reserved",
      });
    }
    await insertItem({
      id: "live",
      lotKey: VET_LOT,
      provider: "leadcapture_io",
      system: "leadcapture_io_nextgen",
      sourceType: "webhook",
      campaign: "Vet Label",
    });

    const existing = await db.leadOrder.findUnique({ where: { orderNumber: "LO-1053" } });
    if (existing) {
      orderId = existing.id;
    } else {
      createdOrder = true;
      await db.leadOrder.create({
        data: {
          id: orderId,
          orderNumber: "LO-1053",
          clientAccountId: BUYER,
          clientDisplayName: BUYER_NAME,
          status: "active",
          nicheKey: "vet",
          statesJson: ["GA"],
          leadVolume: 5,
          campaignType: "historical-preview",
          crmPackage: "simulation_only",
          createdByRole: "admin",
          orderKind: "pay_per_lead",
          fulfillmentMode: "pooled_matching",
          requestedQuantity: 5,
        },
      });
    }
    for (let index = 0; index < 5; index += 1) {
      await db.leadAllocation.create({
        data: {
          id: `${PREFIX}-alloc-${index}`,
          sourceLeadEventId: `${PREFIX}-evt-reserved-${index}`,
          leadOrderId: orderId,
          leadInventoryItemId: `${PREFIX}-reserved-${index}`,
          clientAccountId: BUYER,
          status: "reserved",
          allocationPolicyVersion: "historical-preview",
          idempotencyKey: `${PREFIX}-alloc-${index}`,
        },
      });
    }
  }

  async function insertItem(input: {
    id: string;
    lotKey: string;
    importRequest?: string;
    niche?: string;
    provider?: "manual_import" | "leadcapture_io";
    system?: "csv_import" | "leadcapture_io_nextgen";
    sourceType?: "bulk_import" | "webhook";
    status?: "available" | "reserved";
    origin?: string;
    campaign?: string;
    normalized?: string;
    email?: string;
  }): Promise<void> {
    const lot = await db.inventoryLot.findUniqueOrThrow({ where: { lotKey: input.lotKey } });
    const raw: Record<string, unknown> = {};
    const importRequest = input.importRequest ?? VET_IMPORT;
    if (input.provider !== "leadcapture_io") raw.importRequestId = importRequest;
    if (input.email) raw.email = input.email;
    if (input.email) raw.phone = PHONE;
    const normalized: Record<string, unknown> = { marker: PREFIX };
    if (input.normalized) normalized.campaign_name = input.normalized;
    const status = input.status ?? "available";
    await db.sourceLeadEvent.create({
      data: {
        id: `${PREFIX}-evt-${input.id}`,
        sourceProvider: input.provider ?? "manual_import",
        sourceSystem: input.system ?? "csv_import",
        sourceType: input.sourceType ?? "bulk_import",
        sourceCampaignName: input.campaign ?? null,
        status: "approved",
        rawPayloadJson: raw as Prisma.InputJsonValue,
        normalizedPayloadJson: normalized as Prisma.InputJsonValue,
      },
    });
    await db.leadInventoryItem.create({
      data: {
        id: `${PREFIX}-${input.id}`,
        inventoryLotId: lot.id,
        sourceLeadEventId: `${PREFIX}-evt-${input.id}`,
        generatedAt: new Date("2026-01-15T00:00:00.000Z"),
        normalizedState: "GA",
        nicheKey: input.niche ?? "vet",
        sourceProvider: input.provider ?? "manual_import",
        sourceLane: PREFIX,
        inventoryClass: "aged",
        status,
        availableAt: status === "available" ? new Date("2026-02-01T00:00:00.000Z") : null,
        reservedAt: status === "reserved" ? new Date("2026-03-01T00:00:00.000Z") : null,
        originClientAccountId: input.origin ?? null,
        phoneFingerprint: `${PREFIX}-phone`,
        emailFingerprint: `${PREFIX}-email`,
      },
    });
  }

  async function registryCounts(): Promise<{ aliases: number; events: number; origins: number; reserved: number }> {
    const [aliases, events, origins, reserved] = await Promise.all([
      db.historicalCampaignAlias.count({ where: { scopeKey: { startsWith: PREFIX } } }),
      db.historicalCampaignAliasEvent.count({ where: { requestId: { startsWith: PREFIX } } }),
      db.leadInventoryItem.count({
        where: { id: { startsWith: PREFIX }, originClientAccountId: { not: null } },
      }),
      db.leadAllocation.count({
        where: { id: { startsWith: PREFIX }, status: "reserved" },
      }),
    ]);
    return { aliases, events, origins, reserved };
  }

  async function confirmAlias(input: {
    scopeType: "inventory_lot" | "import_request";
    scopeKey: string;
    label: string;
    clientId: string;
    status?: "confirmed" | "suggested" | "conflicted";
  }): Promise<void> {
    request += 1;
    const status = input.status ?? "confirmed";
    await db.$transaction(async (tx) => {
      const alias = await tx.historicalCampaignAlias.create({
        data: {
          scopeType: input.scopeType,
          scopeKey: input.scopeKey,
          normalizedLabel: input.label,
          displayLabel: input.label,
          status: status === "confirmed" ? "confirmed" : status,
          originClientAccountId: status === "confirmed" ? input.clientId : null,
        },
      });
      await tx.historicalCampaignAliasEvent.create({
        data: {
          aliasId: alias.id,
          sequence: 1,
          action: status === "confirmed" ? "confirmed" : status === "suggested" ? "suggested" : "conflicted",
          nextOriginClientAccountId: status === "conflicted" ? null : input.clientId,
          actor: "preview-fixture",
          requestId: `${PREFIX}-req-${request}`,
        },
      });
    });
  }

  function campaign(lotKey: string, importRequest: string, normalizedLabel: string, origin = CLIENT_A) {
    return {
      campaigns: [{ lotKey, importRequest, normalizedLabel, originClientAccountId: origin }],
    };
  }

  it("keeps case and import scope apart and omits contact fields", async () => {
    const before = await registryCounts();
    const catalog = await runHistoricalCampaignCatalog(db, { lotKey: VET_LOT, importRequest: VET_IMPORT, pageSize: 50 });
    const labels = catalog.campaigns.map((row) => row.normalizedLabel);
    assert.equal(labels.includes("Vet Label"), true);
    assert.equal(labels.includes("vet label"), true);
    assert.equal(labels.includes(WORKBOOK), false);
    assert.equal(labels.includes(LATER), false);
    const vet = catalog.campaigns.find((row) => row.normalizedLabel === "Vet Label");
    const lower = catalog.campaigns.find((row) => row.normalizedLabel === "vet label");
    const space = catalog.campaigns.find((row) => row.normalizedLabel === "Space Label");
    const split = catalog.campaigns.find((row) => row.normalizedLabel === "Split Label");
    const conflict = catalog.campaigns.find((row) => row.normalizedLabel === "Conflict Label");
    assert.equal(vet?.inventoryRows, 2);
    assert.equal(vet?.availableRows, 2);
    assert.equal(vet?.displayLabel, "Vet Label");
    assert.equal(vet?.persistedReason, "no_coverage");
    assert.equal(vet?.persistedOriginClientAccountId, null);
    assert.equal(lower?.inventoryRows, 1);
    assert.equal(space?.displayLabel, "Space   Label");
    assert.equal(space?.whitespaceVariantCount, 1);
    assert.equal(split?.originConflict, true);
    assert.equal(split?.distinctOriginCount, 2);
    assert.equal(conflict?.conflictingAttributionRows, 1);
    assert.ok(catalog.scopeAttribution.missingLabelRows >= 2);
    const encoded = JSON.stringify(catalog);
    assert.equal(encoded.includes(EMAIL), false);
    assert.equal(encoded.includes(PHONE), false);
    assert.equal(encoded.includes(WORKBOOK), false);
    assert.equal(encoded.includes(LATER), false);
    assert.equal(encoded.includes(BUYER_NAME), false);
    assert.equal(encoded.includes("phoneFingerprint"), false);

    const preview = await runHistoricalOwnershipPreview(db, campaign(VET_LOT, VET_IMPORT, "Vet Label"));
    assert.equal(preview.stampApplied, false);
    assert.equal(preview.resaleAuthorizationApplied, false);
    assert.equal(preview.clientNameMatchEstablishesOwnership, false);
    assert.equal(preview.registryRowsWritten, false);
    assert.equal(preview.verificationStatus, "UNVERIFIED");
    assert.equal(preview.proposals.length, 1);
    const proposal = preview.proposals[0];
    assert.equal(proposal?.inventoryRows, 2);
    assert.equal(proposal?.persisted.reason, "no_coverage");
    assert.equal(proposal?.persisted.source, "historical_campaign_ownership_decision");
    assert.equal(proposal?.hypothetical.source, "hypothetical_not_persisted");
    assert.equal(proposal?.hypothetical.registryWritePerformed, false);
    assert.equal(proposal?.hypothetical.reason, "eligible_scopes_agree");
    assert.equal(proposal?.hypothetical.originClientAccountId, CLIENT_A);
    assert.equal(proposal?.protectedReservation.reservedAllocationsAffected, 0);
    assert.equal(proposal?.protectedReservation.modified, false);
    assert.equal(proposal?.exclusionImpact.selectionUnchanged, true);
    assert.equal(proposal?.exclusionImpact.rowsThatWouldExcludeProposedClientAsBuyer, 2);
    assert.equal(proposal?.verificationStatus, "UNVERIFIED");
    assert.equal(proposal?.missingLabelRows, 0);
    assert.ok(preview.unlabeledRowsInSelectedScopes >= 2);
    const otherImport = await runHistoricalOwnershipPreview(db, campaign(VET_LOT, OTHER_IMPORT, "Vet Label"));
    assert.equal(otherImport.proposals[0]?.inventoryRows, 1);
    const after = await registryCounts();
    assert.deepEqual(after, before);
  });

  it("identifies LO-1053 reservations without changing them", async () => {
    const before = await registryCounts();
    const preview = await runHistoricalOwnershipPreview(db, campaign(VET_LOT, VET_IMPORT, "Reserved Vet", BUYER));
    const proposal = preview.proposals[0];
    assert.equal(proposal?.inventoryRows, 5);
    assert.equal(proposal?.reservedRows, 5);
    assert.equal(proposal?.protectedReservation.orderNumber, "LO-1053");
    assert.equal(proposal?.protectedReservation.reservedAllocationsAffected, 5);
    assert.equal(proposal?.protectedReservation.modified, false);
    assert.equal(preview.protectedReservation.reservedAllocationsAffected, 5);
    assert.equal(proposal?.exclusionImpact.reservedOrCommittedAllocationsToProposedClient, 5);
    assert.equal(proposal?.exclusionImpact.rowsThatWouldExcludeProposedClientAsBuyer, 5);
    const untouched = await runHistoricalOwnershipPreview(db, campaign(VET_LOT, VET_IMPORT, "Vet Label", BUYER));
    assert.equal(untouched.proposals[0]?.protectedReservation.reservedAllocationsAffected, 0);
    const after = await registryCounts();
    assert.equal(after.reserved, before.reserved);
    assert.equal(after.origins, before.origins);
    assert.equal(after.aliases, 0);
  });

  it("matches persisted SQL and keeps hypothetical results unwritten", async () => {
    await confirmAlias({ scopeType: "inventory_lot", scopeKey: VET_LOT, label: "Owned Label", clientId: CLIENT_A });
    await confirmAlias({ scopeType: "import_request", scopeKey: VET_IMPORT, label: "Owned Label", clientId: CLIENT_A });
    await confirmAlias({
      scopeType: "inventory_lot",
      scopeKey: VET_LOT,
      label: "Vet Label",
      clientId: CLIENT_A,
    });
    await confirmAlias({
      scopeType: "import_request",
      scopeKey: VET_IMPORT,
      label: "Vet Label",
      clientId: CLIENT_A,
      status: "suggested",
    });
    await confirmAlias({
      scopeType: "inventory_lot",
      scopeKey: VET_LOT,
      label: "Conflict Label",
      clientId: CLIENT_A,
    });
    await confirmAlias({
      scopeType: "import_request",
      scopeKey: VET_IMPORT,
      label: "Conflict Label",
      clientId: CLIENT_B,
    });

    const owned = await runHistoricalOwnershipPreview(db, campaign(VET_LOT, VET_IMPORT, "Owned Label"));
    assert.equal(owned.proposals[0]?.persisted.reason, "eligible_scopes_agree");
    assert.equal(owned.proposals[0]?.persisted.originClientAccountId, CLIENT_A);
    assert.equal(owned.proposals[0]?.hypothetical.reason, "eligible_scopes_agree");
    assert.equal(owned.proposals[0]?.alreadyStampedToSameClient, 1);
    const ownedSql = await db.$queryRaw<Array<{ decision: string; reason: string; origin_client_account_id: string | null }>>`
      SELECT decision, reason, origin_client_account_id
      FROM historical_campaign_ownership_decision(${VET_LOT}, ${VET_IMPORT}, ${"Owned Label"})
    `;
    assert.equal(ownedSql[0]?.reason, owned.proposals[0]?.persisted.reason);
    assert.equal(ownedSql[0]?.origin_client_account_id, CLIENT_A);
    const mirrored = ownershipDecisionFromAliases(
      { status: "confirmed", originClientAccountId: CLIENT_A },
      { status: "confirmed", originClientAccountId: CLIENT_A }
    );
    assert.equal(mirrored.reason, ownedSql[0]?.reason);

    const ambiguous = await runHistoricalOwnershipPreview(db, campaign(VET_LOT, VET_IMPORT, "Vet Label"));
    assert.equal(ambiguous.proposals[0]?.persisted.reason, "fail_closed_ambiguous");
    assert.equal(ambiguous.proposals[0]?.persisted.originClientAccountId, null);
    assert.equal(ambiguous.proposals[0]?.scopeConflict, "registry_disagreement");
    assert.equal(ambiguous.proposals[0]?.ambiguous, true);
    assert.equal(ambiguous.proposals[0]?.hypothetical.reason, "eligible_scopes_agree");
    assert.equal(ambiguous.proposals[0]?.hypothetical.registryWritePerformed, false);

    const disagreed = await runHistoricalOwnershipPreview(db, campaign(VET_LOT, VET_IMPORT, "Conflict Label", CLIENT_A));
    assert.equal(disagreed.proposals[0]?.persisted.reason, "fail_closed_conflicting_clients");
    assert.equal(disagreed.proposals[0]?.persisted.originClientAccountId, null);
    assert.equal(disagreed.proposals[0]?.hypothetical.rejection, "existing_other_origin");
    assert.equal(disagreed.proposals[0]?.conflict, "existing_other_origin");
    assert.equal(disagreed.proposals[0]?.conflictingLabelRows, 1);

    const blocked = await runHistoricalOwnershipPreview(db, campaign(VET_LOT, VET_IMPORT, "Vet Label", CLIENT_B));
    assert.equal(blocked.proposals[0]?.hypothetical.rejection, "existing_other_origin");
    assert.equal(blocked.proposals[0]?.conflict, "existing_other_origin");

    const counts = await registryCounts();
    assert.equal(counts.aliases, 6);
    assert.equal(counts.origins, 3);
  });

  it("rejects a duplicate proposal and a mapping row without writing", async () => {
    const before = await registryCounts();
    const preview = await runHistoricalOwnershipPreview(db, {
      campaigns: [
        { lotKey: VET_LOT, importRequest: VET_IMPORT, normalizedLabel: "vet label", originClientAccountId: CLIENT_A },
        { lotKey: VET_LOT, importRequest: VET_IMPORT, normalizedLabel: "vet label", originClientAccountId: CLIENT_B },
      ],
    });
    assert.equal(preview.proposals[0]?.conflict, "duplicate_proposal");
    assert.equal(preview.proposals[0]?.hypothetical.rejection, "duplicate_proposal");
    assert.equal(preview.proposals[0]?.inventoryRows, 1);
    const mapped = await runHistoricalOwnershipPreview(db, {
      proposedOriginClientAccountId: CLIENT_A,
      mappingText: `lotKey,importRequest,normalizedLabel\n${VET_LOT},${VET_IMPORT},vet label\n`,
    });
    assert.equal(mapped.proposals[0]?.inventoryRows, 1);
    assert.equal(mapped.proposals[0]?.originClientAccountId, CLIENT_A);
    const legacy = await runHistoricalOwnershipPreview(db, {
      scopeType: "inventory_lot",
      scopeKey: VET_LOT,
      proposals: [{ normalizedLabel: "Vet Label", originClientAccountId: CLIENT_A }],
    });
    assert.equal(legacy.scopeMode, "single_scope");
    assert.ok((legacy.proposals.length ?? 0) >= 2);
    assert.equal(legacy.proposals.every((row) => row.ambiguous), true);
    assert.equal(legacy.proposals.every((row) => row.scopeConflict === "multiple_counterpart_scopes"), true);
    const after = await registryCounts();
    assert.equal(after.aliases, before.aliases);
    assert.equal(after.events, before.events);
  });

  it("previews a large campaign in one scoped snapshot", async () => {
    const lot = await db.inventoryLot.findUniqueOrThrow({ where: { lotKey: VET_LOT } });
    const events = Array.from({ length: 300 }, (_, index) => ({
      id: `${PREFIX}-evt-big-${index}`,
      sourceProvider: "manual_import" as const,
      sourceSystem: "csv_import" as const,
      sourceType: "bulk_import" as const,
      sourceCampaignName: "Large Label",
      status: "approved" as const,
      rawPayloadJson: { importRequestId: VET_IMPORT, email: EMAIL },
      normalizedPayloadJson: { marker: PREFIX, campaign_name: "Large Label" },
    }));
    const items = events.map((event, index) => ({
      id: `${PREFIX}-big-${index}`,
      inventoryLotId: lot.id,
      sourceLeadEventId: event.id,
      generatedAt: new Date("2026-01-15T00:00:00.000Z"),
      normalizedState: "GA",
      nicheKey: "vet",
      sourceProvider: "manual_import" as const,
      sourceLane: PREFIX,
      inventoryClass: "aged" as const,
      status: "available" as const,
      availableAt: new Date("2026-02-01T00:00:00.000Z"),
      phoneFingerprint: `${PREFIX}-phone-big`,
      emailFingerprint: `${PREFIX}-email-big`,
    }));
    await db.sourceLeadEvent.createMany({ data: events });
    await db.leadInventoryItem.createMany({ data: items });
    const started = Date.now();
    const preview = await runHistoricalOwnershipPreview(db, campaign(VET_LOT, VET_IMPORT, "Large Label"));
    const elapsed = Date.now() - started;
    assert.equal(preview.proposals[0]?.inventoryRows, 300);
    assert.equal(preview.proposals[0]?.availableRows, 300);
    assert.equal(preview.proposals[0]?.protectedReservation.reservedAllocationsAffected, 0);
    assert.ok(elapsed < 8_000, `preview took ${elapsed}ms`);
    assert.equal(JSON.stringify(preview).includes(EMAIL), false);
  });

  it("stays read-only inside the snapshot and on the operator route", async () => {
    await assert.rejects(
      () =>
        withHistoricalOwnershipSnapshot(db, async (tx) => {
          await tx.$executeRaw`
            INSERT INTO "HistoricalCampaignAlias" (
              "id", "scopeType", "scopeKey", "normalizedLabel", "displayLabel", "status", "updatedAt"
            ) VALUES (
              ${`${PREFIX}-write`}, 'inventory_lot'::"HistoricalRegistryScopeType", ${`${PREFIX}-write`},
              'Write', 'Write', 'unassigned'::"HistoricalCampaignAliasStatus", NOW()
            )
          `;
        }, 5_000),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return /read-only|25006/i.test(message);
      }
    );
    assert.equal(await db.historicalCampaignAlias.count({ where: { id: `${PREFIX}-write` } }), 0);

    const previousFlag = process.env.SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED;
    const previousKey = process.env.ADMIN_API_KEY;
    process.env.SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED = "true";
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    const app = await buildApp();
    try {
      const catalog = await app.inject({
        method: "POST",
        url: "/admin/v1/fulfillment-ops/historical-campaign-catalog",
        headers: { "x-sa360-admin-key": ADMIN_KEY },
        payload: { lotKey: VET_LOT, importRequest: VET_IMPORT, label: "Vet Label" },
      });
      assert.equal(catalog.statusCode, 200);
      assert.equal(catalog.json().campaigns[0].normalizedLabel, "Vet Label");
      assert.equal(catalog.body.includes(EMAIL), false);
      assert.equal(catalog.body.includes(BUYER_NAME), false);
      const portal = await app.inject({
        method: "POST",
        url: "/client/v1/fulfillment-ops/historical-campaign-catalog",
        headers: { "x-sa360-admin-key": ADMIN_KEY },
        payload: { lotKey: VET_LOT },
      });
      assert.equal(portal.statusCode, 404);
    } finally {
      await app.close();
      if (previousFlag === undefined) delete process.env.SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED;
      else process.env.SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED = previousFlag;
      if (previousKey === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = previousKey;
    }
  });
});
