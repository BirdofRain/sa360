import { Prisma, PrismaClient } from "@prisma/client";

import { logger } from "../../lib/logger.js";
import { CSV_IMPORT_SOURCE_SYSTEM } from "./provenance-eligibility.js";
import { campaignLabelAgreementSql } from "./provenance-impact-query.js";
import {
  absentAlias,
  hypotheticalOwnershipConfirmation,
  isOwnershipAliasStatus,
  type OwnershipAliasStatus,
  type OwnershipAliasView,
} from "./historical-ownership-hypothetical.js";
import { HistoricalOwnershipPreviewError } from "./historical-ownership-preview-error.js";
import {
  HISTORICAL_ASSOCIATION_CONTRACT_ID,
  type HistoricalAssociationScopeType,
  type HistoricalOwnershipPreviewResponse,
} from "./historical-campaign-association-contract.js";
import {
  envelopeForIdentities,
  identitiesFromExplicit,
  parseHistoricalCatalogRequest,
  parseHistoricalOwnershipPreviewRequest,
  PROTECTED_RESERVATION_ORDER_NUMBER,
  type CampaignIdentity,
  type CatalogRequest,
} from "./historical-ownership-preview-request.js";

export const HISTORICAL_CATALOG_STATEMENT_TIMEOUT_MS = 20_000;
export const HISTORICAL_PREVIEW_STATEMENT_TIMEOUT_MS = 15_000;

const WRITE_SQL = /\b(insert|update|delete|drop|alter|truncate|grant|copy|create|merge)\b/i;
const CONTACT_SQL_TOKENS = [
  "phone",
  "email",
  "firstname",
  "lastname",
  "clientdisplayname",
  "csvcontent",
  "fingerprint",
  "beneficiary",
  "dateofbirth",
];
const UNSAFE_RESPONSE_KEYS = new Set([
  "phone",
  "email",
  "firstname",
  "lastname",
  "clientdisplayname",
  "clientname",
  "sourcecampaignname",
  "campaignname",
  "csvcontent",
  "rawpayload",
  "rawpayloadjson",
  "normalizedpayload",
  "normalizedpayloadjson",
  "workbooklabel",
  "beneficiary",
  "dateofbirth",
  "password",
  "token",
  "secret",
  "fingerprint",
]);

const IMPORT_REQUEST_SQL = `COALESCE(
  NULLIF(BTRIM(e."rawPayloadJson"->>'importRequestId'), ''),
  NULLIF(BTRIM(e."bulkImportId"), ''),
  '(none)'
)`;

type SqlClient = Prisma.TransactionClient;

export type CatalogCampaign = {
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
  distinctOriginCount: number;
  distinctOriginClientAccountIds: string[];
  additionalOriginClients: number;
  whitespaceVariantCount: number;
  originConflict: boolean;
  lotAliasStatus: string;
  importAliasStatus: string;
  lotConfirmedOriginClientAccountId: string | null;
  importConfirmedOriginClientAccountId: string | null;
  persistedDecision: "eligible" | "not_eligible";
  persistedReason: string;
  persistedOriginClientAccountId: string | null;
};

export type HistoricalCampaignCatalog = {
  ok: true;
  contractId: typeof HISTORICAL_ASSOCIATION_CONTRACT_ID;
  readOnly: true;
  julySourceCampaignNamePreserved: true;
  verificationStatus: "UNVERIFIED";
  registryRowsWritten: false;
  inventoryRowsWritten: false;
  operatorVerifiedProduction: false;
  page: number;
  pageSize: number;
  totalCampaigns: number;
  scope: {
    lotKey: string | null;
    importRequest: string | null;
    niche: string | null;
    labelFilterApplied: boolean;
  };
  scopeAttribution: {
    inventoryRows: number;
    missingLabelRows: number;
    conflictingLabelRows: number;
  };
  campaigns: CatalogCampaign[];
  measurement: {
    readOnlySnapshot: "complete";
    databaseIdentity: {
      source: "postgresql";
      name: string;
      serverAddress: string;
      capturedAt: string;
    };
    operatorVerifiedProduction: false;
  };
};

type ProposalConflict = HistoricalOwnershipPreviewResponse["proposals"][number]["conflict"];

export type HistoricalOwnershipPreviewProposal = HistoricalOwnershipPreviewResponse["proposals"][number] & {
  lotKey: string | null;
  importRequest: string | null;
  missingLabelRows: number;
  availableRows: number;
  scopeConflict: "none" | "multiple_counterpart_scopes" | "registry_disagreement";
  duplicateProposal: boolean;
  proposedOriginClientAccountIds: string[];
  verificationStatus: "UNVERIFIED";
  persisted: {
    source: "historical_campaign_ownership_decision";
    decision: "eligible" | "not_eligible";
    reason: string;
    originClientAccountId: string | null;
    lotStatus: string;
    importStatus: string;
  };
  hypothetical: {
    source: "hypothetical_not_persisted";
    registryWritePerformed: false;
    decision: "eligible" | "not_eligible";
    reason: string;
    originClientAccountId: string | null;
    lotStatus: string;
    importStatus: string;
    rejection: "confirmation_would_be_rejected" | "existing_other_origin" | "duplicate_proposal" | null;
  };
  exclusionImpact: {
    rowsThatWouldExcludeProposedClientAsBuyer: number;
    rowsAlreadyStampedToProposedClient: number;
    reservedOrCommittedAllocationsToProposedClient: number;
    selectionUnchanged: true;
  };
  protectedReservation: {
    orderNumber: typeof PROTECTED_RESERVATION_ORDER_NUMBER;
    reservedAllocationsAffected: number;
    modified: false;
  };
  registry: {
    lotConfirmedOriginClientAccountId: string | null;
    importConfirmedOriginClientAccountId: string | null;
  };
};

export type HistoricalOwnershipPreviewResult = Omit<HistoricalOwnershipPreviewResponse, "proposals"> & {
  scopeMode: "single_scope" | "campaigns";
  verificationStatus: "UNVERIFIED";
  registryRowsWritten: false;
  inventoryRowsWritten: false;
  operatorVerifiedProduction: false;
  /** July-blank rows in the selected lot/import pairs. They are not members of a named campaign. */
  unlabeledRowsInSelectedScopes: number;
  protectedReservation: {
    orderNumber: typeof PROTECTED_RESERVATION_ORDER_NUMBER;
    reservedAllocationsAffected: number;
    modified: false;
  };
  proposals: HistoricalOwnershipPreviewProposal[];
};

