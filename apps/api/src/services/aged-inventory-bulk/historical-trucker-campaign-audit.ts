/**
 * Read-only provenance audit for one historical aged-bulk trucker lot.
 *
 * July 30, 2026 import (`4ae73c8`) wrote Lead Type into
 * `SourceLeadEvent.sourceCampaignName` and `normalizedPayloadJson.campaign_name`.
 * `rawPayloadJson` on that writer was only `{ importRequestId, rowNumber }`.
 * `rawPayloadJson.master.lead_type` is added later by enrichment, which replaces
 * `master` wholesale and does not update `sourceCampaignName`. A newer workbook
 * must not be treated as the July label.
 *
 * The deterministic source id hashes niche, phone, email, date, and name. It
 * does not include Lead Type, so a dropped exact-source duplicate with a
 * different campaign is not recoverable from the database.
 *
 * Contact fields are never selected.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

import { parseDatabaseTarget, type DbTargetIdentity } from "./aged-inventory-bulk-db-guard.js";

export const HISTORICAL_TRUCKER_CAMPAIGN_AUDIT_VERSION =
  "historical-trucker-campaign-ownership-v1" as const;

export const HISTORICAL_TRUCKER_LOT_KEY = "lot_aged_bulk_trucker_4b0d299a1651" as const;
export const HISTORICAL_TRUCKER_IMPORT_REQUEST_ID = "aged-bulk-trucker-4b0d299a1651" as const;
export const JR_LAIRD_TRUCKER_CAMPAIGN_LABEL = "JR Laird - Trucker - 3/4/26" as const;

export const HISTORICAL_CAMPAIGN_AUDIT_CONFIRMATION =
  "READ ONLY HISTORICAL CAMPAIGN AUDIT" as const;

const OPEN_ALLOCATION_STATUSES = [
  "shadow",
  "reserved",
  "delivering",
  "committed",
  "review_required",
] as const;

const FORBIDDEN_OUTPUT_KEYS = new Set([
  "phone",
  "phone_e164",
  "phoneE164",
  "phoneRaw",
  "email",
  "emailRaw",
  "firstName",
  "lastName",
  "first_name",
  "last_name",
  "clientName",
  "client_name",
  "clientNameRaw",
  "beneficiary",
  "address",
  "dateOfBirth",
  "date_of_birth",
  "dob",
  "contact",
  "rawPayloadJson",
  "normalizedPayloadJson",
  "lead_details",
]);

export const LOT_INVENTORY_AUDIT_SQL = `
SELECT
  e.id AS "sourceLeadEventId",
  e."sourceLeadId" AS "sourceLeadId",
  e."sourceLeadUid" AS "sourceLeadUid",
  e."sourceRouteKey" AS "sourceRouteKey",
  NULLIF(BTRIM(e."sourceCampaignName"), '') AS "sourceCampaignName",
  NULLIF(BTRIM(e."normalizedPayloadJson"->>'campaign_name'), '') AS "normalizedCampaignName",
  NULLIF(BTRIM(e."rawPayloadJson"#>>'{master,lead_type}'), '') AS "rawLeadType",
  NULLIF(BTRIM(e."rawPayloadJson"->>'importRequestId'), '') AS "rawImportRequestId",
  CASE
    WHEN jsonb_typeof(e."rawPayloadJson"->'rowNumber') = 'number'
      THEN (e."rawPayloadJson"->>'rowNumber')::int
    ELSE NULL
  END AS "rowNumber",
  NULLIF(BTRIM(i."metadataJson"->>'importRequestId'), '') AS "metadataImportRequestId",
  i."originClientAccountId" AS "originClientAccountId",
  i.status::text AS "status",
  i."normalizedState" AS "normalizedState",
  i."nicheKey" AS "nicheKey",
  (i."commerceExcludedAt" IS NOT NULL) AS "commerceExcluded",
  i."sourceProvider"::text AS "sourceProvider",
  i."sourceLane" AS "sourceLane",
  ((e."enrichmentMetadataJson"->'historicalEnrichment') IS NOT NULL) AS "enriched",
  l."lotKey" AS "lotKey",
  l.status::text AS "lotStatus",
  EXISTS (
    SELECT 1
    FROM "LeadAllocation" a
    WHERE a."leadInventoryItemId" = i.id
      AND a.status::text IN ('shadow', 'reserved', 'delivering', 'committed', 'review_required')
  ) AS "openAllocation"
FROM "LeadInventoryItem" i
JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
JOIN "InventoryLot" l ON l.id = i."inventoryLotId"
WHERE l."lotKey" = $1
  AND i."sourceProvider" = 'manual_import'::"SourceLeadProvider"
  AND e."sourceSystem" = 'csv_import'::"SourceLeadSystem"
`.trim();

export const OUTSIDE_SOURCE_ID_AUDIT_SQL = `
SELECT
  e.id AS "sourceLeadEventId",
  e."sourceLeadId" AS "sourceLeadId",
  NULLIF(BTRIM(e."sourceCampaignName"), '') AS "sourceCampaignName",
  l."lotKey" AS "lotKey"
FROM "SourceLeadEvent" e
LEFT JOIN "LeadInventoryItem" i ON i."sourceLeadEventId" = e.id
LEFT JOIN "InventoryLot" l ON l.id = i."inventoryLotId"
WHERE e."sourceProvider" = 'manual_import'::"SourceLeadProvider"
  AND e."sourceSystem" = 'csv_import'::"SourceLeadSystem"
  AND e."sourceLeadId" IN (__IN__)
  AND (l."lotKey" IS DISTINCT FROM $1 OR i.id IS NULL)
`.trim();

export const SNAPSHOT_AUDIT_SQL = `
SELECT
  s.status::text AS "status",
  s."sourceFormat" AS "sourceFormat",
  s."defaultNicheKey" AS "defaultNicheKey",
  s."importRequestId" AS "importRequestId",
  s."lotKey" AS "lotKey",
  s."importedRows" AS "importedRows",
  s."acceptedRows" AS "acceptedRows",
  s."totalSourceRows" AS "totalSourceRows",
  s."fileSha256" AS "fileSha256",
  s."completedAt" AS "completedAt"
FROM "AgedInventorySourceSnapshot" s
WHERE s."lotKey" = $1
   OR s."importRequestId" = $2
`.trim();

export const CLIENT_NAME_CANDIDATE_SQL = `
SELECT
  c."clientAccountId" AS "clientAccountId",
  c."clientDisplayName" AS "clientDisplayName"
FROM "ClientAccount" c
WHERE c."clientDisplayName" ILIKE $1
ORDER BY c."clientAccountId" ASC
LIMIT 20
`.trim();

const AUDIT_SQL_TEXTS = [
  LOT_INVENTORY_AUDIT_SQL,
  OUTSIDE_SOURCE_ID_AUDIT_SQL,
  SNAPSHOT_AUDIT_SQL,
  CLIENT_NAME_CANDIDATE_SQL,
];

const CONTACT_SQL_TOKENS = [
  "phone",
  "email",
  "first_name",
  "last_name",
  "firstname",
  "lastname",
  "beneficiary",
  "date_of_birth",
  "clientname",
];

export function assertAuditSqlOmitsContactAndWrites(sql: string): void {
  const withoutPlaceholders = sql.replace(/__IN__/g, "");
  if (!/^\s*select\b/i.test(withoutPlaceholders)) {
    throw new Error("audit_sql_must_be_select");
  }
  if (/\b(insert|update|delete|drop|alter|truncate|grant|copy|create|merge)\b/i.test(withoutPlaceholders)) {
    throw new Error("audit_sql_must_not_write");
  }
  const compact = withoutPlaceholders.toLowerCase().replace(/["_\s]/g, "");
  for (const token of CONTACT_SQL_TOKENS) {
    if (compact.includes(token)) {
      throw new Error(`audit_sql_selects_contact:${token}`);
    }
  }
}

export function assertHistoricalCampaignAuditSqlSafe(): void {
  for (const sql of AUDIT_SQL_TEXTS) assertAuditSqlOmitsContactAndWrites(sql);
}

export type LabelAgreement =
  | "all_missing"
  | "july_column_only"
  | "july_column_agrees"
  | "july_column_conflicts"
  | "post_july_label_without_column";

export type RepairDecision =
  | "no_go_database_not_production"
  | "no_go_lot_absent"
  | "no_go_labels_incomplete_or_conflicting"
  | "no_go_source_id_label_collision"
  | "conditional_go_labels_only";

export function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export function classifyStoredCampaignLabels(input: {
  sourceCampaignName: string | null;
  normalizedCampaignName: string | null;
  rawLeadType: string | null;
}): {
  agreement: LabelAgreement;
  julyLabel: string | null;
  conflictFields: string[];
} {
  const column = blankToNull(input.sourceCampaignName);
  const normalized = blankToNull(input.normalizedCampaignName);
  const raw = blankToNull(input.rawLeadType);
  if (!column && !normalized && !raw) {
    return { agreement: "all_missing", julyLabel: null, conflictFields: [] };
  }
  if (!column) {
    return {
      agreement: "post_july_label_without_column",
      julyLabel: null,
      conflictFields: [],
    };
  }
  const conflictFields: string[] = [];
  if (normalized && normalized !== column) {
    conflictFields.push("normalizedPayloadJson.campaign_name");
  }
  if (raw && raw !== column) conflictFields.push("rawPayloadJson.master.lead_type");
  if (conflictFields.length > 0) {
    return { agreement: "july_column_conflicts", julyLabel: column, conflictFields };
  }
  if (!normalized && !raw) {
    return { agreement: "july_column_only", julyLabel: column, conflictFields: [] };
  }
  return { agreement: "july_column_agrees", julyLabel: column, conflictFields: [] };
}

type InventoryAuditRow = {
  sourceLeadEventId: string;
  sourceLeadId: string | null;
  sourceLeadUid: string | null;
  sourceRouteKey: string | null;
  sourceCampaignName: string | null;
  normalizedCampaignName: string | null;
  rawLeadType: string | null;
  rawImportRequestId: string | null;
  rowNumber: number | null;
  metadataImportRequestId: string | null;
  originClientAccountId: string | null;
  status: string;
  normalizedState: string;
  nicheKey: string;
  commerceExcluded: boolean;
  sourceProvider: string;
  sourceLane: string;
  enriched: boolean;
  lotKey: string;
  lotStatus: string;
  openAllocation: boolean;
  agreement: LabelAgreement;
  julyLabel: string | null;
  conflictFields: string[];
};

type OutsideAuditRow = {
  sourceLeadEventId: string;
  sourceLeadId: string | null;
  sourceCampaignName: string | null;
  lotKey: string | null;
};

type SnapshotAuditRow = {
  status: string;
  sourceFormat: string;
  defaultNicheKey: string;
  importRequestId: string | null;
  lotKey: string | null;
  importedRows: number;
  acceptedRows: number;
  totalSourceRows: number;
  fileSha256: string;
  completedAt: Date | null;
};

type ClientCandidateRow = {
  clientAccountId: string;
  clientDisplayName: string;
};

export type HistoricalCampaignAuditReport = {
  auditVersion: typeof HISTORICAL_TRUCKER_CAMPAIGN_AUDIT_VERSION;
  readOnly: true;
  substitutesProduction: false;
  database: {
    sanitized: string;
    host: string;
    database: string;
    localDatabase: boolean;
    transactionReadOnly: true;
  };
  scope: {
    lotKey: string;
    importRequestId: string;
    exampleCampaignLabel: string;
    focus: { nicheKey: "trucker"; normalizedState: "GA"; status: "available" };
  };
  lot: {
    found: boolean;
    lotStatus: string | null;
    sourceProvider: string | null;
    sourceLane: string | null;
    nicheKeys: string[];
    inventoryRows: number;
  };
  snapshot: {
    matchCount: number;
    recorded: null | {
      status: string;
      sourceFormat: string;
      defaultNicheKey: string;
      importRequestId: string | null;
      lotKey: string | null;
      importedRows: number;
      acceptedRows: number;
      totalSourceRows: number;
      fileSha256PrefixMatchesLotSuffix: boolean;
      completedAt: string | null;
    };
  };
  inventory: CohortCounts;
  focusGaAvailableTrucker: CohortCounts;
  labels: {
    byJulyColumn: LabelBucket[];
    agreement: Record<LabelAgreement, number>;
    focusAgreement: Record<LabelAgreement, number>;
  };
  collisions: {
    duplicateSourceLeadIdsInsideLot: number;
    sourceLeadIdsWithDisagreeingJulyLabels: number;
    sourceLeadIdsAlsoOutsideLot: number;
    outsideEventsWithDifferentJulyLabel: number;
    undetectableDroppedDuplicates: true;
  };
  exampleCampaign: {
    label: string;
    julyColumnMatches: number;
    julyColumnMatchesInFocus: number;
    normalizedCampaignNameMatches: number;
    rawLeadTypeMatches: number;
    representative: null | {
      sourceLeadEventId: string;
      sourceLeadId: string | null;
      sourceLeadUid: string | null;
      rowNumber: number | null;
      rawImportRequestId: string | null;
      metadataImportRequestId: string | null;
      agreement: LabelAgreement;
      julyLabel: string | null;
      conflictFields: string[];
      originClientAccountId: string | null;
      status: string;
      normalizedState: string;
      nicheKey: string;
      commerceExcluded: boolean;
      enriched: boolean;
      openAllocation: boolean;
      sourceRouteKey: string | null;
    };
  };
  clientNameCandidates: Array<{ clientAccountId: string; clientDisplayName: string }>;
  clientNameCandidatesAreNotOwnership: true;
  decision: {
    code: RepairDecision;
    fulfillFocusCohort: "no_go";
    repairWithoutReimport: "no_go" | "conditional_after_operator_confirmation";
    reasons: string[];
  };
  limitations: string[];
};

type CohortCounts = {
  rows: number;
  byStatus: Record<string, number>;
  byState: Record<string, number>;
  originNull: number;
  originStamped: number;
  distinctOriginClientAccountIds: string[];
  commerceExcluded: number;
  openAllocation: number;
  enriched: number;
  agedBulkRouteKey: number;
  importRequest: {
    rawMatchesScope: number;
    rawOther: number;
    rawMissing: number;
    metadataMatchesScope: number;
    metadataConflictsWithRaw: number;
  };
};

type LabelBucket = {
  label: string | null;
  rows: number;
  focusRows: number;
  originNull: number;
  conflicts: number;
};

function emptyAgreement(): Record<LabelAgreement, number> {
  return {
    all_missing: 0,
    july_column_only: 0,
    july_column_agrees: 0,
    july_column_conflicts: 0,
    post_july_label_without_column: 0,
  };
}

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function isFocus(row: InventoryAuditRow): boolean {
  return row.normalizedState === "GA" && row.status === "available" && row.nicheKey === "trucker";
}

function emptyCohort(): CohortCounts {
  return {
    rows: 0,
    byStatus: {},
    byState: {},
    originNull: 0,
    originStamped: 0,
    distinctOriginClientAccountIds: [],
    commerceExcluded: 0,
    openAllocation: 0,
    enriched: 0,
    agedBulkRouteKey: 0,
    importRequest: {
      rawMatchesScope: 0,
      rawOther: 0,
      rawMissing: 0,
      metadataMatchesScope: 0,
      metadataConflictsWithRaw: 0,
    },
  };
}

function accumulateCohort(rows: InventoryAuditRow[], importRequestId: string, lotKey: string): CohortCounts {
  const cohort = emptyCohort();
  const origins = new Set<string>();
  for (const row of rows) {
    cohort.rows += 1;
    bump(cohort.byStatus, row.status);
    bump(cohort.byState, row.normalizedState);
    if (row.originClientAccountId) {
      cohort.originStamped += 1;
      origins.add(row.originClientAccountId);
    } else {
      cohort.originNull += 1;
    }
    if (row.commerceExcluded) cohort.commerceExcluded += 1;
    if (row.openAllocation) cohort.openAllocation += 1;
    if (row.enriched) cohort.enriched += 1;
    if (row.sourceRouteKey === `AGED_BULK::${lotKey}`) cohort.agedBulkRouteKey += 1;
    if (!row.rawImportRequestId) cohort.importRequest.rawMissing += 1;
    else if (row.rawImportRequestId === importRequestId) cohort.importRequest.rawMatchesScope += 1;
    else cohort.importRequest.rawOther += 1;
    if (row.metadataImportRequestId === importRequestId) {
      cohort.importRequest.metadataMatchesScope += 1;
    }
    if (
      row.rawImportRequestId &&
      row.metadataImportRequestId &&
      row.rawImportRequestId !== row.metadataImportRequestId
    ) {
      cohort.importRequest.metadataConflictsWithRaw += 1;
    }
  }
  cohort.distinctOriginClientAccountIds = [...origins].sort();
  return cohort;
}

export function summarizeJulyLabelCollisions(input: {
  lotRows: Array<{ sourceLeadId: string | null; julyLabel: string | null }>;
  outsideRows: Array<{ sourceLeadId: string | null; sourceCampaignName: string | null }>;
}): HistoricalCampaignAuditReport["collisions"] {
  const byId = new Map<string, Set<string>>();
  const lotIds = new Set<string>();
  for (const row of input.lotRows) {
    if (!row.sourceLeadId) continue;
    lotIds.add(row.sourceLeadId);
    const labels = byId.get(row.sourceLeadId) ?? new Set<string>();
    if (row.julyLabel) labels.add(row.julyLabel);
    byId.set(row.sourceLeadId, labels);
  }
  let duplicateSourceLeadIdsInsideLot = 0;
  const seen = new Map<string, number>();
  for (const row of input.lotRows) {
    if (!row.sourceLeadId) continue;
    seen.set(row.sourceLeadId, (seen.get(row.sourceLeadId) ?? 0) + 1);
  }
  for (const count of seen.values()) {
    if (count > 1) duplicateSourceLeadIdsInsideLot += 1;
  }
  let sourceLeadIdsWithDisagreeingJulyLabels = 0;
  for (const labels of byId.values()) {
    if (labels.size > 1) sourceLeadIdsWithDisagreeingJulyLabels += 1;
  }

  const outsideIds = new Set<string>();
  let outsideEventsWithDifferentJulyLabel = 0;
  for (const row of input.outsideRows) {
    if (!row.sourceLeadId || !lotIds.has(row.sourceLeadId)) continue;
    outsideIds.add(row.sourceLeadId);
    const outsideLabel = blankToNull(row.sourceCampaignName);
    const lotLabels = byId.get(row.sourceLeadId);
    if (outsideLabel && lotLabels && !lotLabels.has(outsideLabel)) {
      outsideEventsWithDifferentJulyLabel += 1;
    }
  }

  return {
    duplicateSourceLeadIdsInsideLot,
    sourceLeadIdsWithDisagreeingJulyLabels,
    sourceLeadIdsAlsoOutsideLot: outsideIds.size,
    outsideEventsWithDifferentJulyLabel,
    undetectableDroppedDuplicates: true,
  };
}

export function decideHistoricalCampaignRepair(input: {
  localDatabase: boolean;
  lotFound: boolean;
  focusRows: InventoryAuditRow[];
  collisions: HistoricalCampaignAuditReport["collisions"];
}): HistoricalCampaignAuditReport["decision"] {
  const reasons: string[] = [];
  if (input.localDatabase) {
    reasons.push("database_host_is_local");
    return {
      code: "no_go_database_not_production",
      fulfillFocusCohort: "no_go",
      repairWithoutReimport: "no_go",
      reasons,
    };
  }
  if (!input.lotFound) {
    reasons.push("lot_absent");
    return {
      code: "no_go_lot_absent",
      fulfillFocusCohort: "no_go",
      repairWithoutReimport: "no_go",
      reasons,
    };
  }
  const badLabel = input.focusRows.filter(
    (row) => row.agreement !== "july_column_agrees" && row.agreement !== "july_column_only"
  );
  if (input.focusRows.length === 0 || badLabel.length > 0) {
    reasons.push(input.focusRows.length === 0 ? "focus_cohort_empty" : "focus_labels_incomplete_or_conflicting");
    return {
      code: "no_go_labels_incomplete_or_conflicting",
      fulfillFocusCohort: "no_go",
      repairWithoutReimport: "no_go",
      reasons,
    };
  }
  if (
    input.collisions.sourceLeadIdsWithDisagreeingJulyLabels > 0 ||
    input.collisions.outsideEventsWithDifferentJulyLabel > 0
  ) {
    reasons.push("source_id_campaign_label_collision");
    return {
      code: "no_go_source_id_label_collision",
      fulfillFocusCohort: "no_go",
      repairWithoutReimport: "no_go",
      reasons,
    };
  }
  reasons.push("july_labels_present_and_consistent_on_focus_rows");
  reasons.push("operator_confirmation_still_required");
  reasons.push("fulfillment_still_requires_fail_closed_origin_gate");
  return {
    code: "conditional_go_labels_only",
    fulfillFocusCohort: "no_go",
    repairWithoutReimport: "conditional_after_operator_confirmation",
    reasons,
  };
}

function labelBuckets(rows: InventoryAuditRow[]): LabelBucket[] {
  const buckets = new Map<string, LabelBucket>();
  for (const row of rows) {
    const key = row.julyLabel ?? "";
    const bucket = buckets.get(key) ?? {
      label: row.julyLabel,
      rows: 0,
      focusRows: 0,
      originNull: 0,
      conflicts: 0,
    };
    bucket.rows += 1;
    if (isFocus(row)) bucket.focusRows += 1;
    if (!row.originClientAccountId) bucket.originNull += 1;
    if (row.agreement === "july_column_conflicts" || row.agreement === "post_july_label_without_column") {
      bucket.conflicts += 1;
    }
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => b.rows - a.rows || (a.label ?? "").localeCompare(b.label ?? ""));
}

function collectKeys(value: unknown, keys: Set<string>) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, keys);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
}

export function assertAuditReportOmitsContact(report: unknown): void {
  const keys = new Set<string>();
  collectKeys(report, keys);
  for (const key of keys) {
    if (FORBIDDEN_OUTPUT_KEYS.has(key)) {
      throw new Error(`audit_report_contains_contact_key:${key}`);
    }
  }
}

function lotShaSuffix(lotKey: string): string | null {
  const marker = "lot_aged_bulk_trucker_";
  if (!lotKey.startsWith(marker)) return null;
  const suffix = lotKey.slice(marker.length);
  return /^[0-9a-f]{12}$/i.test(suffix) ? suffix.toLowerCase() : null;
}

function hydrateRow(raw: Omit<InventoryAuditRow, "agreement" | "julyLabel" | "conflictFields">): InventoryAuditRow {
  const classified = classifyStoredCampaignLabels(raw);
  return {
    ...raw,
    sourceCampaignName: blankToNull(raw.sourceCampaignName),
    normalizedCampaignName: blankToNull(raw.normalizedCampaignName),
    rawLeadType: blankToNull(raw.rawLeadType),
    rawImportRequestId: blankToNull(raw.rawImportRequestId),
    metadataImportRequestId: blankToNull(raw.metadataImportRequestId),
    originClientAccountId: blankToNull(raw.originClientAccountId),
    sourceLeadId: blankToNull(raw.sourceLeadId),
    sourceLeadUid: blankToNull(raw.sourceLeadUid),
    sourceRouteKey: blankToNull(raw.sourceRouteKey),
    rowNumber: raw.rowNumber == null ? null : Number(raw.rowNumber),
    commerceExcluded: raw.commerceExcluded === true,
    enriched: raw.enriched === true,
    openAllocation: raw.openAllocation === true,
    agreement: classified.agreement,
    julyLabel: classified.julyLabel,
    conflictFields: classified.conflictFields,
  };
}

function isLocalHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

async function withReadOnlyTransaction<T>(
  db: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('transaction_read_only', 'on', true)`;
    await tx.$queryRaw`SELECT set_config('statement_timeout', '120000', true)`;
    const flag = await tx.$queryRaw<Array<{ ro: string }>>`
      SELECT current_setting('transaction_read_only') AS ro
    `;
    if (flag[0]?.ro !== "on") throw new Error("read_only_transaction_not_enforced");
    return fn(tx);
  });
}

function placeholders(start: number, count: number): string {
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(", ");
}

async function loadOutsideRows(
  tx: Prisma.TransactionClient,
  lotKey: string,
  sourceLeadIds: string[]
): Promise<OutsideAuditRow[]> {
  const unique = [...new Set(sourceLeadIds)];
  const rows: OutsideAuditRow[] = [];
  const chunkSize = 2000;
  for (let offset = 0; offset < unique.length; offset += chunkSize) {
    const chunk = unique.slice(offset, offset + chunkSize);
    const sql = OUTSIDE_SOURCE_ID_AUDIT_SQL.replace("__IN__", placeholders(2, chunk.length));
    const found = await tx.$queryRawUnsafe<OutsideAuditRow[]>(sql, lotKey, ...chunk);
    rows.push(...found);
  }
  return rows;
}

const LIMITATIONS = [
  "Contact fields are not selected.",
  "A newer live workbook was not compared to these rows.",
  "sourceCampaignName is the July 30 Lead Type column. normalizedPayloadJson.campaign_name was written beside it and is kept when enrichment disagrees. rawPayloadJson.master.lead_type did not exist on the July writer; enrichment replaces master wholesale.",
  "The aged-bulk source id omits Lead Type. An exact-source duplicate with a different campaign was skipped at import and cannot be counted from stored rows.",
  "Client display-name matches are not ownership, acquisition, or resale evidence.",
  "Null origin on manual_import remains selectable by PPL candidate selection until a fail-closed gate is shipped.",
];

export async function runHistoricalTruckerCampaignAudit(
  db: PrismaClient,
  input: {
    databaseUrl: string;
    lotKey?: string;
    importRequestId?: string;
    exampleCampaignLabel?: string;
  }
): Promise<HistoricalCampaignAuditReport> {
  assertHistoricalCampaignAuditSqlSafe();
  const lotKey = input.lotKey?.trim() || HISTORICAL_TRUCKER_LOT_KEY;
  const importRequestId = input.importRequestId?.trim() || HISTORICAL_TRUCKER_IMPORT_REQUEST_ID;
  const exampleCampaignLabel = input.exampleCampaignLabel?.trim() || JR_LAIRD_TRUCKER_CAMPAIGN_LABEL;
  const identity: DbTargetIdentity = parseDatabaseTarget(input.databaseUrl);
  const localDatabase = isLocalHost(identity.host);

  const loaded = await withReadOnlyTransaction(db, async (tx) => {
    const inventory = await tx.$queryRawUnsafe<
      Array<Omit<InventoryAuditRow, "agreement" | "julyLabel" | "conflictFields">>
    >(LOT_INVENTORY_AUDIT_SQL, lotKey);
    const rows = inventory.map(hydrateRow);
    const outside = await loadOutsideRows(
      tx,
      lotKey,
      rows.map((row) => row.sourceLeadId).filter((id): id is string => Boolean(id))
    );
    const snapshots = await tx.$queryRawUnsafe<SnapshotAuditRow[]>(
      SNAPSHOT_AUDIT_SQL,
      lotKey,
      importRequestId
    );
    const candidates = await tx.$queryRawUnsafe<ClientCandidateRow[]>(
      CLIENT_NAME_CANDIDATE_SQL,
      "%laird%"
    );
    return { rows, outside, snapshots, candidates };
  });

  const rows = loaded.rows;
  const focusRows = rows.filter(isFocus);
  const agreement = emptyAgreement();
  const focusAgreement = emptyAgreement();
  for (const row of rows) {
    agreement[row.agreement] += 1;
    if (isFocus(row)) focusAgreement[row.agreement] += 1;
  }
  const collisions = summarizeJulyLabelCollisions({
    lotRows: rows.map((row) => ({ sourceLeadId: row.sourceLeadId, julyLabel: row.julyLabel })),
    outsideRows: loaded.outside,
  });
  const suffix = lotShaSuffix(lotKey);
  const preferredSnapshot =
    loaded.snapshots.find((row) => row.lotKey === lotKey && row.importRequestId === importRequestId) ??
    loaded.snapshots.find((row) => row.lotKey === lotKey) ??
    loaded.snapshots[0] ??
    null;
  const julyMatches = rows.filter((row) => row.sourceCampaignName === exampleCampaignLabel);
  const focusJuly = julyMatches.filter(isFocus);
  const representativePool = focusJuly.length > 0 ? focusJuly : [];
  const representative = [...representativePool].sort((a, b) =>
    a.sourceLeadEventId.localeCompare(b.sourceLeadEventId)
  )[0];

  const nicheKeys = [...new Set(rows.map((row) => row.nicheKey))].sort();
  const report: HistoricalCampaignAuditReport = {
    auditVersion: HISTORICAL_TRUCKER_CAMPAIGN_AUDIT_VERSION,
    readOnly: true,
    substitutesProduction: false,
    database: {
      sanitized: identity.sanitized,
      host: identity.host,
      database: identity.database,
      localDatabase,
      transactionReadOnly: true,
    },
    scope: {
      lotKey,
      importRequestId,
      exampleCampaignLabel,
      focus: { nicheKey: "trucker", normalizedState: "GA", status: "available" },
    },
    lot: {
      found: rows.length > 0,
      lotStatus: rows[0]?.lotStatus ?? null,
      sourceProvider: rows[0]?.sourceProvider ?? null,
      sourceLane: rows[0]?.sourceLane ?? null,
      nicheKeys,
      inventoryRows: rows.length,
    },
    snapshot: {
      matchCount: loaded.snapshots.length,
      recorded: preferredSnapshot
        ? {
            status: preferredSnapshot.status,
            sourceFormat: preferredSnapshot.sourceFormat,
            defaultNicheKey: preferredSnapshot.defaultNicheKey,
            importRequestId: preferredSnapshot.importRequestId,
            lotKey: preferredSnapshot.lotKey,
            importedRows: Number(preferredSnapshot.importedRows),
            acceptedRows: Number(preferredSnapshot.acceptedRows),
            totalSourceRows: Number(preferredSnapshot.totalSourceRows),
            fileSha256PrefixMatchesLotSuffix: Boolean(
              suffix && preferredSnapshot.fileSha256.toLowerCase().startsWith(suffix)
            ),
            completedAt: preferredSnapshot.completedAt
              ? new Date(preferredSnapshot.completedAt).toISOString()
              : null,
          }
        : null,
    },
    inventory: accumulateCohort(rows, importRequestId, lotKey),
    focusGaAvailableTrucker: accumulateCohort(focusRows, importRequestId, lotKey),
    labels: {
      byJulyColumn: labelBuckets(rows),
      agreement,
      focusAgreement,
    },
    collisions,
    exampleCampaign: {
      label: exampleCampaignLabel,
      julyColumnMatches: julyMatches.length,
      julyColumnMatchesInFocus: focusJuly.length,
      normalizedCampaignNameMatches: rows.filter((row) => row.normalizedCampaignName === exampleCampaignLabel)
        .length,
      rawLeadTypeMatches: rows.filter((row) => row.rawLeadType === exampleCampaignLabel).length,
      representative: representative
        ? {
            sourceLeadEventId: representative.sourceLeadEventId,
            sourceLeadId: representative.sourceLeadId,
            sourceLeadUid: representative.sourceLeadUid,
            rowNumber: representative.rowNumber,
            rawImportRequestId: representative.rawImportRequestId,
            metadataImportRequestId: representative.metadataImportRequestId,
            agreement: representative.agreement,
            julyLabel: representative.julyLabel,
            conflictFields: representative.conflictFields,
            originClientAccountId: representative.originClientAccountId,
            status: representative.status,
            normalizedState: representative.normalizedState,
            nicheKey: representative.nicheKey,
            commerceExcluded: representative.commerceExcluded,
            enriched: representative.enriched,
            openAllocation: representative.openAllocation,
            sourceRouteKey: representative.sourceRouteKey,
          }
        : null,
    },
    clientNameCandidates: loaded.candidates.map((row) => ({
      clientAccountId: row.clientAccountId,
      clientDisplayName: row.clientDisplayName,
    })),
    clientNameCandidatesAreNotOwnership: true,
    decision: decideHistoricalCampaignRepair({
      localDatabase,
      lotFound: rows.length > 0,
      focusRows,
      collisions,
    }),
    limitations: LIMITATIONS,
  };
  assertAuditReportOmitsContact(report);
  return report;
}

export { OPEN_ALLOCATION_STATUSES, withReadOnlyTransaction };
