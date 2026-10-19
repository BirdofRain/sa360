import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  assertAuditReportOmitsContact,
  assertHistoricalCampaignAuditSqlSafe,
  classifyStoredCampaignLabels,
  decideHistoricalCampaignRepair,
  HISTORICAL_CAMPAIGN_AUDIT_CONFIRMATION,
  JR_LAIRD_TRUCKER_CAMPAIGN_LABEL,
  runHistoricalTruckerCampaignAudit,
  summarizeJulyLabelCollisions,
  withReadOnlyTransaction,
} from "./historical-trucker-campaign-audit.js";

const SECRET_PHONE = "+19995550123";
const SECRET_EMAIL = "htc-secret@example.test";
const LOT_KEY = "lot_aged_bulk_trucker_abc123def456";
const IMPORT_REQUEST_ID = "aged-bulk-trucker-abc123def456";
const FILE_SHA = "abc123def456ffffffffffffffffffffffffffffffffffffffffffffffff";
const integrationUrl =
  process.env.SA360_TEST_DATABASE_URL?.trim() ||
  process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim() ||
  "";

describe("historical trucker campaign audit", () => {
  it("keeps audit SQL select-only and free of contact columns", () => {
    assertHistoricalCampaignAuditSqlSafe();
    assert.equal(HISTORICAL_CAMPAIGN_AUDIT_CONFIRMATION, "READ ONLY HISTORICAL CAMPAIGN AUDIT");
  });

  it("treats the July column as identity and a later raw lead type as a conflict", () => {
    assert.deepEqual(
      classifyStoredCampaignLabels({
        sourceCampaignName: " JR Laird - Trucker - 3/4/26 ",
        normalizedCampaignName: JR_LAIRD_TRUCKER_CAMPAIGN_LABEL,
        rawLeadType: null,
      }),
      {
        agreement: "july_column_agrees",
        julyLabel: JR_LAIRD_TRUCKER_CAMPAIGN_LABEL,
        conflictFields: [],
      }
    );
    const conflict = classifyStoredCampaignLabels({
      sourceCampaignName: JR_LAIRD_TRUCKER_CAMPAIGN_LABEL,
      normalizedCampaignName: JR_LAIRD_TRUCKER_CAMPAIGN_LABEL,
      rawLeadType: "Later Workbook Label",
    });
    assert.equal(conflict.agreement, "july_column_conflicts");
    assert.deepEqual(conflict.conflictFields, ["rawPayloadJson.master.lead_type"]);
    assert.equal(
      classifyStoredCampaignLabels({
        sourceCampaignName: null,
        normalizedCampaignName: "Filled Later",
        rawLeadType: "Filled Later",
      }).agreement,
      "post_july_label_without_column"
    );
    assert.equal(
      classifyStoredCampaignLabels({
        sourceCampaignName: "  ",
        normalizedCampaignName: "",
        rawLeadType: null,
      }).agreement,
      "all_missing"
    );
  });

  it("counts source ids that store more than one July label", () => {
    const collisions = summarizeJulyLabelCollisions({
      lotRows: [
        { sourceLeadId: "aged-v1-trucker-same", julyLabel: "Camp A" },
        { sourceLeadId: "aged-v1-trucker-same", julyLabel: "Camp B" },
        { sourceLeadId: "aged-v1-trucker-one", julyLabel: "Camp A" },
      ],
      outsideRows: [{ sourceLeadId: "aged-v1-trucker-one", sourceCampaignName: "Outside Camp" }],
    });
    assert.equal(collisions.duplicateSourceLeadIdsInsideLot, 1);
    assert.equal(collisions.sourceLeadIdsWithDisagreeingJulyLabels, 1);
    assert.equal(collisions.outsideEventsWithDifferentJulyLabel, 1);
    assert.equal(collisions.undetectableDroppedDuplicates, true);
  });

  it("allows a later repair only when a remote read shows consistent July labels", () => {
    const clean = decideHistoricalCampaignRepair({
      localDatabase: false,
      lotFound: true,
      focusRows: [{ agreement: "july_column_only" }, { agreement: "july_column_agrees" }] as never,
      collisions: {
        duplicateSourceLeadIdsInsideLot: 0,
        sourceLeadIdsWithDisagreeingJulyLabels: 0,
        sourceLeadIdsAlsoOutsideLot: 0,
        outsideEventsWithDifferentJulyLabel: 0,
        undetectableDroppedDuplicates: true,
      },
    });
    assert.equal(clean.code, "conditional_go_labels_only");
    assert.equal(clean.fulfillFocusCohort, "no_go");
    assert.equal(clean.repairWithoutReimport, "conditional_after_operator_confirmation");

    const conflict = decideHistoricalCampaignRepair({
      localDatabase: false,
      lotFound: true,
      focusRows: [{ agreement: "july_column_conflicts" }] as never,
      collisions: {
        duplicateSourceLeadIdsInsideLot: 0,
        sourceLeadIdsWithDisagreeingJulyLabels: 0,
        sourceLeadIdsAlsoOutsideLot: 0,
        outsideEventsWithDifferentJulyLabel: 0,
        undetectableDroppedDuplicates: true,
      },
    });
    assert.equal(conflict.code, "no_go_labels_incomplete_or_conflicting");
    assert.equal(conflict.repairWithoutReimport, "no_go");
  });

  it("refuses a repair decision from a local database even when labels agree", () => {
    const decision = decideHistoricalCampaignRepair({
      localDatabase: true,
      lotFound: true,
      focusRows: [],
      collisions: {
        duplicateSourceLeadIdsInsideLot: 0,
        sourceLeadIdsWithDisagreeingJulyLabels: 0,
        sourceLeadIdsAlsoOutsideLot: 0,
        outsideEventsWithDifferentJulyLabel: 0,
        undetectableDroppedDuplicates: true,
      },
    });
    assert.equal(decision.code, "no_go_database_not_production");
    assert.equal(decision.fulfillFocusCohort, "no_go");
    assert.equal(decision.repairWithoutReimport, "no_go");
  });
});