function collectSqlText(query: Prisma.Sql): string {
  let text = "";
  query.strings.forEach((part, index) => {
    text += part;
    const value = query.values[index];
    if (value && typeof value === "object" && "strings" in value && "values" in value) {
      text += collectSqlText(value as Prisma.Sql);
    }
  });
  return text;
}

export function assertHistoricalOwnershipSqlSafe(query: Prisma.Sql): void {
  const text = collectSqlText(query);
  const withoutStrings = text.replace(/'[^']*'/g, "''");
  if (!/\bselect\b/i.test(withoutStrings)) throw new HistoricalOwnershipPreviewError("shape_invalid");
  if (WRITE_SQL.test(withoutStrings)) throw new HistoricalOwnershipPreviewError("shape_invalid");
  if (!/\bmaterialized\b/i.test(withoutStrings)) throw new HistoricalOwnershipPreviewError("shape_invalid");
  if (/\blabel_sizes\b/i.test(withoutStrings)) throw new HistoricalOwnershipPreviewError("shape_invalid");
  if (/HistoricalResaleAuthorization/i.test(withoutStrings)) {
    throw new HistoricalOwnershipPreviewError("shape_invalid");
  }
  const compact = withoutStrings.toLowerCase().replace(/["'`_\s]/g, "");
  for (const token of CONTACT_SQL_TOKENS) {
    if (compact.includes(token)) throw new HistoricalOwnershipPreviewError("shape_invalid");
  }
}

function assertSafeResponse(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeResponse(entry);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_RESPONSE_KEYS.has(key.toLowerCase())) {
      throw new HistoricalOwnershipPreviewError("unsafe_response_key");
    }
    assertSafeResponse(child);
  }
}

function count(value: unknown): number {
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new HistoricalOwnershipPreviewError("shape_invalid");
    return Number(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  throw new HistoricalOwnershipPreviewError("shape_invalid");
}

function text(value: unknown, max = 2_000): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new HistoricalOwnershipPreviewError("shape_invalid");
  }
  return value;
}

function nullableId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || /\s/.test(value) || value.includes("@")) {
    throw new HistoricalOwnershipPreviewError("shape_invalid");
  }
  return value;
}

function decisionValue(value: unknown): "eligible" | "not_eligible" {
  if (value === "eligible" || value === "not_eligible") return value;
  throw new HistoricalOwnershipPreviewError("shape_invalid");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new HistoricalOwnershipPreviewError("shape_invalid");
}

function asArray(value: unknown): unknown[] {
  if (typeof value === "string") return JSON.parse(value) as unknown[];
  if (Array.isArray(value)) return value;
  throw new HistoricalOwnershipPreviewError("shape_invalid");
}

function isoTime(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  throw new HistoricalOwnershipPreviewError("shape_invalid");
}

const DIAGNOSTIC_FAILURES = new Set([
  "statement_timeout",
  "shape_invalid",
  "snapshot_failed",
  "snapshot_unavailable",
  "unsafe_response_key",
]);

function isPostgreSqlState(code: string): boolean {
  return /^[0-9A-Z]{5}$/.test(code) && !/^P\d{4}$/.test(code);
}

function sqlStateOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const meta = (error as { meta?: { code?: unknown } }).meta;
  if (typeof meta?.code === "string" && isPostgreSqlState(meta.code)) return meta.code;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && isPostgreSqlState(code)) return code;
  return null;
}

function isStatementTimeout(error: unknown): boolean {
  if (sqlStateOf(error) === "57014") return true;
  const message = error instanceof Error ? error.message : "";
  return /statement timeout|canceling statement/i.test(message);
}

export function describeHistoricalOwnershipDriverError(error: unknown): {
  failureCode: "statement_timeout" | "snapshot_failed";
  sqlState: string | null;
} {
  return {
    failureCode: isStatementTimeout(error) ? "statement_timeout" : "snapshot_failed",
    sqlState: sqlStateOf(error),
  };
}

function recordHistoricalOwnershipFailure(
  operation: "catalog" | "preview",
  failureCode: string,
  startedAt: number,
  sqlState: string | null
): void {
  if (!DIAGNOSTIC_FAILURES.has(failureCode)) return;
  logger.warn("historical_ownership_read_failed", {
    operation,
    failureCode,
    durationMs: Math.max(0, Date.now() - startedAt),
    sqlState,
  });
}

function failHistoricalOwnershipRead(
  error: unknown,
  operation: "catalog" | "preview",
  startedAt: number
): never {
  if (error instanceof HistoricalOwnershipPreviewError) {
    recordHistoricalOwnershipFailure(operation, error.failureCode, startedAt, null);
    throw error;
  }
  const described = describeHistoricalOwnershipDriverError(error);
  recordHistoricalOwnershipFailure(operation, described.failureCode, startedAt, described.sqlState);
  throw new HistoricalOwnershipPreviewError(described.failureCode);
}

