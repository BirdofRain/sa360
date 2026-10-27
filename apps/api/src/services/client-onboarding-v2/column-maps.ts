/**
 * Versioned column maps on the existing ClientSheetColumnMap table.
 * Drafts are not used by the writer. Publishing does not call Google and
 * does not rewrite headers or historical rows. v1/v2/v3 bindings stay in
 * place until this client explicitly selects another tab or publishes a map
 * for the selected worksheet.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2,
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
  companySheetsCampaignHeader,
} from "../../lib/company-google-sheets-env.js";
import { parseGoogleSpreadsheetRef } from "../../lib/google-spreadsheet-ref.js";
import {
  applyOperatorAssignments,
  columnMapContentKey,
  columnMapIssues,
  COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
  CUSTOM_APPEND_CONTRACT,
  customRowValues,
  exactHeader,
  headerFingerprint,
  isCustomSheetsWriterEnabled,
  mappableColumnTargets,
  publishBlocker,
  sourceFunnelIdFromLead,
  suggestColumnAssignments,
  syntheticCustomCampaignLead,
  type ColumnAssignment,
} from "../company-sheets-delivery/company-sheets-custom-row.js";
import { previewOnboardingSpreadsheet, type OnboardingSheetClassification } from "./sheet-preview.js";

type MapDb = PrismaClient | Prisma.TransactionClient;

export type ColumnMapFailure = { ok: false; statusCode: number; error: string; detail?: string };

export type ExistingWorksheetSnapshot = {
  spreadsheetId: string;
  spreadsheetTitle: string;
  worksheetId: number;
  worksheetTitle: string;
  header: string[];
  sampleRow: string[];
  classification: OnboardingSheetClassification;
  historicalDataRows: "empty" | "has_rows" | "truncated";
};

const PAUSED_DETAIL = "Pause campaign Sheets delivery before changing the target or the column map.";

export async function readExistingWorksheetSnapshot(
  clientAccountId: string,
  spreadsheetId: string,
  worksheetId: number
): Promise<{ ok: true; snapshot: ExistingWorksheetSnapshot } | ColumnMapFailure> {
  const preview = await previewOnboardingSpreadsheet(clientAccountId, { spreadsheetId, worksheetId });
  if (!preview.ok) return { ok: false, statusCode: preview.statusCode, error: preview.code };
  const sheet = preview.worksheets.find((item) => item.worksheetId === worksheetId);
  if (!sheet) return { ok: false, statusCode: 404, error: "worksheet_unavailable", detail: "That worksheet gid was not on the spreadsheet." };
  return {
    ok: true,
    snapshot: {
      spreadsheetId: preview.spreadsheetId,
      spreadsheetTitle: preview.spreadsheetTitle,
      worksheetId: sheet.worksheetId,
      worksheetTitle: sheet.title,
      header: sheet.header,
      sampleRow: sheet.sampleRow,
      classification: sheet.classification,
      historicalDataRows: sheet.historicalDataRows,
    },
  };
}

export async function listColumnMaps(
  clientAccountId: string,
  worksheetId: number | null,
  db: PrismaClient = prisma
): Promise<{ ok: true; maps: ReturnType<typeof presentMap>[] } | ColumnMapFailure> {
  const client = await db.clientAccount.findUnique({ where: { clientAccountId }, select: { clientAccountId: true } });
  if (!client) return { ok: false, statusCode: 404, error: "client_not_found" };
  const rows = await db.clientSheetColumnMap.findMany({
    where: {
      clientAccountId,
      status: { in: ["draft", "published"] },
      ...(worksheetId == null ? {} : { worksheetId }),
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  return { ok: true, maps: rows.map((row) => presentMap(row)) };
}

export async function createColumnMapDraft(
  input: {
    clientAccountId: string;
    requestId: string;
    spreadsheetId: string;
    worksheetId: number;
    sourceScope: string;
    baseSchemaVersion: string;
    actorLabel?: string | null;
    snapshot: ExistingWorksheetSnapshot;
  },
  db: PrismaClient = prisma
): Promise<{ ok: true; map: ReturnType<typeof presentMap> } | ColumnMapFailure> {
  const replay = await replayRequest(db, input.clientAccountId, input.requestId);
  if (replay) return replay;
  const scope = await resolveScope(db, input.clientAccountId, input.sourceScope);
  if (!scope.ok) return scope;
  const parsed = parseGoogleSpreadsheetRef(input.spreadsheetId);
  if (!parsed.ok || parsed.spreadsheetId !== input.snapshot.spreadsheetId || input.worksheetId !== input.snapshot.worksheetId) {
    return { ok: false, statusCode: 409, error: "header_changed", detail: "The worksheet read does not match the requested spreadsheet and gid." };
  }
  if (input.baseSchemaVersion === COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 && input.snapshot.classification === "v3_exact_header") {
    return { ok: false, statusCode: 422, error: "use_existing_v3_bind", detail: "An exact v3 header uses the existing bind. A custom map was not created." };
  }
  if (input.baseSchemaVersion !== "legacy_custom") {
    return { ok: false, statusCode: 422, error: "use_existing_v3_bind", detail: "Custom maps use baseSchemaVersion legacy_custom." };
  }
  const refused = refuseUnmappable(input.snapshot);
  if (refused) return refused;
  if (input.snapshot.header.some((cell) => cell.trim().length === 0 || cell.length > 200)) {
    return {
      ok: false,
      statusCode: 422,
      error: "blank_header",
      detail: "A blank header cannot be stored on the column map. The sheet was not changed.",
    };
  }
  const destination = await db.companySheetsDestination.findUnique({ where: { clientAccountId: input.clientAccountId } });
  if (!destination) return { ok: false, statusCode: 409, error: "destination_not_configured" };
  const paused = assertPaused(destination.campaignDispatchEnabled);
  if (paused) return paused;
  const before = switchSnapshot(destination);
  const assignments = suggestColumnAssignments(input.snapshot.header, input.snapshot.sampleRow);
  const created = await db.$transaction(async (tx) => {
    const latest = await tx.clientSheetColumnMap.findFirst({
      where: {
        clientAccountId: input.clientAccountId,
        sourceScope: scope.sourceScope,
        spreadsheetId: input.snapshot.spreadsheetId,
        worksheetId: input.snapshot.worksheetId,
      },
      orderBy: { mapVersion: "desc" },
    });
    const row = await tx.clientSheetColumnMap.create({
      data: {
        clientAccountId: input.clientAccountId,
        sourceScope: scope.sourceScope,
        spreadsheetId: input.snapshot.spreadsheetId,
        worksheetId: input.snapshot.worksheetId,
        mapVersion: (latest?.mapVersion ?? 0) + 1,
        status: "draft",
        baseSchemaVersion: "legacy_custom",
        headerSnapshot: input.snapshot.header,
        assignments,
        revision: 1,
      },
    });
    await tx.clientOnboardingV2AuditEvent.create({
      data: audit(input, "column_map_draft", { mapId: row.id, mapVersion: row.mapVersion, headerFingerprint: headerFingerprint(input.snapshot.header) }),
    });
    return row;
  });
  const drifted = await switchesUnchanged(db, input.clientAccountId, before);
  if (drifted) return drifted;
  return { ok: true, map: presentMap(created, input.snapshot.worksheetTitle) };
}

export async function patchColumnMap(
  input: {
    clientAccountId: string;
    mapId: string;
    requestId: string;
    expectedRevision: number;
    assignments: unknown;
    actorLabel?: string | null;
  },
  db: PrismaClient = prisma
): Promise<{ ok: true; map: ReturnType<typeof presentMap> } | ColumnMapFailure> {
  const replay = await replayRequest(db, input.clientAccountId, input.requestId);
  if (replay) return replay;
  const current = await db.clientSheetColumnMap.findFirst({ where: { id: input.mapId, clientAccountId: input.clientAccountId } });
  if (!current) return { ok: false, statusCode: 404, error: "client_not_found", detail: "Column map not found for this client." };
  if (current.status !== "draft") return { ok: false, statusCode: 409, error: "revision_conflict", detail: "Published maps are not edited. Retire the map and create a new draft." };
  if (current.revision !== input.expectedRevision) return { ok: false, statusCode: 409, error: "revision_conflict" };
  const destination = await db.companySheetsDestination.findUnique({ where: { clientAccountId: input.clientAccountId } });
  if (!destination) return { ok: false, statusCode: 409, error: "destination_not_configured" };
  const paused = assertPaused(destination.campaignDispatchEnabled);
  if (paused) return paused;
  const header = stringList(current.headerSnapshot);
  const applied = applyOperatorAssignments(header, sampleFromStored(current.assignments), input.assignments);
  if (!applied.ok) return applied;
  const before = switchSnapshot(destination);
  const updated = await db.clientSheetColumnMap.updateMany({
    where: { id: current.id, clientAccountId: input.clientAccountId, status: "draft", revision: input.expectedRevision },
    data: { assignments: applied.assignments, revision: { increment: 1 } },
  });
  if (updated.count !== 1) return { ok: false, statusCode: 409, error: "revision_conflict" };
  await db.clientOnboardingV2AuditEvent.create({
    data: audit(
      { clientAccountId: input.clientAccountId, requestId: input.requestId, actorLabel: input.actorLabel },
      "column_map_patch",
      { mapId: current.id, revision: input.expectedRevision + 1 }
    ),
  });
  const drifted = await switchesUnchanged(db, input.clientAccountId, before);
  if (drifted) return drifted;
  const row = await db.clientSheetColumnMap.findUniqueOrThrow({ where: { id: current.id } });
  return { ok: true, map: presentMap(row) };
}

export async function publishColumnMap(
  input: {
    clientAccountId: string;
    mapId: string;
    requestId: string;
    expectedRevision: number;
    actorLabel?: string | null;
    snapshot: ExistingWorksheetSnapshot;
  },
  db: PrismaClient = prisma
): Promise<{ ok: true; map: ReturnType<typeof presentMap>; schemaRebound: boolean } | ColumnMapFailure> {
  const replay = await replayRequest(db, input.clientAccountId, input.requestId);
  if (replay) return replay.ok ? { ...replay, schemaRebound: false } : replay;
  const current = await db.clientSheetColumnMap.findFirst({ where: { id: input.mapId, clientAccountId: input.clientAccountId } });
  if (!current) return { ok: false, statusCode: 404, error: "client_not_found", detail: "Column map not found for this client." };
  if (current.status !== "draft") return { ok: false, statusCode: 409, error: "revision_conflict", detail: "Only a draft can be published." };
  if (current.revision !== input.expectedRevision) return { ok: false, statusCode: 409, error: "revision_conflict" };
  if (current.spreadsheetId !== input.snapshot.spreadsheetId || current.worksheetId !== input.snapshot.worksheetId) {
    return { ok: false, statusCode: 409, error: "header_changed", detail: "The live worksheet does not match this map." };
  }
  const header = stringList(current.headerSnapshot);
  if (!exactHeader(input.snapshot.header, header)) {
    return { ok: false, statusCode: 409, error: "header_changed", detail: "The worksheet header changed. Publish was refused and no cells were written." };
  }
  const stored = applyOperatorAssignments(header, input.snapshot.sampleRow, current.assignments);
  if (!stored.ok) return stored;
  const blocked = publishBlocker(stored.assignments);
  if (!blocked.ok) return blocked;
  const destination = await db.companySheetsDestination.findUnique({ where: { clientAccountId: input.clientAccountId } });
  if (!destination) return { ok: false, statusCode: 409, error: "destination_not_configured" };
  const paused = assertPaused(destination.campaignDispatchEnabled);
  if (paused) return paused;
  const owned = await spreadsheetOwner(db, input.snapshot.spreadsheetId, input.clientAccountId);
  if (owned) return owned;
  const before = switchSnapshot(destination);
  let schemaRebound = false;
  try {
    await db.$transaction(async (tx) => {
      const published = await tx.clientSheetColumnMap.findFirst({
        where: {
          clientAccountId: input.clientAccountId,
          sourceScope: current.sourceScope,
          spreadsheetId: current.spreadsheetId,
          worksheetId: current.worksheetId,
          status: "published",
        },
      });
      if (published) {
        throw Object.assign(new Error("published_map_exists"), { code: "published_map_exists" });
      }
      const wrote = await tx.clientSheetColumnMap.updateMany({
        where: { id: current.id, status: "draft", revision: input.expectedRevision },
        data: {
          status: "published",
          assignments: stored.assignments,
          publishedAt: new Date(),
          revision: { increment: 1 },
        },
      });
      if (wrote.count !== 1) throw Object.assign(new Error("revision_conflict"), { code: "revision_conflict" });
      await pointCampaignTab(tx, destination.id, input.clientAccountId, {
        spreadsheetId: input.snapshot.spreadsheetId,
        spreadsheetTitle: input.snapshot.spreadsheetTitle,
        worksheetId: input.snapshot.worksheetId,
        worksheetTitle: input.snapshot.worksheetTitle,
        header,
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
        setupState: "bound",
        setupReason: null,
      });
      schemaRebound = true;
      await tx.clientOnboardingV2AuditEvent.create({
        data: audit(
          input,
          "column_map_publish",
          {
            mapId: current.id,
            mapVersion: current.mapVersion,
            headerFingerprint: headerFingerprint(header),
            schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
            headerRewritten: false,
          }
        ),
      });
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002" || code === "published_map_exists") {
      return { ok: false, statusCode: 409, error: "published_map_exists", detail: "Retire the published map before publishing a replacement." };
    }
    if (code === "revision_conflict") return { ok: false, statusCode: 409, error: "revision_conflict" };
    throw err;
  }
  const drifted = await switchesUnchanged(db, input.clientAccountId, before);
  if (drifted) return drifted;
  const row = await db.clientSheetColumnMap.findUniqueOrThrow({ where: { id: current.id } });
  return { ok: true, map: presentMap(row, input.snapshot.worksheetTitle), schemaRebound };
}

export async function retireColumnMap(
  input: { clientAccountId: string; mapId: string; requestId: string; actorLabel?: string | null },
  db: PrismaClient = prisma
): Promise<{ ok: true; map: ReturnType<typeof presentMap> } | ColumnMapFailure> {
  const replay = await replayRequest(db, input.clientAccountId, input.requestId);
  if (replay) return replay;
  const current = await db.clientSheetColumnMap.findFirst({ where: { id: input.mapId, clientAccountId: input.clientAccountId } });
  if (!current) return { ok: false, statusCode: 404, error: "client_not_found", detail: "Column map not found for this client." };
  if (current.status === "retired") return { ok: true, map: presentMap(current) };
  const destination = await db.companySheetsDestination.findUnique({ where: { clientAccountId: input.clientAccountId } });
  if (!destination) return { ok: false, statusCode: 409, error: "destination_not_configured" };
  const paused = assertPaused(destination.campaignDispatchEnabled);
  if (paused) return paused;
  const before = switchSnapshot(destination);
  await db.$transaction(async (tx) => {
    await tx.clientSheetColumnMap.update({
      where: { id: current.id },
      data: { status: "retired", retiredAt: new Date(), revision: { increment: 1 } },
    });
    if (current.status === "published") {
      const tab = await tx.companySheetsTabContract.findUnique({
        where: { destinationId_role: { destinationId: destination.id, role: "campaign" } },
      });
      if (
        tab?.schemaVersion === COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA &&
        tab.worksheetId === current.worksheetId &&
        destination.spreadsheetId === current.spreadsheetId
      ) {
        await tx.companySheetsTabContract.update({
          where: { id: tab.id },
          data: { setupState: "incompatible", setupReason: "mapping_required", boundAt: null },
        });
        await invalidateReadiness(tx, destination.id, input.clientAccountId, {});
      }
    }
    await tx.clientOnboardingV2AuditEvent.create({
      data: audit(input, "column_map_retire", { mapId: current.id, headerRewritten: false, cellsDeleted: false }),
    });
  });
  const drifted = await switchesUnchanged(db, input.clientAccountId, before);
  if (drifted) return drifted;
  const row = await db.clientSheetColumnMap.findUniqueOrThrow({ where: { id: current.id } });
  return { ok: true, map: presentMap(row) };
}

export async function saveExistingSheetsTarget(
  input: {
    clientAccountId: string;
    requestId: string;
    actorLabel?: string | null;
    snapshot: ExistingWorksheetSnapshot;
  },
  db: PrismaClient = prisma
): Promise<
  | {
      ok: true;
      spreadsheetId: string;
      worksheetId: number;
      worksheetTitle: string;
      headerFingerprint: string;
      schemaVersion: string | null;
      setupState: string;
      writeReadiness: "not_verified";
      readinessEvidenceInvalidated: boolean;
      campaignDispatchEnabled: false;
      campaignDispatchNotBefore: string | null;
      deliverySwitchChanged: false;
      cutoffChanged: false;
      headerRewritten: false;
    }
  | ColumnMapFailure
> {
  const replay = await replayRequest(db, input.clientAccountId, input.requestId);
  if (replay) return { ok: false, statusCode: 409, error: "revision_conflict", detail: "requestId was already used." };
  const destination = await db.companySheetsDestination.findUnique({
    where: { clientAccountId: input.clientAccountId },
    include: { tabContracts: true },
  });
  if (!destination) return { ok: false, statusCode: 409, error: "destination_not_configured" };
  const paused = assertPaused(destination.campaignDispatchEnabled);
  if (paused) return paused;
  const refused = refuseUnmappable(input.snapshot);
  if (refused && input.snapshot.classification !== "v3_exact_header" && input.snapshot.classification !== "known_schema_exact") {
    return refused;
  }
  if (input.snapshot.classification === "stats_excluded" || input.snapshot.classification === "not_grid") {
    return { ok: false, statusCode: 422, error: "stats_tab_not_a_delivery_target" };
  }
  if (input.snapshot.historicalDataRows === "truncated") {
    return { ok: false, statusCode: 409, error: "reconcile_incomplete", detail: "The row probe was truncated, so this tab was not selected." };
  }
  const owned = await spreadsheetOwner(db, input.snapshot.spreadsheetId, input.clientAccountId);
  if (owned) return owned;
  const campaign = destination.tabContracts.find((contract) => contract.role === "campaign") ?? null;
  const known = knownSchema(input.snapshot.header);
  const published = await findPublishedColumnMap(db, {
    clientAccountId: input.clientAccountId,
    spreadsheetId: input.snapshot.spreadsheetId,
    worksheetId: input.snapshot.worksheetId,
    sourceFunnelId: null,
  });
  const publishedHeader = published ? stringList(published.headerSnapshot) : [];
  const customMatch = Boolean(published && exactHeader(publishedHeader, input.snapshot.header));
  let schemaVersion = campaign?.schemaVersion ?? null;
  let setupState = "incompatible";
  let setupReason: string | null = "mapping_required";
  if (known) {
    schemaVersion = known;
    setupState = "bound";
    setupReason = null;
  } else if (customMatch) {
    schemaVersion = COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA;
    setupState = "bound";
    setupReason = null;
  }
  const sameTarget =
    destination.spreadsheetId === input.snapshot.spreadsheetId &&
    campaign?.worksheetId === input.snapshot.worksheetId &&
    exactHeader(stringList(campaign?.headerContract), input.snapshot.header) &&
    campaign?.schemaVersion === schemaVersion &&
    campaign?.setupState === setupState;
  if (!sameTarget) {
    const before = switchSnapshot(destination);
    await db.$transaction(async (tx) => {
      await pointCampaignTab(tx, destination.id, input.clientAccountId, {
        spreadsheetId: input.snapshot.spreadsheetId,
        spreadsheetTitle: input.snapshot.spreadsheetTitle,
        worksheetId: input.snapshot.worksheetId,
        worksheetTitle: input.snapshot.worksheetTitle,
        header: input.snapshot.header,
        schemaVersion,
        setupState,
        setupReason,
      });
      if (!replay) {
        await tx.clientOnboardingV2AuditEvent.create({
          data: audit(input, "sheets_target_save", {
            spreadsheetId: input.snapshot.spreadsheetId,
            worksheetId: input.snapshot.worksheetId,
            headerFingerprint: headerFingerprint(input.snapshot.header),
            schemaVersion,
            headerRewritten: false,
          }),
        });
      }
    });
    const drifted = await switchesUnchanged(db, input.clientAccountId, before);
    if (drifted) return drifted;
  }
  const after = await db.companySheetsDestination.findUniqueOrThrow({ where: { id: destination.id } });
  return {
    ok: true,
    spreadsheetId: after.spreadsheetId,
    worksheetId: input.snapshot.worksheetId,
    worksheetTitle: input.snapshot.worksheetTitle,
    headerFingerprint: headerFingerprint(input.snapshot.header),
    schemaVersion,
    setupState,
    writeReadiness: "not_verified",
    readinessEvidenceInvalidated: !sameTarget,
    campaignDispatchEnabled: false,
    campaignDispatchNotBefore: after.campaignDispatchNotBefore?.toISOString() ?? null,
    deliverySwitchChanged: false,
    cutoffChanged: false,
    headerRewritten: false,
  };
}

export async function findPublishedColumnMap(
  db: MapDb,
  input: { clientAccountId: string; spreadsheetId: string; worksheetId: number; sourceFunnelId: string | null }
) {
  if (input.sourceFunnelId) {
    const funnel = await db.clientSheetColumnMap.findFirst({
      where: {
        clientAccountId: input.clientAccountId,
        sourceScope: `funnel:${input.sourceFunnelId}`,
        spreadsheetId: input.spreadsheetId,
        worksheetId: input.worksheetId,
        status: "published",
      },
    });
    if (funnel) return funnel;
  }
  return db.clientSheetColumnMap.findFirst({
    where: {
      clientAccountId: input.clientAccountId,
      sourceScope: "shared",
      spreadsheetId: input.spreadsheetId,
      worksheetId: input.worksheetId,
      status: "published",
    },
  });
}

export { sourceFunnelIdFromLead, isCustomSheetsWriterEnabled, columnMapContentKey, customRowValues, syntheticCustomCampaignLead };

function presentMap(
  row: {
    id: string;
    revision: number;
    mapVersion: number;
    status: string;
    sourceScope: string;
    spreadsheetId: string;
    worksheetId: number;
    baseSchemaVersion: string;
    headerSnapshot: Prisma.JsonValue;
    assignments: Prisma.JsonValue;
    publishedAt: Date | null;
    retiredAt: Date | null;
  },
  worksheetTitle: string | null = null
) {
  const header = stringList(row.headerSnapshot);
  const assignments = Array.isArray(row.assignments) ? (row.assignments as ColumnAssignment[]) : [];
  const previewLead = syntheticCustomCampaignLead({
    stableRowId: "preview",
    clientAccountId: "preview",
    spreadsheetId: row.spreadsheetId,
    worksheetTitle: worksheetTitle ?? `gid ${row.worksheetId}`,
  });
  const values = customRowValues(assignments, previewLead) ?? header.map(() => "");
  return {
    id: row.id,
    revision: row.revision,
    mapVersion: row.mapVersion,
    status: row.status,
    sourceScope: row.sourceScope,
    spreadsheetId: row.spreadsheetId,
    worksheetId: row.worksheetId,
    worksheetTitle,
    baseSchemaVersion: row.baseSchemaVersion,
    headerSnapshot: header,
    headerFingerprint: headerFingerprint(header),
    assignments,
    issues: columnMapIssues(assignments),
    preview: header.map((sheetHeader, index) => ({ sheetHeader, value: values[index] ?? "" })),
    targets: mappableColumnTargets(),
    append: CUSTOM_APPEND_CONTRACT,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    customMapping: true,
  };
}

async function pointCampaignTab(
  tx: Prisma.TransactionClient,
  destinationId: string,
  clientAccountId: string,
  input: {
    spreadsheetId: string;
    spreadsheetTitle: string;
    worksheetId: number;
    worksheetTitle: string;
    header: string[];
    schemaVersion: string | null;
    setupState: string;
    setupReason: string | null;
  }
) {
  const destination = await tx.companySheetsDestination.findUniqueOrThrow({ where: { id: destinationId } });
  const spreadsheetChanged = destination.spreadsheetId !== input.spreadsheetId;
  await tx.companySheetsDestination.update({
    where: { id: destinationId },
    data: {
      spreadsheetId: input.spreadsheetId,
      spreadsheetTitle: input.spreadsheetTitle,
      ...(spreadsheetChanged ? { spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${input.spreadsheetId}` } : {}),
      worksheetId: input.worksheetId,
      worksheetTitle: input.worksheetTitle,
      writeReadiness: "not_verified",
      destinationRevision: { increment: 1 },
    },
  });
  await tx.companySheetsTabContract.upsert({
    where: { destinationId_role: { destinationId, role: "campaign" } },
    create: {
      destinationId,
      role: "campaign",
      setupState: input.setupState,
      setupReason: input.setupReason,
      worksheetId: input.worksheetId,
      worksheetTitle: input.worksheetTitle,
      schemaVersion: input.schemaVersion,
      headerContract: input.header,
      inspectedAt: new Date(),
      boundAt: input.setupState === "bound" ? new Date() : null,
    },
    update: {
      setupState: input.setupState,
      setupReason: input.setupReason,
      worksheetId: input.worksheetId,
      worksheetTitle: input.worksheetTitle,
      schemaVersion: input.schemaVersion,
      headerContract: input.header,
      inspectedAt: new Date(),
      boundAt: input.setupState === "bound" ? new Date() : null,
    },
  });
  await tx.clientOnboardingActivationIntent.updateMany({
    where: { clientAccountId, destination: "google_sheets_campaign", status: "ready_for_operator" },
    data: {
      status: "blocked",
      revision: { increment: 1 },
      readinessEvidenceJson: {
        ready: false,
        invalidated: "sheets_target_or_mapping_changed",
        liveActivationPerformedByOnboarding: false,
      },
    },
  });
}

async function invalidateReadiness(
  tx: Prisma.TransactionClient,
  destinationId: string,
  clientAccountId: string,
  _extra: Record<string, never>
) {
  await pointCampaignTab(tx, destinationId, clientAccountId, await currentTab(tx, destinationId));
}

async function currentTab(tx: Prisma.TransactionClient, destinationId: string) {
  const destination = await tx.companySheetsDestination.findUniqueOrThrow({ where: { id: destinationId } });
  const tab = await tx.companySheetsTabContract.findUnique({
    where: { destinationId_role: { destinationId, role: "campaign" } },
  });
  return {
    spreadsheetId: destination.spreadsheetId,
    spreadsheetTitle: destination.spreadsheetTitle ?? destination.spreadsheetId,
    worksheetId: tab?.worksheetId ?? destination.worksheetId,
    worksheetTitle: tab?.worksheetTitle ?? destination.worksheetTitle,
    header: stringList(tab?.headerContract),
    schemaVersion: tab?.schemaVersion ?? null,
    setupState: "incompatible",
    setupReason: "mapping_required",
  };
}

function refuseUnmappable(snapshot: ExistingWorksheetSnapshot): ColumnMapFailure | null {
  if (snapshot.classification === "stats_excluded") {
    return { ok: false, statusCode: 422, error: "stats_tab_not_a_delivery_target" };
  }
  if (snapshot.classification === "not_grid") {
    return { ok: false, statusCode: 422, error: "stats_tab_not_a_delivery_target", detail: "Only a grid worksheet can be mapped." };
  }
  if (snapshot.historicalDataRows === "truncated" || snapshot.classification === "incompatible") {
    return { ok: false, statusCode: 409, error: "reconcile_incomplete", detail: "The header check is incomplete, so a map was not created." };
  }
  if (snapshot.classification === "compatible_empty") {
    return { ok: false, statusCode: 422, error: "use_existing_v3_bind", detail: "An empty grid uses the existing header provision, not a custom map." };
  }
  if (snapshot.classification === "v3_exact_header" || snapshot.classification === "known_schema_exact") {
    return { ok: false, statusCode: 422, error: "use_existing_v3_bind", detail: "This header already matches a campaign schema. Bind it instead of creating a custom map." };
  }
  if (snapshot.header.length === 0) {
    return { ok: false, statusCode: 422, error: "mapping_unresolved", detail: "The worksheet has no header to map." };
  }
  return null;
}

function knownSchema(header: string[]): string | null {
  for (const version of [
    COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
    COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2,
    COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
  ]) {
    const expected = companySheetsCampaignHeader(version);
    if (expected && exactHeader(header, [...expected])) return version;
  }
  return null;
}

function assertPaused(campaignDispatchEnabled: boolean): ColumnMapFailure | null {
  if (campaignDispatchEnabled) return { ok: false, statusCode: 409, error: "delivery_not_paused", detail: PAUSED_DETAIL };
  return null;
}

async function spreadsheetOwner(db: PrismaClient, spreadsheetId: string, clientAccountId: string): Promise<ColumnMapFailure | null> {
  const owner = await db.companySheetsDestination.findUnique({ where: { spreadsheetId } });
  if (owner && owner.clientAccountId !== clientAccountId) return { ok: false, statusCode: 403, error: "tenant_mismatch" };
  return null;
}

async function resolveScope(
  db: PrismaClient,
  clientAccountId: string,
  sourceScope: string
): Promise<{ ok: true; sourceScope: string } | ColumnMapFailure> {
  if (sourceScope === "shared") return { ok: true, sourceScope };
  const match = /^funnel:([A-Za-z0-9_-]{1,128})$/.exec(sourceScope);
  if (!match) return { ok: false, statusCode: 400, error: "invalid_body", detail: "sourceScope must be shared or funnel:{id}." };
  const funnel = await db.sourceFunnel.findUnique({ where: { id: match[1] } });
  if (!funnel || funnel.originClientAccountId !== clientAccountId) {
    return { ok: false, statusCode: 403, error: "tenant_mismatch" };
  }
  if (funnel.associationStatus !== "confirmed") {
    return { ok: false, statusCode: 422, error: "mapping_unresolved", detail: "The funnel is not a confirmed origin for this client." };
  }
  return { ok: true, sourceScope };
}

async function replayRequest(
  db: PrismaClient,
  clientAccountId: string,
  requestId: string
): Promise<{ ok: true; map: ReturnType<typeof presentMap> } | ColumnMapFailure | null> {
  const auditRow = await db.clientOnboardingV2AuditEvent.findUnique({ where: { requestId } });
  if (!auditRow) return null;
  if (auditRow.clientAccountId !== clientAccountId) return { ok: false, statusCode: 409, error: "revision_conflict" };
  const metadata = auditRow.metadataJson;
  const mapId = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as { mapId?: unknown }).mapId : null;
  if (typeof mapId !== "string") return { ok: false, statusCode: 409, error: "revision_conflict" };
  const row = await db.clientSheetColumnMap.findFirst({ where: { id: mapId, clientAccountId } });
  if (!row) return { ok: false, statusCode: 409, error: "revision_conflict" };
  return { ok: true, map: presentMap(row) };
}

function audit(
  input: { clientAccountId: string; requestId: string; actorLabel?: string | null },
  action: string,
  metadata: Prisma.InputJsonObject
): Prisma.ClientOnboardingV2AuditEventCreateInput {
  return {
    clientAccountId: input.clientAccountId,
    historicalClientAccountId: input.clientAccountId,
    requestId: input.requestId,
    action,
    actorLabel: input.actorLabel ?? null,
    auth: "admin_api_key",
    destinations: [],
    metadataJson: metadata,
  };
}

function switchSnapshot(destination: {
  campaignDispatchEnabled: boolean;
  agedDispatchEnabled: boolean;
  campaignDispatchNotBefore: Date | null;
  enabled: boolean;
}) {
  return {
    campaignDispatchEnabled: destination.campaignDispatchEnabled,
    agedDispatchEnabled: destination.agedDispatchEnabled,
    campaignDispatchNotBefore: destination.campaignDispatchNotBefore?.toISOString() ?? null,
    enabled: destination.enabled,
  };
}

async function switchesUnchanged(
  db: PrismaClient,
  clientAccountId: string,
  before: ReturnType<typeof switchSnapshot>
): Promise<ColumnMapFailure | null> {
  const after = await db.companySheetsDestination.findUnique({ where: { clientAccountId } });
  if (!after) return { ok: false, statusCode: 409, error: "destination_not_configured" };
  if (JSON.stringify(switchSnapshot(after)) !== JSON.stringify(before)) {
    return { ok: false, statusCode: 409, error: "worksheet_blocked", detail: "The map change moved a delivery switch or cutoff." };
  }
  return null;
}

function sampleFromStored(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = item && typeof item === "object" && !Array.isArray(item) ? (item as { formula?: unknown }) : null;
    return record?.formula === true ? "=" : "";
  });
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item : ""));
}