describe("historical trucker campaign audit postgres proof", { skip: !integrationUrl }, () => {
  let db: PrismaClient;
  const databaseUrl = integrationUrl;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(databaseUrl);
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanup(db);
    await seed(db);
  });

  after(async () => {
    if (!db) return;
    await cleanup(db);
    await db.$disconnect();
  });

  it("rejects writes inside the read-only transaction", async () => {
    await assert.rejects(
      () =>
        withReadOnlyTransaction(db, async (tx) => {
          await tx.$executeRaw`UPDATE "InventoryLot" SET "displayName" = "displayName" WHERE "lotKey" = ${LOT_KEY}`;
        }),
      /read-only|read_only/i
    );
  });

  it("aggregates July labels, conflicts, and one JR Laird identity without contact", async () => {
    const report = await runHistoricalTruckerCampaignAudit(db, {
      databaseUrl,
      lotKey: LOT_KEY,
      importRequestId: IMPORT_REQUEST_ID,
      exampleCampaignLabel: JR_LAIRD_TRUCKER_CAMPAIGN_LABEL,
    });
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes(SECRET_PHONE), false);
    assert.equal(serialized.includes(SECRET_EMAIL), false);
    assert.equal(serialized.includes(FILE_SHA), false);
    assertAuditReportOmitsContact(report);
    assert.equal(report.substitutesProduction, false);
    assert.equal(report.database.localDatabase, true);
    assert.equal(report.database.transactionReadOnly, true);
    assert.equal(report.decision.code, "no_go_database_not_production");
    assert.equal(report.decision.fulfillFocusCohort, "no_go");
    assert.equal(report.lot.found, true);
    assert.equal(report.lot.inventoryRows, 6);
    assert.equal(report.focusGaAvailableTrucker.rows, 5);
    assert.equal(report.focusGaAvailableTrucker.originNull, 4);
    assert.equal(report.focusGaAvailableTrucker.originStamped, 1);
    assert.deepEqual(report.focusGaAvailableTrucker.distinctOriginClientAccountIds, ["client_htc_laird"]);
    assert.equal(report.focusGaAvailableTrucker.commerceExcluded, 1);
    assert.equal(report.focusGaAvailableTrucker.openAllocation, 1);
    assert.equal(report.focusGaAvailableTrucker.enriched, 1);
    assert.equal(report.inventory.importRequest.rawMatchesScope, 5);
    assert.equal(report.inventory.importRequest.rawOther, 1);
    assert.equal(report.inventory.importRequest.metadataConflictsWithRaw, 1);
    assert.equal(report.labels.agreement.july_column_agrees, 3);
    assert.equal(report.labels.agreement.july_column_conflicts, 2);
    assert.equal(report.labels.agreement.all_missing, 1);
    assert.equal(report.collisions.duplicateSourceLeadIdsInsideLot, 1);
    assert.equal(report.collisions.sourceLeadIdsWithDisagreeingJulyLabels, 1);
    assert.equal(report.collisions.outsideEventsWithDifferentJulyLabel, 1);
    assert.equal(report.exampleCampaign.julyColumnMatches, 2);
    assert.equal(report.exampleCampaign.julyColumnMatchesInFocus, 2);
    assert.equal(report.exampleCampaign.normalizedCampaignNameMatches, 1);
    assert.equal(report.exampleCampaign.rawLeadTypeMatches, 0);
    assert.equal(report.exampleCampaign.representative?.sourceLeadEventId, "htc-evt-01");
    assert.equal(report.exampleCampaign.representative?.sourceLeadId, "aged-v1-trucker-aaa");
    assert.equal(report.exampleCampaign.representative?.sourceLeadUid, "manualimport-aged_inventory_csv-aged-v1-trucker-aaa");
    assert.equal(report.exampleCampaign.representative?.rowNumber, 41);
    assert.equal(report.exampleCampaign.representative?.agreement, "july_column_agrees");
    assert.equal(report.exampleCampaign.representative?.originClientAccountId, null);
    assert.equal(report.snapshot.recorded?.fileSha256PrefixMatchesLotSuffix, true);
    assert.equal(report.snapshot.recorded?.sourceFormat, "trucker_master_v1");
    assert.equal(report.clientNameCandidatesAreNotOwnership, true);
    assert.equal(
      report.clientNameCandidates.some((row) => row.clientAccountId === "client_htc_laird"),
      true
    );
    const jr = report.labels.byJulyColumn.find((row) => row.label === JR_LAIRD_TRUCKER_CAMPAIGN_LABEL);
    assert.equal(jr?.rows, 2);
    assert.equal(jr?.focusRows, 2);
  });
});