export async function withHistoricalOwnershipSnapshot<T>(
  db: PrismaClient,
  run: (tx: SqlClient) => Promise<T>,
  statementTimeoutMs: number
): Promise<T> {
  if (typeof db.$transaction !== "function") throw new HistoricalOwnershipPreviewError("snapshot_unavailable");
  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(statementTimeoutMs)}, true)`;
      return run(tx);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 5_000,
      timeout: statementTimeoutMs + 5_000,
    }
  );
}

function historicalFrom(): Prisma.Sql {
  return Prisma.sql`
    FROM "LeadInventoryItem" i
    JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
    JOIN "InventoryLot" l ON l.id = i."inventoryLotId"
    WHERE (
      e."sourceSystem"::text = ${CSV_IMPORT_SOURCE_SYSTEM}
      OR e."sourceProvider"::text = 'manual_import'
      OR i."sourceProvider"::text = 'manual_import'
    )
  `;
}

function scopedColumns(): Prisma.Sql {
  return Prisma.sql`
    i.id AS item_id,
    i.status::text AS item_status,
    COALESCE(NULLIF(BTRIM(i."nicheKey"), ''), '(blank)') AS niche_key,
    COALESCE(NULLIF(BTRIM(l."lotKey"), ''), '(blank)') AS lot_key,
    ${Prisma.raw(IMPORT_REQUEST_SQL)} AS import_request,
    NULLIF(BTRIM(i."originClientAccountId"), '') AS origin_id,
    NULLIF(BTRIM(e."sourceCampaignName"), '') AS july_label,
    NULLIF(BTRIM(e."normalizedPayloadJson"->>'campaign_name'), '') AS workbook_label,
    NULLIF(BTRIM(e."rawPayloadJson"#>>'{master,lead_type}'), '') AS raw_label
  `;
}

function labeledCte(): Prisma.Sql {
  const agreement = campaignLabelAgreementSql(
    Prisma.raw("july_label"),
    Prisma.raw("workbook_label"),
    Prisma.raw("raw_label")
  );
  return Prisma.sql`
    labeled AS MATERIALIZED (
      SELECT
        item_id,
        item_status,
        niche_key,
        lot_key,
        import_request,
        origin_id,
        july_label,
        historical_july_campaign_label_normalize(july_label) AS normalized_label,
        ${agreement} AS label_agreement
      FROM scoped
    )
  `;
}

function catalogSource(input: CatalogRequest): Prisma.Sql {
  const filters: Prisma.Sql[] = [];
  if (input.lotKey) filters.push(Prisma.sql`l."lotKey" = ${input.lotKey}`);
  if (input.importRequest) filters.push(Prisma.sql`${Prisma.raw(IMPORT_REQUEST_SQL)} = ${input.importRequest}`);
  if (input.niche) filters.push(Prisma.sql`i."nicheKey" = ${input.niche}`);
  const predicates = Prisma.join(filters, " AND ");
  const historical = Prisma.sql`(
      e."sourceSystem"::text = ${CSV_IMPORT_SOURCE_SYSTEM}
      OR e."sourceProvider"::text = 'manual_import'
      OR i."sourceProvider"::text = 'manual_import'
    )`;
  if (input.lotKey) {
    return Prisma.sql`
      FROM "InventoryLot" l
      JOIN "LeadInventoryItem" i ON i."inventoryLotId" = l.id
      JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
      WHERE ${predicates}
        AND ${historical}
    `;
  }
  return Prisma.sql`
    FROM "LeadInventoryItem" i
    JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
    JOIN "InventoryLot" l ON l.id = i."inventoryLotId"
    WHERE ${predicates}
      AND ${historical}
  `;
}

function filteredCount(partial: boolean, predicate: Prisma.Sql | null): Prisma.Sql {
  if (partial) {
    return predicate
      ? Prisma.sql`COALESCE(SUM(n) FILTER (WHERE ${predicate}), 0)::int`
      : Prisma.sql`COALESCE(SUM(n), 0)::int`;
  }
  return predicate
    ? Prisma.sql`COUNT(*) FILTER (WHERE ${predicate})::int`
    : Prisma.sql`COUNT(*)::int`;
}

function catalogGroupCte(input: CatalogRequest, partial: boolean): Prisma.Sql {
  const labelFilter = input.label
    ? Prisma.sql`AND strpos(normalized_label, ${input.label}) > 0`
    : Prisma.empty;
  const source = partial ? Prisma.sql`partial` : Prisma.sql`labeled`;
  return Prisma.sql`
    groups AS (
      SELECT
        lot_key,
        import_request,
        normalized_label,
        MIN(july_label) AS display_label,
        ${filteredCount(partial, null)} AS inventory_rows,
        ${filteredCount(partial, Prisma.sql`item_status = 'available'`)} AS available_rows,
        ${filteredCount(partial, Prisma.sql`item_status = 'reserved'`)} AS reserved_rows,
        ${filteredCount(partial, Prisma.sql`label_agreement IN ('july_column_only', 'july_column_agrees')`)} AS consistent_rows,
        ${filteredCount(partial, Prisma.sql`label_agreement = 'july_column_conflicts'`)} AS conflicting_rows,
        ${filteredCount(partial, Prisma.sql`origin_id IS NOT NULL`)} AS stamped_rows,
        COUNT(DISTINCT origin_id)::int AS distinct_origin_count,
        COALESCE(
          (array_agg(DISTINCT origin_id ORDER BY origin_id) FILTER (WHERE origin_id IS NOT NULL))[1:8],
          ARRAY[]::text[]
        ) AS origin_ids,
        COUNT(DISTINCT july_label)::int AS whitespace_variants,
        CASE WHEN COUNT(DISTINCT niche_key) = 1 THEN MIN(niche_key) ELSE 'mixed' END AS niche_key
      FROM ${source}
      WHERE normalized_label IS NOT NULL
        ${labelFilter}
      GROUP BY lot_key, import_request, normalized_label
    )
  `;
}

function catalogScopeCte(partial: boolean): Prisma.Sql {
  const source = partial ? Prisma.sql`partial` : Prisma.sql`labeled`;
  return Prisma.sql`
    scope AS (
      SELECT
        ${filteredCount(partial, null)} AS scope_inventory_rows,
        ${filteredCount(partial, Prisma.sql`normalized_label IS NULL`)} AS missing_label_rows,
        ${filteredCount(partial, Prisma.sql`label_agreement = 'july_column_conflicts'`)} AS conflicting_label_rows
      FROM ${source}
    )
  `;
}

function catalogResultSelect(input: CatalogRequest): Prisma.Sql {
  const offset = (input.page - 1) * input.pageSize;
  return Prisma.sql`
    SELECT
      scope.scope_inventory_rows,
      scope.missing_label_rows,
      scope.conflicting_label_rows,
      (SELECT COUNT(*)::int FROM groups) AS total_campaigns,
      current_database() AS database_name,
      COALESCE(inet_server_addr()::text, 'unknown') AS server_address,
      transaction_timestamp() AS captured_at,
      COALESCE((
        SELECT jsonb_agg(item ORDER BY (item->>'inventoryRows')::int DESC, item->>'normalizedLabel', item->>'lotKey', item->>'importRequest')
        FROM (
          SELECT jsonb_build_object(
            'displayLabel', page.display_label,
            'normalizedLabel', page.normalized_label,
            'lotKey', page.lot_key,
            'importRequest', page.import_request,
            'nicheKey', page.niche_key,
            'inventoryRows', page.inventory_rows,
            'availableRows', page.available_rows,
            'reservedRows', page.reserved_rows,
            'consistentAttributionRows', page.consistent_rows,
            'conflictingAttributionRows', page.conflicting_rows,
            'stampedOriginRows', page.stamped_rows,
            'whitespaceVariantCount', page.whitespace_variants,
            'distinctOriginCount', page.distinct_origin_count,
            'distinctOriginClientAccountIds', COALESCE(to_jsonb(page.origin_ids), '[]'::jsonb),
            'lotAliasStatus', d.lot_status,
            'importAliasStatus', d.import_status,
            'lotConfirmedOriginClientAccountId', CASE
              WHEN d.lot_status = 'confirmed' THEN lot_alias."originClientAccountId" ELSE NULL END,
            'importConfirmedOriginClientAccountId', CASE
              WHEN d.import_status = 'confirmed' THEN import_alias."originClientAccountId" ELSE NULL END,
            'persistedDecision', d.decision,
            'persistedReason', d.reason,
            'persistedOriginClientAccountId', d.origin_client_account_id
          ) AS item
          FROM (
            SELECT *
            FROM groups
            ORDER BY inventory_rows DESC, normalized_label, lot_key, import_request
            LIMIT ${input.pageSize} OFFSET ${offset}
          ) page
          LEFT JOIN LATERAL historical_campaign_ownership_decision(
            page.lot_key, page.import_request, page.normalized_label
          ) d ON true
          LEFT JOIN "HistoricalCampaignAlias" lot_alias
            ON lot_alias."scopeType" = 'inventory_lot'::"HistoricalRegistryScopeType"
           AND lot_alias."scopeKey" = page.lot_key
           AND lot_alias."normalizedLabel" = page.normalized_label
          LEFT JOIN "HistoricalCampaignAlias" import_alias
            ON import_alias."scopeType" = 'import_request'::"HistoricalRegistryScopeType"
           AND import_alias."scopeKey" = page.import_request
           AND import_alias."normalizedLabel" = page.normalized_label
        ) built
      ), '[]'::jsonb) AS campaigns
    FROM scope
  `;
}

export function buildHistoricalCampaignCatalogQuery(input: CatalogRequest): Prisma.Sql {
  const query = Prisma.sql`
    WITH scoped AS MATERIALIZED (
      SELECT ${scopedColumns()}
      ${catalogSource(input)}
    ),
    ${labeledCte()},
    ${catalogGroupCte(input, false)},
    ${catalogScopeCte(false)}
    ${catalogResultSelect(input)}
  `;
  assertHistoricalOwnershipSqlSafe(query);
  return query;
}

/**
 * PostgreSQL `btrim` removes ASCII spaces only. A filter that already equals
 * its trimmed form can also seek `lot_key` / `niche_key`. A padded or blank
 * filter must not: the projection stores the trimmed grouping key, while the
 * legacy predicate compares the raw column.
 */
function storedProjectionKeyMatchesRawFilter(value: string): boolean {
  return value.length > 0 && value === value.replace(/^ +| +$/g, "");
}

function projectionColumnList(): Prisma.Sql {
  return Prisma.sql`
    p.item_id,
    p.item_status,
    p.niche_key,
    p.lot_key,
    p.import_request,
    p.origin_id,
    p.july_label,
    p.normalized_label,
    p.label_agreement
  `;
}

/**
 * Lot and niche filters stay raw-column equality. The projection stores the
 * trimmed grouping key, so a trimmed match alone would include a different row
 * set than `InventoryLot.lotKey` / `LeadInventoryItem.nicheKey`.
 * Import-request equality already uses the same trimmed COALESCE on both paths.
 *
 * An indexable lot is copied once into `lot_rows`. `lot_key =` stays inside
 * that fence. Repeating it on the raw-lot check collapses the row estimate and
 * can turn validation into one index lookup per projected row.
 *
 * `partial` then counts rows by every aggregated dimension. Campaign groups
 * and scope totals sum those counts, which matches a row-level aggregate
 * without sorting every inventory row to order distinct origin ids.
 */
function projectionFilter(input: CatalogRequest): Prisma.Sql {
  const filters: Prisma.Sql[] = [];
  if (input.lotKey) {
    filters.push(Prisma.sql`
      EXISTS (
        SELECT 1
        FROM "LeadInventoryItem" raw_item
        JOIN "InventoryLot" raw_lot ON raw_lot.id = raw_item."inventoryLotId"
        WHERE raw_item.id = p.item_id
          AND raw_lot."lotKey" = ${input.lotKey}
      )
    `);
  }
  if (input.importRequest) filters.push(Prisma.sql`p.import_request = ${input.importRequest}`);
  if (input.niche) {
    const rawNiche = Prisma.sql`
      EXISTS (
        SELECT 1
        FROM "LeadInventoryItem" raw_item
        WHERE raw_item.id = p.item_id
          AND raw_item."nicheKey" = ${input.niche}
      )
    `;
    filters.push(
      storedProjectionKeyMatchesRawFilter(input.niche)
        ? Prisma.sql`p.niche_key = ${input.niche} AND ${rawNiche}`
        : rawNiche
    );
  }
  return filters.length > 0 ? Prisma.join(filters, " AND ") : Prisma.sql`TRUE`;
}

function projectionPartialCte(input: CatalogRequest, fromLotSlice: boolean): Prisma.Sql {
  const relation = fromLotSlice ? Prisma.sql`lot_rows` : Prisma.sql`historical_catalog_projection`;
  return Prisma.sql`
    partial AS MATERIALIZED (
      SELECT
        p.lot_key,
        p.import_request,
        p.normalized_label,
        p.july_label,
        p.origin_id,
        p.niche_key,
        p.item_status,
        p.label_agreement,
        COUNT(*)::int AS n
      FROM ${relation} p
      WHERE ${projectionFilter(input)}
      GROUP BY
        p.lot_key,
        p.import_request,
        p.normalized_label,
        p.july_label,
        p.origin_id,
        p.niche_key,
        p.item_status,
        p.label_agreement
    )
  `;
}

export function buildHistoricalCampaignProjectionCatalogQuery(input: CatalogRequest): Prisma.Sql {
  const fromLotSlice = Boolean(input.lotKey && storedProjectionKeyMatchesRawFilter(input.lotKey));
  const lotSlice = fromLotSlice
    ? Prisma.sql`
        lot_rows AS MATERIALIZED (
          SELECT ${projectionColumnList()}
          FROM historical_catalog_projection p
          WHERE p.lot_key = ${input.lotKey}
        ),
      `
    : Prisma.empty;
  const query = Prisma.sql`
    WITH ${lotSlice}
    ${projectionPartialCte(input, fromLotSlice)},
    ${catalogGroupCte(input, true)},
    ${catalogScopeCte(true)}
    ${catalogResultSelect(input)}
  `;
  assertHistoricalOwnershipSqlSafe(query);
  return query;
}

/** Explicit false keeps the legacy catalog. Explicit true uses the projection. Anything else fails closed. */
export function historicalCatalogReadyDecision(rows: ReadonlyArray<{ ready: unknown }>): "legacy" | "projection" {
  if (rows.length !== 1) throw new HistoricalOwnershipPreviewError("snapshot_failed");
  if (rows[0]?.ready === false) return "legacy";
  if (rows[0]?.ready === true) return "projection";
  throw new HistoricalOwnershipPreviewError("snapshot_failed");
}

async function historicalCatalogSql(tx: SqlClient, request: CatalogRequest): Promise<Prisma.Sql> {
  const rows = await tx.$queryRaw<Array<{ ready: boolean | null }>>`
    SELECT ready
    FROM historical_catalog_projection_control
  `;
  return historicalCatalogReadyDecision(rows) === "projection"
    ? buildHistoricalCampaignProjectionCatalogQuery(request)
    : buildHistoricalCampaignCatalogQuery(request);
}

function valuesTable(rows: Prisma.Sql[], columns: string): Prisma.Sql {
  return Prisma.sql`(VALUES ${Prisma.join(rows)}) AS v(${Prisma.raw(columns)})`;
}

export function buildHistoricalOwnershipMetricsQuery(identities: CampaignIdentity[]): Prisma.Sql {
  const rows = identities.map(
    (identity) =>
      Prisma.sql`(${identity.ordinal}::int, ${identity.lotKey}, ${identity.importRequest}, ${identity.normalizedLabel}, ${identity.originClientAccountIds[0] ?? ""})`
  );
  const query = Prisma.sql`
    WITH requested AS (
      SELECT ordinal, lot_key, import_request, normalized_label, proposed_client
      FROM ${valuesTable(rows, "ordinal, lot_key, import_request, normalized_label, proposed_client")}
    ),
    scoped AS MATERIALIZED (
      SELECT ${scopedColumns()}
      ${historicalFrom()}
        AND l."lotKey" IN (SELECT lot_key FROM requested)
        AND ${Prisma.raw(IMPORT_REQUEST_SQL)} IN (SELECT import_request FROM requested)
    ),
    ${labeledCte()}
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'ordinal', r.ordinal,
      'normalizedLabel', historical_july_campaign_label_normalize(r.normalized_label),
      'inventoryRows', c.inventory_rows,
      'availableRows', c.available_rows,
      'reservedRows', c.reserved_rows,
      'sameClientRows', c.same_client_rows,
      'otherClientRows', c.other_client_rows,
      'conflictingLabelRows', c.conflicting_rows,
      'unstampedRows', c.unstamped_rows,
      'missingLabelRows', (
        SELECT COUNT(*)::int
        FROM labeled l
        WHERE l.lot_key = r.lot_key
          AND l.import_request = r.import_request
          AND l.normalized_label IS NULL
      ),
      'lo1053ReservedAllocations', (
        SELECT COUNT(*)::int
        FROM labeled l
        JOIN "LeadAllocation" a ON a."leadInventoryItemId" = l.item_id
        JOIN "LeadOrder" o ON o.id = a."leadOrderId"
        WHERE l.lot_key = r.lot_key
          AND l.import_request = r.import_request
          AND l.normalized_label = historical_july_campaign_label_normalize(r.normalized_label)
          AND a.status::text = 'reserved'
          AND o."orderNumber" = ${PROTECTED_RESERVATION_ORDER_NUMBER}
      ),
      'proposedBuyerOpenAllocations', (
        SELECT COUNT(*)::int
        FROM labeled l
        JOIN "LeadAllocation" a ON a."leadInventoryItemId" = l.item_id
        WHERE l.lot_key = r.lot_key
          AND l.import_request = r.import_request
          AND l.normalized_label = historical_july_campaign_label_normalize(r.normalized_label)
          AND a."clientAccountId" = r.proposed_client
          AND a.status::text IN ('reserved', 'committed')
      )
    ) ORDER BY r.ordinal), '[]'::jsonb) AS campaigns
    FROM requested r
    LEFT JOIN LATERAL (
      SELECT
        COUNT(l.item_id)::int AS inventory_rows,
        COUNT(l.item_id) FILTER (WHERE l.item_status = 'available')::int AS available_rows,
        COUNT(l.item_id) FILTER (WHERE l.item_status = 'reserved')::int AS reserved_rows,
        COUNT(l.item_id) FILTER (WHERE BTRIM(l.origin_id) = BTRIM(r.proposed_client))::int AS same_client_rows,
        COUNT(l.item_id) FILTER (
          WHERE l.origin_id IS NOT NULL AND BTRIM(l.origin_id) <> BTRIM(r.proposed_client)
        )::int AS other_client_rows,
        COUNT(l.item_id) FILTER (WHERE l.label_agreement = 'july_column_conflicts')::int AS conflicting_rows,
        COUNT(l.item_id) FILTER (WHERE l.origin_id IS NULL)::int AS unstamped_rows
      FROM labeled l
      WHERE l.lot_key = r.lot_key
        AND l.import_request = r.import_request
        AND l.normalized_label = historical_july_campaign_label_normalize(r.normalized_label)
    ) c ON true
  `;
  assertHistoricalOwnershipSqlSafe(query);
  return query;
}

function aliasStatus(value: unknown): OwnershipAliasStatus {
  if (typeof value === "string" && isOwnershipAliasStatus(value)) return value;
  throw new HistoricalOwnershipPreviewError("shape_invalid");
}

function campaignFromRow(row: Record<string, unknown>): CatalogCampaign {
  const ids = asArray(row.distinctOriginClientAccountIds).map((id) => nullableId(id)).filter((id): id is string => Boolean(id));
  const distinctOriginCount = count(row.distinctOriginCount);
  return {
    displayLabel: text(row.displayLabel),
    normalizedLabel: text(row.normalizedLabel),
    lotKey: text(row.lotKey),
    importRequest: text(row.importRequest),
    nicheKey: text(row.nicheKey),
    inventoryRows: count(row.inventoryRows),
    availableRows: count(row.availableRows),
    reservedRows: count(row.reservedRows),
    consistentAttributionRows: count(row.consistentAttributionRows),
    conflictingAttributionRows: count(row.conflictingAttributionRows),
    stampedOriginRows: count(row.stampedOriginRows),
    distinctOriginCount,
    distinctOriginClientAccountIds: ids,
    additionalOriginClients: Math.max(0, distinctOriginCount - ids.length),
    whitespaceVariantCount: count(row.whitespaceVariantCount),
    originConflict: distinctOriginCount > 1,
    lotAliasStatus: text(row.lotAliasStatus),
    importAliasStatus: text(row.importAliasStatus),
    lotConfirmedOriginClientAccountId: nullableId(row.lotConfirmedOriginClientAccountId),
    importConfirmedOriginClientAccountId: nullableId(row.importConfirmedOriginClientAccountId),
    persistedDecision: decisionValue(row.persistedDecision),
    persistedReason: text(row.persistedReason),
    persistedOriginClientAccountId: nullableId(row.persistedOriginClientAccountId),
  };
}

function registryDisagreement(reason: string, lotStatus: string, importStatus: string): boolean {
  return (
    reason === "fail_closed_ambiguous" ||
    reason === "fail_closed_conflicted" ||
    reason === "fail_closed_conflicting_clients" ||
    lotStatus === "conflicted" ||
    importStatus === "conflicted"
  );
}

function contractConflict(input: {
  duplicate: boolean;
  otherClientRows: number;
  rejection: HistoricalOwnershipPreviewProposal["hypothetical"]["rejection"];
  conflictingLabelRows: number;
}): ProposalConflict {
  if (input.duplicate) return "duplicate_proposal";
  if (input.otherClientRows > 0 || input.rejection === "existing_other_origin") return "existing_other_origin";
  if (input.conflictingLabelRows > 0) return "conflicting_label_evidence";
  return "none";
}

async function expandScopeProposals(
  tx: SqlClient,
  proposals: Array<{
    scopeType: HistoricalAssociationScopeType;
    scopeKey: string;
    normalizedLabel: string;
    originClientAccountId: string;
  }>
): Promise<CampaignIdentity[]> {
  if (proposals.length === 0) return [];
  const rows = proposals.map(
    (proposal, index) =>
      Prisma.sql`(${index}::int, ${proposal.scopeType}, ${proposal.scopeKey}, ${proposal.normalizedLabel}, ${proposal.originClientAccountId})`
  );
  const query = Prisma.sql`
    WITH wanted AS (
      SELECT ordinal, scope_type, scope_key, normalized_label, origin_client
      FROM ${valuesTable(rows, "ordinal, scope_type, scope_key, normalized_label, origin_client")}
    ),
    scoped AS MATERIALIZED (
      SELECT ${scopedColumns()}
      ${historicalFrom()}
        AND (
          l."lotKey" IN (SELECT scope_key FROM wanted WHERE scope_type = 'inventory_lot')
          OR ${Prisma.raw(IMPORT_REQUEST_SQL)} IN (SELECT scope_key FROM wanted WHERE scope_type = 'import_request')
        )
    ),
    ${labeledCte()}
    SELECT
      w.ordinal AS "ordinal",
      w.scope_type AS "scopeType",
      w.normalized_label AS "requestedLabel",
      w.origin_client AS "originClientAccountId",
      l.lot_key AS "lotKey",
      l.import_request AS "importRequest",
      l.normalized_label AS "normalizedLabel"
    FROM wanted w
    JOIN labeled l
      ON l.normalized_label = historical_july_campaign_label_normalize(w.normalized_label)
     AND (
       (w.scope_type = 'inventory_lot' AND l.lot_key = w.scope_key)
       OR (w.scope_type = 'import_request' AND l.import_request = w.scope_key)
     )
    GROUP BY w.ordinal, w.scope_type, w.normalized_label, w.origin_client, l.lot_key, l.import_request, l.normalized_label
  `;
  assertHistoricalOwnershipSqlSafe(query);
  const found = await tx.$queryRaw<Array<Record<string, unknown>>>(query);
  const matches = new Map<number, CampaignIdentity[]>();
  for (const row of found) {
    const ordinal = count(row.ordinal);
    const list = matches.get(ordinal) ?? [];
    list.push({
      ordinal,
      lotKey: text(row.lotKey),
      importRequest: text(row.importRequest),
      normalizedLabel: text(row.normalizedLabel),
      originClientAccountIds: [text(row.originClientAccountId)],
      ambiguousScope: false,
    });
    matches.set(ordinal, list);
  }

  const identities: CampaignIdentity[] = [];
  proposals.forEach((proposal, index) => {
    const list = matches.get(index) ?? [];
    if (list.length === 0) {
      identities.push({
        ordinal: 0,
        lotKey: proposal.scopeType === "inventory_lot" ? proposal.scopeKey : null,
        importRequest: proposal.scopeType === "import_request" ? proposal.scopeKey : null,
        normalizedLabel: proposal.normalizedLabel,
        originClientAccountIds: [proposal.originClientAccountId],
        ambiguousScope: false,
      });
      return;
    }
    const ambiguous = list.length > 1;
    for (const identity of list) identities.push({ ...identity, ambiguousScope: ambiguous });
  });
  return identities;
}

function mergeIdentities(explicit: CampaignIdentity[], expanded: CampaignIdentity[]): CampaignIdentity[] {
  const grouped = new Map<string, CampaignIdentity>();
  for (const identity of [...explicit, ...expanded]) {
    const key = `${identity.lotKey ?? ""}\n${identity.importRequest ?? ""}\n${identity.normalizedLabel}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...identity,
        originClientAccountIds: [...identity.originClientAccountIds],
      });
      continue;
    }
    for (const clientId of identity.originClientAccountIds) {
      if (!existing.originClientAccountIds.includes(clientId)) existing.originClientAccountIds.push(clientId);
    }
    existing.ambiguousScope = existing.ambiguousScope || identity.ambiguousScope;
  }
  const identities = [...grouped.values()].map((identity, ordinal) => ({ ...identity, ordinal }));
  if (identities.length > 50) throw new HistoricalOwnershipPreviewError("historical_ownership_preview_too_many");
  return identities;
}

