/**
 * Local proof that the historical campaign catalog can read
 * historical_catalog_projection without changing the response contract.
 *
 * Uses SA360_TEST_DATABASE_URL only (localhost, database name contains "test").
 * The singleton ready flag is restored to false before the file exits.
 * This file does not migrate, deploy, or query production.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  buildHistoricalCampaignCatalogQuery,
  buildHistoricalCampaignProjectionCatalogQuery,
  runHistoricalCampaignCatalog,
  runHistoricalOwnershipPreview,
  withHistoricalOwnershipSnapshot,
  type CatalogCampaign,
  type HistoricalCampaignCatalog,
} from "./historical-campaign-ownership-preview.js";
import { HistoricalOwnershipPreviewError } from "./historical-ownership-preview-error.js";
import type { CatalogRequest } from "./historical-ownership-preview-request.js";

const integrationUrl = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrl);

const PREFIX = "g5cat";
const CLIENT_A = `${PREFIX}_a`;
const CLIENT_B = `${PREFIX}_b`;
const VET = `${PREFIX}-vet`;
const TRUCKER = `${PREFIX}-trucker`;
const PAD_LOT = `  ${PREFIX}-vetpad`;
const BLANK_LOT = "   ";
const IMP_A = `${PREFIX}-imp-a`;
const IMP_B = `${PREFIX}-imp-b`;
const IMP_PAD = `${PREFIX}-imp-pad`;
const IMP_BLANK = `${PREFIX}-imp-blank`;
const BENCH_LOT = `${PREFIX}-bench`;
const BENCH_IMPORT = `${PREFIX}-imp-bench`;
const HIDDEN_PROJECTION = "historical_catalog_projection_gate5_hidden";
const LOT_INDEX = "historical_catalog_projection_lot_idx";
const BENCH_ROWS = 400;
const BALLAST_ROWS = 40_000;

type SqlCatalog = {
  scope_inventory_rows: number;
  missing_label_rows: number;
  conflicting_label_rows: number;
  total_campaigns: number;
  campaigns: CatalogJson[];
};

type CatalogJson = {
  displayLabel: string;
  normalizedLabel: string;
  lotKey: string;
  importRequest: string;
  nicheKey: string;
  inventoryRows: number;
  availableRows: number;
  reservedRows: number;
  consistentAttributionRows: number;
  conflictingAttributionRows: number;
  stampedOriginRows: number;
  whitespaceVariantCount: number;
  distinctOriginCount: number;
  distinctOriginClientAccountIds: string[];
  lotAliasStatus: string;
  importAliasStatus: string;
  lotConfirmedOriginClientAccountId: string | null;
  importConfirmedOriginClientAccountId: string | null;
  persistedDecision: string;
  persistedReason: string;
  persistedOriginClientAccountId: string | null;
};

function request(partial: Partial<CatalogRequest> & Pick<CatalogRequest, "lotKey" | "importRequest">): CatalogRequest {
  return {
    lotKey: partial.lotKey,
    importRequest: partial.importRequest,
    niche: partial.niche ?? null,
    label: partial.label ?? null,
    page: partial.page ?? 1,
    pageSize: partial.pageSize ?? 50,
  };
}

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => normalize(entry));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "database_name" || key === "server_address" || key === "captured_at") continue;
      out[key] = normalize(child);
    }
    return out;
  }
  return value;
}

function asCatalog(value: unknown): SqlCatalog {
  const row = normalize(value) as SqlCatalog;
  if (typeof row.campaigns === "string") row.campaigns = JSON.parse(row.campaigns) as CatalogJson[];
  return row;
}

function labelsOf(catalog: { campaigns: Array<{ normalizedLabel: string }> }): string[] {
  return catalog.campaigns.map((campaign) => campaign.normalizedLabel);
}

function findCampaign(
  catalog: SqlCatalog,
  normalizedLabel: string,
  lotKey: string,
  importRequest: string,
): CatalogJson {
  const found = catalog.campaigns.filter(
    (campaign) =>
      campaign.normalizedLabel === normalizedLabel &&
      campaign.lotKey === lotKey &&
      campaign.importRequest === importRequest,
  );
  assert.equal(found.length, 1, JSON.stringify(catalog.campaigns.map((campaign) => [
    campaign.normalizedLabel,
    campaign.lotKey,
    campaign.importRequest,
    campaign.inventoryRows,
  ])));
  return found[0] as CatalogJson;
}

function serviceView(catalog: HistoricalCampaignCatalog): unknown {
  return {
    ...catalog,
    measurement: {
      readOnlySnapshot: catalog.measurement.readOnlySnapshot,
      operatorVerifiedProduction: catalog.measurement.operatorVerifiedProduction,
    },
  };
}

function planText(rows: ReadonlyArray<Record<string, unknown>>): string {
  return rows.map((row) => String(Object.values(row)[0] ?? "")).join("\n");
}

function bufferSums(plan: string): { sharedHit: number; sharedRead: number } {
  const line = plan.split("\n").find((entry) => entry.includes("Buffers:"));
  return {
    sharedHit: Number(line?.match(/shared hit=(\d+)/)?.[1] ?? 0),
    sharedRead: Number(line?.match(/shared read=(\d+)/)?.[1] ?? 0),
  };
}

function executionMs(plan: string): number | null {
  const match = plan.match(/Execution Time: ([0-9.]+) ms/);
  return match ? Number(match[1]) : null;
}

describe("historical catalog projection read path", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let aliasRequest = 0;

  before(async () => {
    db = new PrismaClient({ datasources: { db: { url: assertSafeTestDatabaseUrl(integrationUrl) } } });
    await restoreProjectionName();
    await enableProjectionTriggers();
    await restoreControl();
    await ensureLotIndex();
    await cleanup();
    await seed();
  });

  after(async () => {
    if (!db) return;
    await restoreProjectionName();
    await enableProjectionTriggers();
    await restoreControl();
    await cleanup();
    await db.$disconnect();
  });

  async function enableProjectionTriggers(): Promise<void> {
    for (const statement of [
      `ALTER TABLE "LeadInventoryItem" ENABLE TRIGGER historical_catalog_projection_item_refresh`,
      `ALTER TABLE "SourceLeadEvent" ENABLE TRIGGER historical_catalog_projection_event_refresh`,
      `ALTER TABLE "InventoryLot" ENABLE TRIGGER historical_catalog_projection_lot_refresh`,
    ]) {
      await db.$executeRawUnsafe(statement);
    }
  }

  async function restoreProjectionName(): Promise<void> {
    const hidden = await db.$queryRaw<Array<{ present: string | null }>>`
      SELECT to_regclass(${`public.${HIDDEN_PROJECTION}`})::text AS present
    `;
    if (hidden[0]?.present) {
      await db.$executeRawUnsafe(`ALTER TABLE ${HIDDEN_PROJECTION} RENAME TO historical_catalog_projection`);
    }
  }

  async function restoreControl(): Promise<void> {
    const existing = await db.historicalCatalogProjectionControl.findUnique({ where: { singleton: true } });
    if (!existing) {
      await db.historicalCatalogProjectionControl.create({
        data: {
          singleton: true,
          ready: false,
          note: "Empty read model. Catalog SQL keeps reading SourceLeadEvent until a separate approved backfill sets ready.",
        },
      });
      return;
    }
    if (existing.ready) {
      await db.historicalCatalogProjectionControl.update({
        where: { singleton: true },
        data: { ready: false },
      });
    }
  }

  async function setReady(ready: boolean): Promise<void> {
    await db.historicalCatalogProjectionControl.update({
      where: { singleton: true },
      data: { ready },
    });
  }

  async function ensureLotIndex(): Promise<void> {
    const found = await db.$queryRaw<Array<{ valid: boolean; ready: boolean; live: boolean; def: string }>>`
      SELECT i.indisvalid AS valid, i.indisready AS ready, i.indislive AS live, pg_get_indexdef(i.indexrelid) AS def
      FROM pg_class c
      JOIN pg_index i ON i.indexrelid = c.oid
      JOIN pg_class t ON t.oid = i.indrelid
      WHERE t.relname = 'historical_catalog_projection'
        AND c.relname = ${LOT_INDEX}
    `;
    if (found.length === 0) {
      await db.$executeRawUnsafe(
        `CREATE INDEX ${LOT_INDEX} ON public.historical_catalog_projection (lot_key)`,
      );
      return ensureLotIndex();
    }
    assert.equal(found.length, 1);
    assert.equal(found[0]?.valid, true);
    assert.equal(found[0]?.ready, true);
    assert.equal(found[0]?.live, true);
    assert.match(found[0]?.def ?? "", /USING btree \(lot_key\)/);
    assert.doesNotMatch(found[0]?.def ?? "", /INCLUDE/i);
  }

  async function setAliasTriggers(enabled: boolean): Promise<void> {
    const verb = enabled ? "ENABLE" : "DISABLE";
    for (const table of ["HistoricalCampaignAliasEvent", "HistoricalCampaignAlias"]) {
      await db.$executeRawUnsafe(`ALTER TABLE "${table}" ${verb} TRIGGER USER`);
    }
  }

  async function cleanup(): Promise<void> {
    await db.$executeRaw`DELETE FROM historical_catalog_projection WHERE item_id LIKE ${`${PREFIX}%`}`;
    await db.leadInventoryItem.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await db.sourceLeadEvent.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await db.inventoryLot.deleteMany({ where: { sourceLane: PREFIX } });
    await setAliasTriggers(false);
    try {
      await db.historicalCampaignAliasEvent.deleteMany({ where: { requestId: { startsWith: PREFIX } } });
      await db.historicalCampaignAlias.deleteMany({
        where: { scopeKey: { startsWith: PREFIX } },
      });
    } finally {
      await setAliasTriggers(true);
    }
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: [CLIENT_A, CLIENT_B] } } });
  }

  async function seed(): Promise<void> {
    const triggers = await db.$queryRaw<Array<{ tgname: string; tgenabled: string }>>`
      SELECT tgname::text AS tgname, tgenabled::text AS tgenabled
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname LIKE 'historical_catalog_projection_%'
      ORDER BY tgname
    `;
    assert.deepEqual(
      triggers.map((trigger) => `${trigger.tgname}:${trigger.tgenabled}`),
      [
        "historical_catalog_projection_event_refresh:O",
        "historical_catalog_projection_item_refresh:O",
        "historical_catalog_projection_lot_refresh:O",
      ],
    );
    await db.clientAccount.createMany({
      data: [
        { clientAccountId: CLIENT_A, clientDisplayName: "Gate 5 origin A", status: "active" },
        { clientAccountId: CLIENT_B, clientDisplayName: "Gate 5 origin B", status: "active" },
      ],
    });
    await lot(VET, "vet");
    await lot(TRUCKER, "trucker");
    await lot(PAD_LOT, "vet");
    await lot(BLANK_LOT, "vet");

    await insertItem({ id: "a", lotKey: VET, campaign: "Vet Label", workbook: "Vet Label", rawLabel: "Vet Label", origin: CLIENT_A });
    await insertItem({ id: "b", lotKey: VET, campaign: "Vet Label", workbook: "Vet Label", rawLabel: "Vet Label", origin: CLIENT_B });
    await insertItem({ id: "c", lotKey: VET, campaign: "Vet Label", workbook: "Vet Label", rawLabel: "Vet Label" });
    await insertItem({ id: "space", lotKey: VET, campaign: "Vet  Label", workbook: "Vet  Label", rawLabel: "Vet  Label", origin: CLIENT_A });
    await insertItem({ id: "case", lotKey: VET, campaign: "vet label", workbook: "vet label", rawLabel: "vet label" });
    await insertItem({
      id: "conflict",
      lotKey: VET,
      campaign: "Conflict Label",
      workbook: "Other Workbook",
      rawLabel: "Conflict Label",
      status: "reserved",
    });
    await insertItem({ id: "missing-null", lotKey: VET, campaign: null });
    await insertItem({ id: "missing-space", lotKey: VET, campaign: "   " });
    await insertItem({ id: "mixed-vet", lotKey: VET, campaign: "Mixed Niche", workbook: "Mixed Niche", niche: "vet" });
    await insertItem({ id: "mixed-trucker", lotKey: VET, campaign: "Mixed Niche", workbook: "Mixed Niche", niche: "trucker" });
    await insertItem({ id: "imp-b-1", lotKey: VET, importRequest: IMP_B, campaign: "Vet Label", workbook: "Vet Label" });
    await insertItem({ id: "imp-b-2", lotKey: VET, importRequest: IMP_B, campaign: "Vet Label", workbook: "Vet Label" });
    await insertItem({ id: "none-import", lotKey: VET, importRequest: null, campaign: "None Import", workbook: "None Import" });
    await insertItem({ id: "post-july", lotKey: VET, campaign: null, workbook: "Workbook Only" });
    await insertItem({ id: "only", lotKey: VET, campaign: "Only July", workbook: "Only July", rawLabel: "Only July" });
    await insertItem({ id: "truck-a", lotKey: TRUCKER, campaign: "Trucker Label", workbook: "Trucker Label", niche: "trucker" });
    await insertItem({
      id: "truck-b",
      lotKey: TRUCKER,
      campaign: "Trucker Label",
      workbook: "Trucker Label",
      niche: "trucker",
      status: "reserved",
    });
    await insertItem({
      id: "truck-space",
      lotKey: TRUCKER,
      campaign: "Trucker  Label",
      workbook: "Trucker  Label",
      niche: "trucker",
    });
    await insertItem({
      id: "pad",
      lotKey: PAD_LOT,
      importRequest: IMP_PAD,
      niche: " vet",
      campaign: "Pad Label",
      workbook: "Pad Label",
    });
    await insertItem({
      id: "blank",
      lotKey: BLANK_LOT,
      importRequest: IMP_BLANK,
      niche: "   ",
      campaign: "Blank Label",
      workbook: "Blank Label",
    });
    await insertItem({
      id: "live",
      lotKey: VET,
      provider: "leadcapture_io",
      system: "leadcapture_io_nextgen",
      sourceType: "webhook",
      campaign: "Live Webhook",
      workbook: "Live Webhook",
    });
  }

  async function lot(lotKey: string, niche: string): Promise<void> {
    await db.inventoryLot.create({
      data: {
        lotKey,
        displayName: lotKey.trim() || "blank lot",
        sourceProvider: "manual_import",
        sourceLane: PREFIX,
        nicheKey: niche.trim() || "vet",
        inventoryClass: "aged",
        status: "active",
      },
    });
  }

  async function insertItem(input: {
    id: string;
    lotKey: string;
    importRequest?: string | null;
    niche?: string;
    provider?: "manual_import" | "leadcapture_io";
    system?: "csv_import" | "leadcapture_io_nextgen";
    sourceType?: "bulk_import" | "webhook";
    status?: "available" | "reserved";
    origin?: string | null;
    campaign?: string | null;
    workbook?: string | null;
    rawLabel?: string | null;
  }): Promise<void> {
    const storedLot = await db.inventoryLot.findUniqueOrThrow({ where: { lotKey: input.lotKey } });
    const raw: Record<string, unknown> = {};
    if (input.importRequest !== null) raw.importRequestId = input.importRequest ?? IMP_A;
    if (input.rawLabel != null) raw.master = { lead_type: input.rawLabel };
    const normalized: Record<string, unknown> = {};
    if (input.workbook != null) normalized.campaign_name = input.workbook;
    const status = input.status ?? "available";
    await db.sourceLeadEvent.create({
      data: {
        id: `${PREFIX}-evt-${input.id}`,
        sourceProvider: input.provider ?? "manual_import",
        sourceSystem: input.system ?? "csv_import",
        sourceType: input.sourceType ?? "bulk_import",
        sourceCampaignName: input.campaign === undefined ? null : input.campaign,
        status: "approved",
        rawPayloadJson: raw as Prisma.InputJsonValue,
        normalizedPayloadJson: normalized as Prisma.InputJsonValue,
      },
    });
    await db.leadInventoryItem.create({
      data: {
        id: `${PREFIX}-${input.id}`,
        inventoryLotId: storedLot.id,
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
      },
    });
  }

  async function both(input: CatalogRequest): Promise<{ legacy: SqlCatalog; projection: SqlCatalog }> {
    return withHistoricalOwnershipSnapshot(db, async (tx) => {
      const legacyRows = await tx.$queryRaw<Array<Record<string, unknown>>>(buildHistoricalCampaignCatalogQuery(input));
      const projectionRows = await tx.$queryRaw<Array<Record<string, unknown>>>(
        buildHistoricalCampaignProjectionCatalogQuery(input),
      );
      return {
        legacy: asCatalog(legacyRows[0]),
        projection: asCatalog(projectionRows[0]),
      };
    }, 20_000);
  }

  async function assertSame(input: CatalogRequest): Promise<SqlCatalog> {
    const result = await both(input);
    assert.deepEqual(result.projection, result.legacy);
    return result.legacy;
  }

  async function writeAlias(input: {
    scopeType: "inventory_lot" | "import_request";
    scopeKey: string;
    label: string;
    status: "confirmed" | "conflicted";
    clientId: string | null;
    previousClientId?: string | null;
  }): Promise<void> {
    aliasRequest += 1;
    await db.$transaction(async (tx) => {
      const alias = await tx.historicalCampaignAlias.upsert({
        where: {
          scopeType_scopeKey_normalizedLabel: {
            scopeType: input.scopeType,
            scopeKey: input.scopeKey,
            normalizedLabel: input.label,
          },
        },
        create: {
          scopeType: input.scopeType,
          scopeKey: input.scopeKey,
          normalizedLabel: input.label,
          displayLabel: input.label,
          status: input.status,
          originClientAccountId: input.status === "confirmed" ? input.clientId : null,
        },
        update: {
          status: input.status,
          originClientAccountId: input.status === "confirmed" ? input.clientId : null,
        },
      });
      await tx.historicalCampaignAliasEvent.create({
        data: {
          aliasId: alias.id,
          sequence: 1,
          action: input.status,
          previousOriginClientAccountId: input.previousClientId ?? null,
          nextOriginClientAccountId: input.status === "confirmed" ? input.clientId : null,
          actor: "gate5-fixture",
          requestId: `${PREFIX}-req-${aliasRequest}`,
        },
      });
    });
  }

  it("matches legacy results for vet, trucker, blank, and padded filters", async () => {
    const vet = await assertSame(request({ lotKey: VET, importRequest: null }));
    assert.equal(vet.scope_inventory_rows, 15);
    assert.equal(vet.missing_label_rows, 3);
    assert.equal(vet.conflicting_label_rows, 1);
    assert.equal(vet.total_campaigns, 7);
    assert.deepEqual(
      vet.campaigns.map((campaign) => [campaign.normalizedLabel, campaign.importRequest, campaign.inventoryRows]),
      [
        ["Vet Label", IMP_A, 4],
        ["Mixed Niche", IMP_A, 2],
        ["Vet Label", IMP_B, 2],
        ["Conflict Label", IMP_A, 1],
        ["None Import", "(none)", 1],
        ["Only July", IMP_A, 1],
        ["vet label", IMP_A, 1],
      ],
    );
    assert.equal(labelsOf(vet).includes("Live Webhook"), false);
    const display = await db.$queryRaw<Array<{ least: string }>>`SELECT LEAST('Vet Label', 'Vet  Label') AS least`;
    const vetLabel = findCampaign(vet, "Vet Label", VET, IMP_A);
    assert.equal(vetLabel.displayLabel, display[0]?.least);
    assert.equal(vetLabel.nicheKey, "vet");
    assert.equal(vetLabel.availableRows, 4);
    assert.equal(vetLabel.reservedRows, 0);
    assert.equal(vetLabel.consistentAttributionRows, 4);
    assert.equal(vetLabel.conflictingAttributionRows, 0);
    assert.equal(vetLabel.stampedOriginRows, 3);
    assert.equal(vetLabel.distinctOriginCount, 2);
    assert.deepEqual(vetLabel.distinctOriginClientAccountIds, [CLIENT_A, CLIENT_B]);
    assert.equal(vetLabel.whitespaceVariantCount, 2);
    assert.equal(vetLabel.lotAliasStatus, "absent");
    assert.equal(vetLabel.importAliasStatus, "absent");
    assert.equal(vetLabel.persistedDecision, "not_eligible");
    assert.equal(vetLabel.persistedReason, "no_coverage");
    assert.equal(vetLabel.persistedOriginClientAccountId, null);

    const conflict = findCampaign(vet, "Conflict Label", VET, IMP_A);
    assert.equal(conflict.reservedRows, 1);
    assert.equal(conflict.availableRows, 0);
    assert.equal(conflict.conflictingAttributionRows, 1);
    assert.equal(conflict.consistentAttributionRows, 0);
    const mixed = findCampaign(vet, "Mixed Niche", VET, IMP_A);
    assert.equal(mixed.nicheKey, "mixed");
    const only = findCampaign(vet, "Only July", VET, IMP_A);
    assert.equal(only.consistentAttributionRows, 1);

    const searched = await assertSame(request({ lotKey: VET, importRequest: null, label: "Vet" }));
    assert.equal(searched.scope_inventory_rows, vet.scope_inventory_rows);
    assert.equal(searched.missing_label_rows, vet.missing_label_rows);
    assert.equal(searched.conflicting_label_rows, vet.conflicting_label_rows);
    assert.equal(searched.total_campaigns, 2);
    assert.deepEqual(labelsOf(searched), ["Vet Label", "Vet Label"]);

    const pageOne = await assertSame(request({ lotKey: VET, importRequest: null, page: 1, pageSize: 1 }));
    const pageTwo = await assertSame(request({ lotKey: VET, importRequest: null, page: 2, pageSize: 1 }));
    assert.equal(pageOne.total_campaigns, 7);
    assert.equal(pageOne.campaigns.length, 1);
    assert.equal(pageTwo.campaigns.length, 1);
    assert.equal(pageOne.campaigns[0]?.normalizedLabel, "Vet Label");
    assert.equal(pageOne.campaigns[0]?.importRequest, IMP_A);
    assert.equal(pageTwo.campaigns[0]?.normalizedLabel, "Mixed Niche");
    assert.equal(pageOne.scope_inventory_rows, pageTwo.scope_inventory_rows);

    const trucker = await assertSame(request({ lotKey: TRUCKER, importRequest: null }));
    assert.equal(trucker.total_campaigns, 1);
    assert.equal(trucker.scope_inventory_rows, 3);
    const truck = findCampaign(trucker, "Trucker Label", TRUCKER, IMP_A);
    assert.equal(truck.inventoryRows, 3);
    assert.equal(truck.availableRows, 2);
    assert.equal(truck.reservedRows, 1);
    assert.equal(truck.whitespaceVariantCount, 2);

    const sharedImport = await assertSame(request({ lotKey: null, importRequest: IMP_A }));
    assert.equal(sharedImport.scope_inventory_rows, 15);
    assert.equal(sharedImport.total_campaigns, 6);
    assert.equal(findCampaign(sharedImport, "Trucker Label", TRUCKER, IMP_A).inventoryRows, 3);

    const niche = await assertSame(request({ lotKey: VET, importRequest: null, niche: "vet" }));
    assert.equal(niche.scope_inventory_rows, 14);
    assert.equal(findCampaign(niche, "Mixed Niche", VET, IMP_A).nicheKey, "vet");
    assert.equal(findCampaign(niche, "Mixed Niche", VET, IMP_A).inventoryRows, 1);

    const padded = await assertSame(request({ lotKey: PAD_LOT, importRequest: null }));
    assert.equal(padded.total_campaigns, 1);
    assert.equal(padded.campaigns[0]?.lotKey, `${PREFIX}-vetpad`);
    assert.equal(padded.campaigns[0]?.nicheKey, "vet");
    const paddedNiche = await assertSame(request({ lotKey: null, importRequest: IMP_PAD, niche: " vet" }));
    assert.equal(paddedNiche.total_campaigns, 1);
    const trimmedNicheMiss = await assertSame(request({ lotKey: null, importRequest: IMP_PAD, niche: "vet" }));
    assert.equal(trimmedNicheMiss.total_campaigns, 0);
    assert.equal(trimmedNicheMiss.scope_inventory_rows, 0);

    const blank = await assertSame(request({ lotKey: BLANK_LOT, importRequest: null }));
    assert.equal(blank.total_campaigns, 1);
    assert.equal(blank.campaigns[0]?.lotKey, "(blank)");
    assert.equal(blank.campaigns[0]?.nicheKey, "(blank)");
    const literalBlank = await assertSame(request({ lotKey: "(blank)", importRequest: null }));
    assert.equal(literalBlank.total_campaigns, 0);
    const blankNiche = await assertSame(request({ lotKey: null, importRequest: IMP_BLANK, niche: "   " }));
    assert.equal(blankNiche.campaigns[0]?.nicheKey, "(blank)");
    // `(none)` is a shared sentinel. Other local fixtures can be historical source rows
    // that were never backfilled, so this comparison stays inside the fixture lot.
    const noneImport = await assertSame(request({ lotKey: VET, importRequest: "(none)" }));
    assert.equal(noneImport.scope_inventory_rows, 1);
    assert.equal(noneImport.missing_label_rows, 0);
    assert.equal(noneImport.total_campaigns, 1);
    assert.equal(noneImport.campaigns[0]?.normalizedLabel, "None Import");

    await setReady(false);
    const legacyService = await runHistoricalCampaignCatalog(db, { lotKey: VET, label: "  Vet   Label ", pageSize: 50 });
    await setReady(true);
    try {
      const projectionService = await runHistoricalCampaignCatalog(db, {
        lotKey: VET,
        label: "  Vet   Label ",
        pageSize: 50,
      });
      assert.deepEqual(serviceView(projectionService), serviceView(legacyService));
      assert.equal(projectionService.readOnly, true);
      assert.equal(projectionService.registryRowsWritten, false);
      assert.equal(projectionService.inventoryRowsWritten, false);
      assert.equal(projectionService.scopeAttribution.inventoryRows, 15);
      assert.equal(projectionService.totalCampaigns, 2);
      assert.equal(projectionService.measurement.databaseIdentity.name.includes("test"), true);
      const campaign = projectionService.campaigns[0] as CatalogCampaign;
      assert.equal(campaign.originConflict, true);
      assert.equal(campaign.whitespaceVariantCount, 2);
      assert.equal(JSON.stringify(projectionService).includes("Live Webhook"), false);
      assert.equal(JSON.stringify(projectionService).includes("Workbook Only"), false);
    } finally {
      await setReady(false);
    }
  });

  it("follows status, origin, and alias changes on both read paths", async () => {
    try {
      await db.leadInventoryItem.update({
        where: { id: `${PREFIX}-case` },
        data: { status: "reserved", reservedAt: new Date("2026-03-02T00:00:00.000Z"), availableAt: null },
      });
      const reserved = await assertSame(request({ lotKey: VET, importRequest: null }));
      assert.equal(findCampaign(reserved, "vet label", VET, IMP_A).reservedRows, 1);
      assert.equal(findCampaign(reserved, "vet label", VET, IMP_A).availableRows, 0);

      await db.leadInventoryItem.update({
        where: { id: `${PREFIX}-c` },
        data: { originClientAccountId: CLIENT_A },
      });
      const stamped = await assertSame(request({ lotKey: VET, importRequest: null }));
      assert.equal(findCampaign(stamped, "Vet Label", VET, IMP_A).stampedOriginRows, 4);
      assert.deepEqual(findCampaign(stamped, "Vet Label", VET, IMP_A).distinctOriginClientAccountIds, [CLIENT_A, CLIENT_B]);
    } finally {
      await db.leadInventoryItem.update({
        where: { id: `${PREFIX}-case` },
        data: { status: "available", reservedAt: null, availableAt: new Date("2026-02-01T00:00:00.000Z") },
      });
      await db.leadInventoryItem.update({
        where: { id: `${PREFIX}-c` },
        data: { originClientAccountId: null },
      });
    }

    try {
      await writeAlias({
        scopeType: "inventory_lot",
        scopeKey: VET,
        label: "Vet Label",
        status: "confirmed",
        clientId: CLIENT_A,
      });
      await writeAlias({
        scopeType: "import_request",
        scopeKey: IMP_A,
        label: "Vet Label",
        status: "confirmed",
        clientId: CLIENT_A,
      });
      const agreed = await assertSame(request({ lotKey: VET, importRequest: IMP_A }));
      const agreedCampaign = findCampaign(agreed, "Vet Label", VET, IMP_A);
      assert.equal(agreedCampaign.lotAliasStatus, "confirmed");
      assert.equal(agreedCampaign.importAliasStatus, "confirmed");
      assert.equal(agreedCampaign.lotConfirmedOriginClientAccountId, CLIENT_A);
      assert.equal(agreedCampaign.importConfirmedOriginClientAccountId, CLIENT_A);
      assert.equal(agreedCampaign.persistedDecision, "eligible");
      assert.equal(agreedCampaign.persistedReason, "eligible_scopes_agree");
      assert.equal(agreedCampaign.persistedOriginClientAccountId, CLIENT_A);

      await writeAlias({
        scopeType: "import_request",
        scopeKey: IMP_A,
        label: "Vet Label",
        status: "conflicted",
        clientId: null,
        previousClientId: CLIENT_A,
      });
      const conflicted = await assertSame(request({ lotKey: VET, importRequest: IMP_A }));
      const conflictedCampaign = findCampaign(conflicted, "Vet Label", VET, IMP_A);
      assert.equal(conflictedCampaign.importAliasStatus, "conflicted");
      assert.equal(conflictedCampaign.importConfirmedOriginClientAccountId, null);
      assert.equal(conflictedCampaign.lotAliasStatus, "confirmed");
      assert.equal(conflictedCampaign.persistedDecision, "not_eligible");
      assert.equal(conflictedCampaign.persistedReason, "fail_closed_conflicted");
      assert.equal(conflictedCampaign.persistedOriginClientAccountId, null);
    } finally {
      await setAliasTriggers(false);
      try {
        await db.historicalCampaignAliasEvent.deleteMany({ where: { requestId: { startsWith: PREFIX } } });
        await db.historicalCampaignAlias.deleteMany({ where: { scopeKey: { in: [VET, IMP_A] } } });
      } finally {
        await setAliasTriggers(true);
      }
    }

    const cleared = await assertSame(request({ lotKey: VET, importRequest: IMP_A }));
    assert.equal(findCampaign(cleared, "Vet Label", VET, IMP_A).persistedReason, "no_coverage");
    assert.equal(findCampaign(cleared, "vet label", VET, IMP_A).reservedRows, 0);
    assert.equal(findCampaign(cleared, "Vet Label", VET, IMP_A).stampedOriginRows, 3);
  });

  it("keeps a catalog snapshot stable while a trigger commits", async () => {
    const writer = new PrismaClient({ datasources: { db: { url: assertSafeTestDatabaseUrl(integrationUrl) } } });
    const input = request({ lotKey: VET, importRequest: null });
    let releaseRead: () => void = () => undefined;
    const readOpened = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let releaseWrite: () => void = () => undefined;
    const writeDone = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const pending = (async () => {
      try {
        await readOpened;
        await writer.sourceLeadEvent.update({
          where: { id: `${PREFIX}-evt-only` },
          data: { sourceCampaignName: "During Read" },
        });
      } finally {
        releaseWrite();
      }
    })();
    try {
      const seen = await withHistoricalOwnershipSnapshot(db, async (tx) => {
        const beforeLegacy = asCatalog(
          (await tx.$queryRaw<Array<Record<string, unknown>>>(buildHistoricalCampaignCatalogQuery(input)))[0],
        );
        const beforeProjection = asCatalog(
          (await tx.$queryRaw<Array<Record<string, unknown>>>(buildHistoricalCampaignProjectionCatalogQuery(input)))[0],
        );
        releaseRead();
        await writeDone;
        const afterLegacy = asCatalog(
          (await tx.$queryRaw<Array<Record<string, unknown>>>(buildHistoricalCampaignCatalogQuery(input)))[0],
        );
        const afterProjection = asCatalog(
          (await tx.$queryRaw<Array<Record<string, unknown>>>(buildHistoricalCampaignProjectionCatalogQuery(input)))[0],
        );
        return { beforeLegacy, beforeProjection, afterLegacy, afterProjection };
      }, 20_000);
      await pending;
      assert.deepEqual(seen.beforeProjection, seen.beforeLegacy);
      assert.deepEqual(seen.afterLegacy, seen.beforeLegacy);
      assert.deepEqual(seen.afterProjection, seen.beforeLegacy);
      assert.equal(labelsOf(seen.afterProjection).includes("Only July"), true);
      assert.equal(labelsOf(seen.afterProjection).includes("During Read"), false);

      const committed = await assertSame(input);
      assert.equal(labelsOf(committed).includes("During Read"), true);
      assert.equal(labelsOf(committed).includes("Only July"), false);
    } finally {
      releaseRead();
      await pending.catch(() => undefined);
      await writer.sourceLeadEvent.update({
        where: { id: `${PREFIX}-evt-only` },
        data: { sourceCampaignName: "Only July" },
      }).catch(() => undefined);
      await writer.$disconnect();
    }
    const restored = await assertSame(input);
    assert.equal(labelsOf(restored).includes("Only July"), true);
    assert.equal(labelsOf(restored).includes("During Read"), false);
  });

  it("selects the path from an explicit ready flag and does not fall back", async () => {
    await setReady(false);
    const legacy = await runHistoricalCampaignCatalog(db, { lotKey: VET, pageSize: 50 });
    await setReady(true);
    const projection = await runHistoricalCampaignCatalog(db, { lotKey: VET, pageSize: 50 });
    assert.deepEqual(serviceView(projection), serviceView(legacy));
    await setReady(false);

    await db.$executeRawUnsafe(
      `ALTER TABLE "SourceLeadEvent" DISABLE TRIGGER historical_catalog_projection_event_refresh`,
    );
    try {
      await db.sourceLeadEvent.update({
        where: { id: `${PREFIX}-evt-only` },
        data: { sourceCampaignName: "Diverged July" },
      });
      await setReady(false);
      const legacyDiverged = await runHistoricalCampaignCatalog(db, { lotKey: VET, pageSize: 50 });
      assert.equal(legacyDiverged.campaigns.some((campaign) => campaign.normalizedLabel === "Diverged July"), true);
      assert.equal(legacyDiverged.campaigns.some((campaign) => campaign.normalizedLabel === "Only July"), false);
      await setReady(true);
      const projectionStale = await runHistoricalCampaignCatalog(db, { lotKey: VET, pageSize: 50 });
      assert.equal(projectionStale.campaigns.some((campaign) => campaign.normalizedLabel === "Only July"), true);
      assert.equal(projectionStale.campaigns.some((campaign) => campaign.normalizedLabel === "Diverged July"), false);
      assert.notDeepEqual(serviceView(projectionStale), serviceView(legacyDiverged));

      const stalePreview = await runHistoricalOwnershipPreview(db, {
        campaigns: [{ lotKey: VET, importRequest: IMP_A, normalizedLabel: "Only July", originClientAccountId: CLIENT_A }],
      });
      const livePreview = await runHistoricalOwnershipPreview(db, {
        campaigns: [{
          lotKey: VET,
          importRequest: IMP_A,
          normalizedLabel: "Diverged July",
          originClientAccountId: CLIENT_A,
        }],
      });
      assert.equal(stalePreview.proposals[0]?.inventoryRows, 0);
      assert.equal(livePreview.proposals[0]?.inventoryRows, 1);
      assert.equal(stalePreview.registryRowsWritten, false);
      assert.equal(livePreview.inventoryRowsWritten, false);
    } finally {
      await db.$executeRawUnsafe(
        `ALTER TABLE "SourceLeadEvent" ENABLE TRIGGER historical_catalog_projection_event_refresh`,
      );
      await db.sourceLeadEvent.update({
        where: { id: `${PREFIX}-evt-only` },
        data: { sourceCampaignName: "Only July" },
      });
      await setReady(false);
    }
    const converged = await assertSame(request({ lotKey: VET, importRequest: null }));
    assert.equal(labelsOf(converged).includes("Only July"), true);

    await db.historicalCatalogProjectionControl.delete({ where: { singleton: true } });
    try {
      await assert.rejects(
        () => runHistoricalCampaignCatalog(db, { lotKey: VET, pageSize: 5 }),
        (error: unknown) =>
          error instanceof HistoricalOwnershipPreviewError && error.failureCode === "snapshot_failed",
      );
    } finally {
      await restoreControl();
    }

    await setReady(true);
    await db.$executeRawUnsafe(`ALTER TABLE historical_catalog_projection RENAME TO ${HIDDEN_PROJECTION}`);
    try {
      await assert.rejects(
        () => runHistoricalCampaignCatalog(db, { lotKey: VET, pageSize: 5 }),
        (error: unknown) =>
          error instanceof HistoricalOwnershipPreviewError && error.failureCode === "snapshot_failed",
      );
    } finally {
      await restoreProjectionName();
      await setReady(false);
    }

    const control = await db.historicalCatalogProjectionControl.findUniqueOrThrow({ where: { singleton: true } });
    assert.equal(control.ready, false);
    const recovered = await runHistoricalCampaignCatalog(db, { lotKey: VET, pageSize: 5 });
    assert.equal(recovered.totalCampaigns, 7);
  });

  it("records local plans for a fat payload fixture", { timeout: 180_000 }, async () => {
    const benchLot = await db.inventoryLot.create({
      data: {
        lotKey: BENCH_LOT,
        displayName: "Gate 5 bench",
        sourceProvider: "manual_import",
        sourceLane: PREFIX,
        nicheKey: "vet",
        inventoryClass: "aged",
        status: "active",
      },
    });
    try {
      await db.$executeRaw`
        INSERT INTO "SourceLeadEvent" (
          id, "sourceProvider", "sourceSystem", "sourceType", status, "sourceCampaignName",
          "rawPayloadJson", "normalizedPayloadJson", "receivedAt", "createdAt", "updatedAt"
        )
        SELECT
          ${`${PREFIX}-bench-evt-`} || lpad(g::text, 6, '0'),
          'manual_import'::"SourceLeadProvider",
          'csv_import'::"SourceLeadSystem",
          'bulk_import'::"SourceLeadType",
          'approved'::"SourceLeadEventStatus",
          'Bench Vet',
          jsonb_build_object(
            'importRequestId', ${BENCH_IMPORT},
            'pad', 'GATE5PAD' || repeat('x', 20000)
          ),
          jsonb_build_object('campaign_name', 'Bench Vet'),
          now(), now(), now()
        FROM generate_series(1, ${BENCH_ROWS}) AS g
      `;
      await db.$executeRaw`
        INSERT INTO "LeadInventoryItem" (
          id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey",
          "sourceProvider", "sourceLane", "inventoryClass", status, "availableAt", "createdAt", "updatedAt"
        )
        SELECT
          ${`${PREFIX}-bench-item-`} || lpad(g::text, 6, '0'),
          ${benchLot.id},
          ${`${PREFIX}-bench-evt-`} || lpad(g::text, 6, '0'),
          TIMESTAMPTZ '2026-01-15T00:00:00Z',
          'GA',
          'vet',
          'manual_import'::"SourceLeadProvider",
          ${PREFIX},
          'aged'::"LeadInventoryClass",
          'available'::"LeadInventoryItemStatus",
          TIMESTAMPTZ '2026-02-01T00:00:00Z',
          now(), now()
        FROM generate_series(1, ${BENCH_ROWS}) AS g
      `;
      await db.$executeRaw`
        INSERT INTO historical_catalog_projection (
          item_id, lot_key, import_request, niche_key, item_status, label_agreement, refreshed_at
        )
        SELECT
          ${`${PREFIX}-ballast-`} || lpad(g::text, 6, '0'),
          ${`${PREFIX}-ballast-lot-`} || ((g % 80) + 1)::text,
          ${`${PREFIX}-imp-ballast`},
          'vet',
          'available',
          'all_missing',
          clock_timestamp()
        FROM generate_series(1, ${BALLAST_ROWS}) AS g
      `;
      await db.$executeRawUnsafe(`ANALYZE historical_catalog_projection`);
      await db.$executeRawUnsafe(`ANALYZE "SourceLeadEvent"`);
      await db.$executeRawUnsafe(`ANALYZE "LeadInventoryItem"`);

      const input = request({ lotKey: BENCH_LOT, importRequest: null, pageSize: 25 });
      const compared = await assertSame(input);
      assert.equal(compared.total_campaigns, 1);
      assert.equal(compared.scope_inventory_rows, BENCH_ROWS);
      assert.equal(compared.campaigns[0]?.inventoryRows, BENCH_ROWS);
      assert.equal(compared.campaigns[0]?.normalizedLabel, "Bench Vet");
      assert.equal(JSON.stringify(compared).includes("GATE5PAD"), false);

      async function explain(query: Prisma.Sql, disableSeqScan: boolean): Promise<string> {
        const rows = await db.$transaction(async (tx) => {
          if (disableSeqScan) await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
          return tx.$queryRaw<Array<Record<string, unknown>>>`EXPLAIN (ANALYZE, BUFFERS) ${query}`;
        }, { maxWait: 5_000, timeout: 60_000 });
        return planText(rows);
      }

      const legacyQuery = buildHistoricalCampaignCatalogQuery(input);
      const projectionQuery = buildHistoricalCampaignProjectionCatalogQuery(input);
      await explain(legacyQuery, false);
      await explain(projectionQuery, false);
      const legacyPlan = await explain(legacyQuery, false);
      const projectionPlan = await explain(projectionQuery, false);
      const projectionIndexPlan = await explain(projectionQuery, true);
      const directIndexPlan = await explain(
        Prisma.sql`SELECT item_id FROM historical_catalog_projection WHERE lot_key = ${BENCH_LOT}`,
        false,
      );
      assert.equal(
        projectionPlan.includes("SourceLeadEvent"),
        false,
        projectionPlan.slice(0, 500),
      );
      assert.equal(projectionPlan.includes("rawPayloadJson"), false);
      assert.equal(legacyPlan.includes("SourceLeadEvent"), true, legacyPlan.slice(0, 500));
      assert.equal(
        projectionIndexPlan.includes(LOT_INDEX) || directIndexPlan.includes(LOT_INDEX),
        true,
        `${projectionIndexPlan.slice(0, 600)}\n---\n${directIndexPlan.slice(0, 600)}`,
      );

      await setReady(false);
      await runHistoricalCampaignCatalog(db, { lotKey: BENCH_LOT, pageSize: 25 });
      const legacyStarted = Date.now();
      const legacyService = await runHistoricalCampaignCatalog(db, { lotKey: BENCH_LOT, pageSize: 25 });
      const legacyServiceMs = Date.now() - legacyStarted;
      await setReady(true);
      await runHistoricalCampaignCatalog(db, { lotKey: BENCH_LOT, pageSize: 25 });
      const projectionStarted = Date.now();
      const projectionService = await runHistoricalCampaignCatalog(db, { lotKey: BENCH_LOT, pageSize: 25 });
      const projectionServiceMs = Date.now() - projectionStarted;
      assert.deepEqual(serviceView(projectionService), serviceView(legacyService));
      assert.equal(JSON.stringify(projectionService).includes("GATE5PAD"), false);

      const artifact = {
        fixture: {
          benchRows: BENCH_ROWS,
          payloadPadBytes: 20_000,
          ballastProjectionRows: BALLAST_ROWS,
          note: "Local fixture only. These timings do not predict production latency.",
        },
        equivalence: {
          totalCampaigns: compared.total_campaigns,
          inventoryRows: compared.campaigns[0]?.inventoryRows,
          serviceContractsMatch: true,
        },
        serviceMs: { legacy: legacyServiceMs, projection: projectionServiceMs },
        legacy: { executionMs: executionMs(legacyPlan), buffers: bufferSums(legacyPlan), plan: legacyPlan },
        projection: {
          executionMs: executionMs(projectionPlan),
          buffers: bufferSums(projectionPlan),
          usesLotIndex: projectionPlan.includes(LOT_INDEX),
          plan: projectionPlan,
        },
        projectionSeqScanDisabled: {
          executionMs: executionMs(projectionIndexPlan),
          buffers: bufferSums(projectionIndexPlan),
          usesLotIndex: projectionIndexPlan.includes(LOT_INDEX),
          plan: projectionIndexPlan,
        },
        directLotLookup: {
          executionMs: executionMs(directIndexPlan),
          buffers: bufferSums(directIndexPlan),
          usesLotIndex: directIndexPlan.includes(LOT_INDEX),
          plan: directIndexPlan,
        },
      };
      mkdirSync("/opt/cursor/artifacts", { recursive: true });
      writeFileSync("/opt/cursor/artifacts/gate5-local-plan.json", `${JSON.stringify(artifact, null, 2)}\n`);
      assert.equal(
        artifact.projection.usesLotIndex || artifact.projectionSeqScanDisabled.usesLotIndex,
        true,
        projectionIndexPlan.slice(0, 700),
      );
      assert.equal(typeof artifact.legacy.executionMs, "number");
      assert.equal(typeof artifact.projection.executionMs, "number");
    } finally {
      await setReady(false);
      await db.leadInventoryItem.deleteMany({ where: { id: { startsWith: `${PREFIX}-bench-` } } });
      await db.sourceLeadEvent.deleteMany({ where: { id: { startsWith: `${PREFIX}-bench-` } } });
      await db.inventoryLot.deleteMany({ where: { lotKey: BENCH_LOT } });
      await db.$executeRaw`DELETE FROM historical_catalog_projection WHERE item_id LIKE ${`${PREFIX}-ballast-%`}`;
    }
  });
});