async function seed(db: PrismaClient) {
  const secretPayload = {
    firstName: "Secret",
    lastName: "Person",
    email: SECRET_EMAIL,
    phone_e164: SECRET_PHONE,
    campaign_name: JR_LAIRD_TRUCKER_CAMPAIGN_LABEL,
    contact: { phone_e164: SECRET_PHONE, email: SECRET_EMAIL },
  };
  await db.clientAccount.create({
    data: {
      clientAccountId: "client_htc_laird",
      clientDisplayName: "JR Laird Test Client",
      status: "active",
      portalEnabled: false,
    },
  });
  await db.inventoryLot.create({
    data: {
      id: "htc-lot",
      lotKey: LOT_KEY,
      displayName: "Historical trucker audit fixture",
      sourceProvider: "manual_import",
      sourceLane: "aged_inventory_bulk_csv",
      nicheKey: "trucker",
      inventoryClass: "aged",
      exclusivityMode: "exclusive",
      status: "active",
    },
  });
  await db.inventoryLot.create({
    data: {
      id: "htc-lot-outside",
      lotKey: "lot_htc_outside",
      displayName: "Outside lot",
      sourceProvider: "manual_import",
      sourceLane: "aged_inventory_bulk_csv",
      nicheKey: "trucker",
      inventoryClass: "aged",
      exclusivityMode: "exclusive",
      status: "active",
    },
  });
  await db.agedInventorySourceSnapshot.create({
    data: {
      fileSha256: FILE_SHA,
      fileName: "master.csv",
      sourceFormat: "trucker_master_v1",
      defaultNicheKey: "trucker",
      sourceLane: "aged_inventory_bulk_csv",
      status: "completed",
      lotKey: LOT_KEY,
      inventoryLotId: "htc-lot",
      importRequestId: IMPORT_REQUEST_ID,
      importedRows: 6,
      acceptedRows: 6,
      totalSourceRows: 6,
    },
  });

  await createPair(db, {
    eventId: "htc-evt-01",
    itemId: "htc-item-01",
    lotId: "htc-lot",
    sourceLeadId: "aged-v1-trucker-aaa",
    campaign: JR_LAIRD_TRUCKER_CAMPAIGN_LABEL,
    normalizedCampaign: JR_LAIRD_TRUCKER_CAMPAIGN_LABEL,
    rawLeadType: null,
    importRequestId: IMPORT_REQUEST_ID,
    metadataImportRequestId: IMPORT_REQUEST_ID,
    rowNumber: 41,
    state: "GA",
    status: "available",
    origin: null,
    enriched: false,
    payload: secretPayload,
  });
  await createPair(db, {
    eventId: "htc-evt-02",
    itemId: "htc-item-02",
    lotId: "htc-lot",
    sourceLeadId: "aged-v1-trucker-bbb",
    campaign: "Other Agent - Trucker",
    normalizedCampaign: "Other Agent - Trucker",
    rawLeadType: "Later Workbook Label",
    importRequestId: IMPORT_REQUEST_ID,
    metadataImportRequestId: IMPORT_REQUEST_ID,
    rowNumber: 42,
    state: "GA",
    status: "available",
    origin: null,
    enriched: true,
    commerceExcluded: true,
    payload: { campaign_name: "Other Agent - Trucker", phone_e164: SECRET_PHONE },
  });
  await createPair(db, {
    eventId: "htc-evt-03",
    itemId: "htc-item-03",
    lotId: "htc-lot",
    sourceLeadId: "aged-v1-trucker-ccc",
    campaign: null,
    normalizedCampaign: null,
    rawLeadType: null,
    importRequestId: "other-request",
    metadataImportRequestId: IMPORT_REQUEST_ID,
    rowNumber: 43,
    state: "FL",
    status: "pending_review",
    origin: null,
    enriched: false,
    payload: { phone_e164: SECRET_PHONE },
  });
  await createPair(db, {
    eventId: "htc-evt-04a",
    itemId: "htc-item-04a",
    lotId: "htc-lot",
    sourceLeadId: "aged-v1-trucker-ddd",
    campaign: "Camp A",
    normalizedCampaign: "Camp A",
    rawLeadType: null,
    importRequestId: IMPORT_REQUEST_ID,
    metadataImportRequestId: IMPORT_REQUEST_ID,
    rowNumber: 44,
    state: "GA",
    status: "available",
    origin: "client_htc_laird",
    enriched: false,
    payload: { campaign_name: "Camp A" },
  });
  await createPair(db, {
    eventId: "htc-evt-04b",
    itemId: "htc-item-04b",
    lotId: "htc-lot",
    sourceLeadId: "aged-v1-trucker-ddd",
    campaign: "Camp B",
    normalizedCampaign: "Camp B",
    rawLeadType: null,
    importRequestId: IMPORT_REQUEST_ID,
    metadataImportRequestId: IMPORT_REQUEST_ID,
    rowNumber: 45,
    state: "GA",
    status: "available",
    origin: null,
    enriched: false,
    payload: { campaign_name: "Camp B" },
  });
  await createPair(db, {
    eventId: "htc-evt-05",
    itemId: "htc-item-05",
    lotId: "htc-lot",
    sourceLeadId: "aged-v1-trucker-eee",
    campaign: JR_LAIRD_TRUCKER_CAMPAIGN_LABEL,
    normalizedCampaign: "JR Laird - Trucker - 3/5/26",
    rawLeadType: null,
    importRequestId: IMPORT_REQUEST_ID,
    metadataImportRequestId: IMPORT_REQUEST_ID,
    rowNumber: 46,
    state: "GA",
    status: "available",
    origin: null,
    enriched: false,
    payload: { campaign_name: "JR Laird - Trucker - 3/5/26", email: SECRET_EMAIL },
  });
  await createPair(db, {
    eventId: "htc-evt-out",
    itemId: "htc-item-out",
    lotId: "htc-lot-outside",
    sourceLeadId: "aged-v1-trucker-aaa",
    campaign: "Outside Campaign",
    normalizedCampaign: "Outside Campaign",
    rawLeadType: null,
    importRequestId: "outside-request",
    metadataImportRequestId: "outside-request",
    rowNumber: 7,
    state: "GA",
    status: "available",
    origin: null,
    enriched: false,
    payload: { campaign_name: "Outside Campaign" },
  });

  await db.leadOrder.create({
    data: {
      id: "htc-order",
      orderNumber: "HTC-AUDIT-1",
      clientAccountId: "client_htc_laird",
      nicheKey: "trucker",
      leadVolume: 1,
      campaignType: "aged",
      crmPackage: "none",
      createdByRole: "system",
      status: "active",
    },
  });
  await db.leadAllocation.create({
    data: {
      id: "htc-alloc",
      sourceLeadEventId: "htc-evt-02",
      leadOrderId: "htc-order",
      leadInventoryItemId: "htc-item-02",
      clientAccountId: "client_htc_laird",
      status: "reserved",
      allocationPolicyVersion: "test",
      idempotencyKey: "htc-audit-alloc",
    },
  });
}