async function assertClientsExist(tx: SqlClient, identities: CampaignIdentity[]): Promise<void> {
  const ids = [...new Set(identities.flatMap((identity) => identity.originClientAccountIds))];
  if (ids.length === 0) throw new HistoricalOwnershipPreviewError("historical_ownership_preview_invalid");
  const rows = ids.map((id) => Prisma.sql`(${id})`);
  const found = await tx.$queryRaw<Array<{ clientAccountId: string }>>`
    SELECT "clientAccountId"
    FROM "ClientAccount"
    WHERE "clientAccountId" IN (SELECT client_id FROM ${valuesTable(rows, "client_id")})
  `;
  const present = new Set(found.map((row) => row.clientAccountId));
  const missing = ids.filter((id) => !present.has(id));
  if (missing.length > 0) {
    throw new HistoricalOwnershipPreviewError("origin_client_not_found", { missingClientAccountIds: missing });
  }
}

async function readDecisions(
  tx: SqlClient,
  identities: CampaignIdentity[]
): Promise<Map<number, Record<string, unknown>>> {
  const rows = identities.map(
    (identity) =>
      Prisma.sql`(${identity.ordinal}::int, ${identity.lotKey}, ${identity.importRequest}, ${identity.normalizedLabel})`
  );
  const found = await tx.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      v.ordinal AS "ordinal",
      d.decision AS "decision",
      d.reason AS "reason",
      d.origin_client_account_id AS "originClientAccountId",
      d.lot_status AS "lotStatus",
      d.import_status AS "importStatus"
    FROM ${valuesTable(rows, "ordinal, lot_key, import_request, normalized_label")}
    CROSS JOIN LATERAL historical_campaign_ownership_decision(
      v.lot_key, v.import_request, v.normalized_label
    ) d
  `;
  return new Map(found.map((row) => [count(row.ordinal), row]));
}

async function readAliases(
  tx: SqlClient,
  identities: CampaignIdentity[]
): Promise<Map<string, OwnershipAliasView>> {
  const keys: Prisma.Sql[] = [];
  for (const identity of identities) {
    if (identity.lotKey) {
      keys.push(Prisma.sql`('inventory_lot', ${identity.lotKey}, ${identity.normalizedLabel})`);
    }
    if (identity.importRequest) {
      keys.push(Prisma.sql`('import_request', ${identity.importRequest}, ${identity.normalizedLabel})`);
    }
  }
  const aliases = new Map<string, OwnershipAliasView>();
  if (keys.length === 0) return aliases;
  const found = await tx.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      a."scopeType"::text AS "scopeType",
      a."scopeKey" AS "scopeKey",
      a."normalizedLabel" AS "normalizedLabel",
      a."status"::text AS "status",
      a."originClientAccountId" AS "originClientAccountId"
    FROM "HistoricalCampaignAlias" a
    JOIN ${valuesTable(keys, "scope_type, scope_key, normalized_label")}
      ON a."scopeType"::text = v.scope_type
     AND a."scopeKey" = v.scope_key
     AND a."normalizedLabel" = v.normalized_label
  `;
  for (const row of found) {
    aliases.set(`${text(row.scopeType)}\n${text(row.scopeKey)}\n${text(row.normalizedLabel)}`, {
      status: aliasStatus(row.status),
      originClientAccountId: nullableId(row.originClientAccountId),
    });
  }
  return aliases;
}

function aliasFor(
  aliases: Map<string, OwnershipAliasView>,
  scopeType: HistoricalAssociationScopeType,
  scopeKey: string | null,
  label: string
): OwnershipAliasView {
  if (!scopeKey) return { status: "missing_scope", originClientAccountId: null };
  return aliases.get(`${scopeType}\n${scopeKey}\n${label}`) ?? absentAlias();
}

export async function runHistoricalCampaignCatalog(
  db: PrismaClient,
  body: unknown
): Promise<HistoricalCampaignCatalog> {
  const request = parseHistoricalCatalogRequest(body);
  const startedAt = Date.now();
  try {
    const report = await withHistoricalOwnershipSnapshot(
      db,
      async (tx) => {
        const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(await historicalCatalogSql(tx, request));
        const row = rows[0];
        if (!row) throw new HistoricalOwnershipPreviewError("shape_invalid");
        const campaigns = asArray(row.campaigns).map((entry) => campaignFromRow(asRecord(entry)));
        const report: HistoricalCampaignCatalog = {
          ok: true,
          contractId: HISTORICAL_ASSOCIATION_CONTRACT_ID,
          readOnly: true,
          julySourceCampaignNamePreserved: true,
          verificationStatus: "UNVERIFIED",
          registryRowsWritten: false,
          inventoryRowsWritten: false,
          operatorVerifiedProduction: false,
          page: request.page,
          pageSize: request.pageSize,
          totalCampaigns: count(row.total_campaigns),
          scope: {
            lotKey: request.lotKey,
            importRequest: request.importRequest,
            niche: request.niche,
            labelFilterApplied: request.label != null,
          },
          scopeAttribution: {
            inventoryRows: count(row.scope_inventory_rows),
            missingLabelRows: count(row.missing_label_rows),
            conflictingLabelRows: count(row.conflicting_label_rows),
          },
          campaigns,
          measurement: {
            readOnlySnapshot: "complete",
            databaseIdentity: {
              source: "postgresql",
              name: text(row.database_name),
              serverAddress: text(row.server_address),
              capturedAt: isoTime(row.captured_at),
            },
            operatorVerifiedProduction: false,
          },
        };
        assertSafeResponse(report);
        return report;
      },
      HISTORICAL_CATALOG_STATEMENT_TIMEOUT_MS
    );
    return report;
  } catch (error) {
    failHistoricalOwnershipRead(error, "catalog", startedAt);
  }
}