async function createPair(
  db: PrismaClient,
  input: {
    eventId: string;
    itemId: string;
    lotId: string;
    sourceLeadId: string;
    campaign: string | null;
    normalizedCampaign: string | null;
    rawLeadType: string | null;
    importRequestId: string;
    metadataImportRequestId: string;
    rowNumber: number;
    state: string;
    status: "available" | "pending_review";
    origin: string | null;
    enriched: boolean;
    commerceExcluded?: boolean;
    payload: Record<string, unknown>;
  }
) {
  const raw: Record<string, unknown> = {
    importRequestId: input.importRequestId,
    rowNumber: input.rowNumber,
  };
  if (input.rawLeadType) {
    raw.master = { lead_type: input.rawLeadType, source_format: "trucker_master_v1" };
  }
  await db.sourceLeadEvent.create({
    data: {
      id: input.eventId,
      sourceProvider: "manual_import",
      sourceSystem: "csv_import",
      sourceType: "bulk_import",
      sourceRouteKey: `AGED_BULK::${LOT_KEY}`,
      sourceCampaignName: input.campaign,
      sourceLeadId: input.sourceLeadId,
      sourceLeadUid: `manualimport-aged_inventory_csv-${input.sourceLeadId}`,
      status: "normalized",
      rawPayloadJson: raw,
      normalizedPayloadJson: {
        ...input.payload,
        campaign_name: input.normalizedCampaign,
      },
      enrichmentMetadataJson: input.enriched
        ? { historicalEnrichment: { kind: "aged_master_enrichment_v1" } }
        : { sourceLane: "aged_inventory_bulk_csv" },
    },
  });
  await db.leadInventoryItem.create({
    data: {
      id: input.itemId,
      inventoryLotId: input.lotId,
      sourceLeadEventId: input.eventId,
      generatedAt: new Date("2026-03-04T00:00:00.000Z"),
      normalizedState: input.state,
      nicheKey: "trucker",
      sourceProvider: "manual_import",
      sourceLane: "aged_inventory_bulk_csv",
      inventoryClass: "aged",
      exclusivityMode: "exclusive",
      status: input.status,
      availableAt: input.status === "available" ? new Date("2026-08-01T00:00:00.000Z") : null,
      originClientAccountId: input.origin,
      commerceExcludedAt: input.commerceExcluded ? new Date("2026-08-02T00:00:00.000Z") : null,
      commerceExcludedReason: input.commerceExcluded ? "test_exclusion" : null,
      metadataJson: {
        importRequestId: input.metadataImportRequestId,
        rowNumber: input.rowNumber,
        campaignNamePresent: Boolean(input.campaign),
      },
    },
  });
}

async function cleanup(db: PrismaClient) {
  await db.leadAllocation.deleteMany({ where: { id: { startsWith: "htc-" } } });
  await db.leadOrder.deleteMany({ where: { id: { startsWith: "htc-" } } });
  await db.leadInventoryItem.deleteMany({ where: { id: { startsWith: "htc-" } } });
  await db.sourceLeadEvent.deleteMany({ where: { id: { startsWith: "htc-" } } });
  await db.agedInventorySourceSnapshot.deleteMany({ where: { lotKey: LOT_KEY } });
  await db.inventoryLot.deleteMany({ where: { id: { in: ["htc-lot", "htc-lot-outside"] } } });
  await db.clientAccount.deleteMany({ where: { clientAccountId: "client_htc_laird" } });
}