export async function runHistoricalOwnershipPreview(
  db: PrismaClient,
  body: unknown
): Promise<HistoricalOwnershipPreviewResult> {
  const parsed = parseHistoricalOwnershipPreviewRequest(body);
  const startedAt = Date.now();
  try {
    const result = await withHistoricalOwnershipSnapshot(
      db,
      async (tx) => {
        const expanded = await expandScopeProposals(tx, parsed.scopeProposals);
        const identities = mergeIdentities(identitiesFromExplicit(parsed.explicit), expanded);
        await assertClientsExist(tx, identities);
        const measurable = identities.filter(
          (identity): identity is CampaignIdentity & { lotKey: string; importRequest: string } =>
            Boolean(identity.lotKey && identity.importRequest)
        );
        const metrics = new Map<number, Record<string, unknown>>();
        if (measurable.length > 0) {
          const rows = await tx.$queryRaw<Array<{ campaigns: unknown }>>(
            buildHistoricalOwnershipMetricsQuery(measurable)
          );
          for (const entry of asArray(rows[0]?.campaigns)) {
            const record = asRecord(entry);
            metrics.set(count(record.ordinal), record);
          }
        }
        const decisions = await readDecisions(tx, identities);
        const aliases = await readAliases(tx, identities);
        const envelope = envelopeForIdentities(identities, parsed);
        const proposals = identities.map((identity) =>
          assembleProposal(identity, metrics.get(identity.ordinal), decisions.get(identity.ordinal), aliases)
        );
        const reserved = proposals.reduce(
          (sum, proposal) => sum + proposal.protectedReservation.reservedAllocationsAffected,
          0
        );
        const unlabeledByScope = new Map<string, number>();
        for (const identity of measurable) {
          const key = `${identity.lotKey}\n${identity.importRequest}`;
          const value = count(metrics.get(identity.ordinal)?.missingLabelRows);
          const previous = unlabeledByScope.get(key);
          if (previous == null || value > previous) unlabeledByScope.set(key, value);
        }
        const unlabeledRowsInSelectedScopes = [...unlabeledByScope.values()].reduce((sum, value) => sum + value, 0);
        const preview: HistoricalOwnershipPreviewResult = {
          ok: true,
          contractId: HISTORICAL_ASSOCIATION_CONTRACT_ID,
          stampApplied: false,
          resaleAuthorizationApplied: false,
          clientNameMatchEstablishesOwnership: false,
          scopeType: envelope.scopeType,
          scopeKey: envelope.scopeKey,
          scopeMode: envelope.scopeMode,
          verificationStatus: "UNVERIFIED",
          registryRowsWritten: false,
          inventoryRowsWritten: false,
          operatorVerifiedProduction: false,
          unlabeledRowsInSelectedScopes,
          protectedReservation: {
            orderNumber: PROTECTED_RESERVATION_ORDER_NUMBER,
            reservedAllocationsAffected: reserved,
            modified: false,
          },
          proposals,
        };
        assertSafeResponse(preview);
        return preview;
      },
      HISTORICAL_PREVIEW_STATEMENT_TIMEOUT_MS
    );
    return result;
  } catch (error) {
    failHistoricalOwnershipRead(error, "preview", startedAt);
  }
}

function assembleProposal(
  identity: CampaignIdentity,
  metric: Record<string, unknown> | undefined,
  decision: Record<string, unknown> | undefined,
  aliases: Map<string, OwnershipAliasView>
): HistoricalOwnershipPreviewProposal {
  if (!decision) throw new HistoricalOwnershipPreviewError("shape_invalid");
  const lot = aliasFor(aliases, "inventory_lot", identity.lotKey, identity.normalizedLabel);
  const importScope = aliasFor(aliases, "import_request", identity.importRequest, identity.normalizedLabel);
  const duplicate = identity.originClientAccountIds.length > 1;
  const hypothetical = hypotheticalOwnershipConfirmation({
    lot,
    importScope,
    proposedOriginClientAccountId: identity.originClientAccountIds[0] ?? "",
    duplicateProposal: duplicate,
  });
  const otherClientRows = metric ? count(metric.otherClientRows) : 0;
  const conflictingLabelRows = metric ? count(metric.conflictingLabelRows) : 0;
  const conflict = contractConflict({
    duplicate,
    otherClientRows,
    rejection: hypothetical.rejection,
    conflictingLabelRows,
  });
  const persistedReason = text(decision.reason);
  const lotStatus = text(decision.lotStatus);
  const importStatus = text(decision.importStatus);
  const scopeConflict = identity.ambiguousScope
    ? "multiple_counterpart_scopes"
    : registryDisagreement(persistedReason, lotStatus, importStatus)
      ? "registry_disagreement"
      : "none";
  const ambiguous =
    duplicate ||
    conflict !== "none" ||
    scopeConflict !== "none" ||
    hypothetical.rejection != null ||
    (metric ? count(metric.otherClientRows) > 0 : false);
  return {
    normalizedLabel: identity.normalizedLabel,
    originClientAccountId: identity.originClientAccountIds[0] ?? "",
    inventoryRows: metric ? count(metric.inventoryRows) : 0,
    reservedRows: metric ? count(metric.reservedRows) : 0,
    alreadyStampedToSameClient: metric ? count(metric.sameClientRows) : 0,
    alreadyStampedToOtherClient: otherClientRows,
    conflictingLabelRows,
    ambiguous,
    conflict,
    lotKey: identity.lotKey,
    importRequest: identity.importRequest,
    // A named campaign has a July label. Blank July rows stay on unlabeledRowsInSelectedScopes.
    missingLabelRows: 0,
    availableRows: metric ? count(metric.availableRows) : 0,
    scopeConflict,
    duplicateProposal: duplicate,
    proposedOriginClientAccountIds: [...identity.originClientAccountIds],
    verificationStatus: "UNVERIFIED",
    persisted: {
      source: "historical_campaign_ownership_decision",
      decision: decisionValue(decision.decision),
      reason: persistedReason,
      originClientAccountId: nullableId(decision.originClientAccountId),
      lotStatus,
      importStatus,
    },
    hypothetical,
    exclusionImpact: {
      rowsThatWouldExcludeProposedClientAsBuyer: metric ? count(metric.unstampedRows) : 0,
      rowsAlreadyStampedToProposedClient: metric ? count(metric.sameClientRows) : 0,
      reservedOrCommittedAllocationsToProposedClient: metric ? count(metric.proposedBuyerOpenAllocations) : 0,
      selectionUnchanged: true,
    },
    protectedReservation: {
      orderNumber: PROTECTED_RESERVATION_ORDER_NUMBER,
      reservedAllocationsAffected: metric ? count(metric.lo1053ReservedAllocations) : 0,
      modified: false,
    },
    registry: {
      lotConfirmedOriginClientAccountId: lot.status === "confirmed" ? lot.originClientAccountId : null,
      importConfirmedOriginClientAccountId:
        importScope.status === "confirmed" ? importScope.originClientAccountId : null,
    },
  };
}

export function historicalOwnershipQueriesAreScoped(): boolean {
  const catalog = buildHistoricalCampaignCatalogQuery({
    lotKey: "lot_key",
    importRequest: null,
    niche: null,
    label: null,
    page: 1,
    pageSize: 25,
  });
  const preview = buildHistoricalOwnershipMetricsQuery([
    {
      ordinal: 0,
      lotKey: "lot_key",
      importRequest: "import_key",
      normalizedLabel: "July Label",
      originClientAccountIds: ["client_a"],
      ambiguousScope: false,
    },
  ]);
  const catalogText = collectSqlText(catalog);
  const previewText = collectSqlText(preview);
  return (
    catalogText.includes("MATERIALIZED") &&
    catalogText.includes('FROM "InventoryLot" l') &&
    catalogText.includes('JOIN "LeadInventoryItem" i ON i."inventoryLotId" = l.id') &&
    !catalogText.includes("IS NULL OR") &&
    !catalogText.includes("FROM labeled l2") &&
    previewText.includes("MATERIALIZED") &&
    previewText.includes("IN (SELECT lot_key FROM requested)") &&
    !catalogText.includes("label_sizes") &&
    !previewText.includes("label_sizes") &&
    !catalogText.includes(PROTECTED_RESERVATION_ORDER_NUMBER) &&
    preview.values.includes(PROTECTED_RESERVATION_ORDER_NUMBER)
  );
}
