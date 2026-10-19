import { Prisma } from "@prisma/client";

import { SOURCE_FUNNEL_LEADCAPTURE_PROVIDER } from "../source-intake/source-funnel.service.js";
import { CSV_IMPORT_SOURCE_SYSTEM } from "./provenance-eligibility.js";

/** Same open-claim statuses buyer availability already treats as holding inventory. */
export const PROVENANCE_AUDIT_OPEN_ALLOCATION_STATUSES = [
  "shadow",
  "reserved",
  "delivering",
  "committed",
  "review_required",
] as const;

export const PROVENANCE_IMPACT_STATEMENT_TIMEOUT_MS = 120_000;

/**
 * No verified-acquisition table exists. The aggregate always passes SQL NULL.
 * A campaign label, metadata string, exclusivity mode, or acquisition cost is
 * not a substitute.
 */
export const PRODUCTION_VERIFIED_ACQUISITION_SQL = "NULL::text";

export type LabelAgreement =
  | "all_missing"
  | "july_column_only"
  | "july_column_agrees"
  | "july_column_conflicts"
  | "post_july_label_without_column";

export function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

/**
 * Same agreement rules as the historical trucker campaign auditor.
 * `sourceCampaignName` is the original column. A differing companion is a
 * conflict. A companion without that column is not an original label.
 */
export function classifyStoredCampaignLabels(input: {
  sourceCampaignName: string | null;
  normalizedCampaignName: string | null;
  rawLeadType: string | null;
}): { agreement: LabelAgreement; julyLabel: string | null } {
  const column = blankToNull(input.sourceCampaignName);
  const normalized = blankToNull(input.normalizedCampaignName);
  const raw = blankToNull(input.rawLeadType);
  if (!column && !normalized && !raw) {
    return { agreement: "all_missing", julyLabel: null };
  }
  if (!column) {
    return { agreement: "post_july_label_without_column", julyLabel: null };
  }
  const conflict =
    (normalized != null && normalized !== column) || (raw != null && raw !== column);
  if (conflict) return { agreement: "july_column_conflicts", julyLabel: column };
  if (!normalized && !raw) return { agreement: "july_column_only", julyLabel: column };
  return { agreement: "july_column_agrees", julyLabel: column };
}

export function formatPercentBlocked(numerator: number, denominator: number): string | null {
  if (denominator === 0) return null;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0) {
    return null;
  }
  const scaled = Math.round((numerator * 1_000_000) / denominator);
  const whole = Math.floor(scaled / 10_000);
  const fraction = String(scaled % 10_000).padStart(4, "0");
  return `${whole}.${fraction}`;
}

/**
 * SQL twin of `evaluateProvenanceEligibility`. Verified-acquisition and origin
 * are trimmed text. `csv_import` is decided before the LeadCapture exception.
 * Callers choose the verified-acquisition expression. The production aggregate
 * passes NULL::text.
 */
export function provenanceCodeSql(input: {
  itemProvider: Prisma.Sql;
  eventProvider: Prisma.Sql;
  eventSystem: Prisma.Sql;
  origin: Prisma.Sql;
  verifiedAcquisitionId: Prisma.Sql;
}): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN NULLIF(BTRIM(${input.verifiedAcquisitionId}), '') IS NOT NULL
        THEN 'eligible_verified_acquisition'
      WHEN NULLIF(BTRIM(${input.origin}), '') IS NOT NULL
        THEN 'eligible_confirmed_origin'
      WHEN NULLIF(BTRIM(${input.eventSystem}), '') = ${CSV_IMPORT_SOURCE_SYSTEM}
        THEN 'unresolved_origin'
      WHEN (
        cardinality(array_remove(ARRAY[
          NULLIF(BTRIM(${input.itemProvider}), ''),
          NULLIF(BTRIM(${input.eventProvider}), '')
        ], NULL)) > 0
        AND COALESCE((
          SELECT bool_and(provider = ${SOURCE_FUNNEL_LEADCAPTURE_PROVIDER})
          FROM unnest(array_remove(ARRAY[
            NULLIF(BTRIM(${input.itemProvider}), ''),
            NULLIF(BTRIM(${input.eventProvider}), '')
          ], NULL)) AS provider
        ), false)
      ) THEN 'eligible_leadcapture_unstamped'
      ELSE 'unresolved_origin'
    END
  `;
}

export function campaignLabelAgreementSql(
  column: Prisma.Sql,
  normalized: Prisma.Sql,
  raw: Prisma.Sql
): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN ${column} IS NULL AND ${normalized} IS NULL AND ${raw} IS NULL THEN 'all_missing'
      WHEN ${column} IS NULL THEN 'post_july_label_without_column'
      WHEN (${normalized} IS NOT NULL AND ${normalized} IS DISTINCT FROM ${column})
        OR (${raw} IS NOT NULL AND ${raw} IS DISTINCT FROM ${column})
        THEN 'july_column_conflicts'
      WHEN ${normalized} IS NULL AND ${raw} IS NULL THEN 'july_column_only'
      ELSE 'july_column_agrees'
    END
  `;
}

function trimmedLabel(expression: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`NULLIF(BTRIM(${expression}), '')`;
}

function blockedRecoveryJson(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'key', grouped.key,
          'blocked', grouped.blocked_count,
          'consistentOriginalLabel', grouped.consistent_count,
          'missingCampaignLabel', grouped.missing_count,
          'conflictingCampaignEvidence', grouped.conflicting_count,
          'furtherAuthorizationRequired', grouped.blocked_count
        )
        ORDER BY grouped.key
      )
      FROM (
        SELECT
          ${column} AS key,
          (COUNT(*))::bigint AS blocked_count,
          (COUNT(*) FILTER (
            WHERE label_agreement IN ('july_column_only', 'july_column_agrees')
          ))::bigint AS consistent_count,
          (COUNT(*) FILTER (
            WHERE label_agreement IN ('all_missing', 'post_july_label_without_column')
          ))::bigint AS missing_count,
          (COUNT(*) FILTER (
            WHERE label_agreement = 'july_column_conflicts'
          ))::bigint AS conflicting_count
        FROM classified
        WHERE in_structural_gate AND provenance_code = 'unresolved_origin'
        GROUP BY ${column}
      ) grouped
    ), '[]'::jsonb)
  `;
}

function breakdownJson(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'key', grouped.key,
          'before', grouped.before_count,
          'blocked', grouped.blocked_count,
          'remaining', grouped.remaining_count
        )
        ORDER BY grouped.key
      )
      FROM (
        SELECT
          ${column} AS key,
          (COUNT(*))::bigint AS before_count,
          (COUNT(*) FILTER (WHERE provenance_code = 'unresolved_origin'))::bigint AS blocked_count,
          (COUNT(*) FILTER (WHERE provenance_code <> 'unresolved_origin'))::bigint AS remaining_count
        FROM classified
        WHERE in_structural_gate
        GROUP BY ${column}
      ) grouped
    ), '[]'::jsonb)
  `;
}

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

const CONTACT_SQL_TOKENS = [
  "phone",
  "email",
  "firstname",
  "lastname",
  "clientdisplayname",
  "clientname",
  "beneficiary",
  "dateofbirth",
];

const WRITE_SQL = /\b(insert|update|delete|drop|alter|truncate|grant|copy|create|merge)\b/i;

export function assertProvenanceImpactQuerySafe(query: Prisma.Sql): void {
  const text = collectSqlText(query);
  const withoutStrings = text.replace(/'[^']*'/g, "''");
  if (!/\bselect\b/i.test(withoutStrings)) throw new Error("audit_sql_must_be_select");
  if (WRITE_SQL.test(withoutStrings)) throw new Error("audit_sql_must_not_write");
  if (!withoutStrings.includes(PRODUCTION_VERIFIED_ACQUISITION_SQL)) {
    throw new Error("audit_sql_must_treat_verified_acquisition_as_null");
  }
  if (/\bmetadataJson\b|\bacquisitionCost|exclusivityMode|verifiedAcquisition/i.test(withoutStrings)) {
    throw new Error("audit_sql_must_not_treat_strings_as_acquisition_evidence");
  }
  const compact = withoutStrings.toLowerCase().replace(/["'`_\s]/g, "");
  for (const token of CONTACT_SQL_TOKENS) {
    if (compact.includes(token)) throw new Error(`audit_sql_selects_contact:${token}`);
  }
}

export function buildProvenanceImpactQuery(): Prisma.Sql {
  const provenance = provenanceCodeSql({
    itemProvider: Prisma.raw(`i."sourceProvider"::text`),
    eventProvider: Prisma.raw(`e."sourceProvider"::text`),
    eventSystem: Prisma.raw(`e."sourceSystem"::text`),
    origin: Prisma.raw(`i."originClientAccountId"`),
    verifiedAcquisitionId: Prisma.raw(PRODUCTION_VERIFIED_ACQUISITION_SQL),
  });
  const openStatuses = Prisma.join(
    PROVENANCE_AUDIT_OPEN_ALLOCATION_STATUSES.map((status) => Prisma.sql`${status}`)
  );
  const columnLabel = trimmedLabel(Prisma.raw(`e."sourceCampaignName"`));
  const normalizedLabel = trimmedLabel(Prisma.raw(`e."normalizedPayloadJson"->>'campaign_name'`));
  const rawLabel = trimmedLabel(Prisma.raw(`e."rawPayloadJson"#>>'{master,lead_type}'`));
  const agreement = campaignLabelAgreementSql(
    Prisma.raw("column_label"),
    Prisma.raw("normalized_label"),
    Prisma.raw("raw_label")
  );
  const itemAgreement = campaignLabelAgreementSql(columnLabel, normalizedLabel, rawLabel);
  const query = Prisma.sql`
    WITH classified AS (
      SELECT
        i.id AS item_id,
        i.status::text AS status,
        i."inventoryClass"::text AS inventory_class,
        COALESCE(NULLIF(BTRIM(i."nicheKey"), ''), '(blank)') AS niche_key,
        COALESCE(NULLIF(BTRIM(l."lotKey"), ''), '(blank)') AS lot_key,
        COALESCE(NULLIF(BTRIM(i."sourceProvider"::text), ''), '(blank)') AS item_provider,
        COALESCE(NULLIF(BTRIM(e."sourceProvider"::text), ''), '(blank)') AS event_provider,
        COALESCE(NULLIF(BTRIM(e."sourceSystem"::text), ''), '(blank)') AS event_system,
        ${provenance} AS provenance_code,
        ${itemAgreement} AS label_agreement,
        (
          i.status::text = 'available'
          AND i."inventoryClass"::text = 'aged'
          AND i."commerceExcludedAt" IS NULL
          AND l.status::text = 'active'
        ) AS in_structural_gate
      FROM "LeadInventoryItem" i
      JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
      JOIN "InventoryLot" l ON l.id = i."inventoryLotId"
    ),
    labels AS (
      SELECT
        column_label,
        (item_id IS NOT NULL) AS has_inventory,
        ${agreement} AS agreement
      FROM (
        SELECT
          i.id AS item_id,
          ${columnLabel} AS column_label,
          ${normalizedLabel} AS normalized_label,
          ${rawLabel} AS raw_label
        FROM "SourceLeadEvent" e
        LEFT JOIN "LeadInventoryItem" i ON i."sourceLeadEventId" = e.id
        WHERE e."sourceSystem"::text = ${CSV_IMPORT_SOURCE_SYSTEM}
      ) extracted
    ),
    reserved_alloc AS (
      SELECT
        a."leadOrderId" AS order_id,
        o."orderNumber" AS order_number,
        CASE
          WHEN a."leadInventoryItemId" IS NULL OR c.item_id IS NULL THEN 'unresolved_origin'
          ELSE c.provenance_code
        END AS provenance_code,
        (a."leadInventoryItemId" IS NULL OR c.item_id IS NULL) AS missing_inventory
      FROM "LeadAllocation" a
      JOIN "LeadOrder" o ON o.id = a."leadOrderId"
      LEFT JOIN classified c ON c.item_id = a."leadInventoryItemId"
      WHERE a.status::text = 'reserved'
    ),
    open_alloc AS (
      SELECT
        a.id AS allocation_id,
        CASE
          WHEN a."leadInventoryItemId" IS NULL OR c.item_id IS NULL THEN 'unresolved_origin'
          ELSE c.provenance_code
        END AS provenance_code,
        (a."leadInventoryItemId" IS NULL OR c.item_id IS NULL) AS missing_inventory
      FROM "LeadAllocation" a
      JOIN "LeadOrder" o ON o.id = a."leadOrderId"
      LEFT JOIN classified c ON c.item_id = a."leadInventoryItemId"
      WHERE a.status::text IN (${openStatuses})
    )
    SELECT
      (SELECT (COUNT(*))::bigint FROM "LeadInventoryItem") AS inventory_item_rows,
      (SELECT (COUNT(*))::bigint FROM classified) AS classified_items,
      (SELECT (COUNT(*))::bigint FROM classified WHERE in_structural_gate) AS gate_before,
      (SELECT (COUNT(*))::bigint FROM classified WHERE in_structural_gate AND provenance_code = 'unresolved_origin') AS gate_blocked,
      (SELECT (COUNT(*))::bigint FROM classified WHERE in_structural_gate AND provenance_code <> 'unresolved_origin') AS gate_remaining,
      (SELECT (COUNT(*))::bigint FROM classified WHERE in_structural_gate AND provenance_code = 'eligible_confirmed_origin') AS gate_confirmed,
      (SELECT (COUNT(*))::bigint FROM classified WHERE in_structural_gate AND provenance_code = 'eligible_verified_acquisition') AS gate_verified,
      (SELECT (COUNT(*))::bigint FROM classified WHERE in_structural_gate AND provenance_code = 'eligible_leadcapture_unstamped') AS gate_leadcapture,
      (SELECT (COUNT(*))::bigint FROM classified WHERE in_structural_gate AND provenance_code = 'unresolved_origin') AS gate_unresolved,
      (SELECT (COUNT(*))::bigint FROM classified WHERE in_structural_gate AND provenance_code = 'unresolved_origin' AND label_agreement IN ('july_column_only', 'july_column_agrees')) AS blocked_consistent,
      (SELECT (COUNT(*))::bigint FROM classified WHERE in_structural_gate AND provenance_code = 'unresolved_origin' AND label_agreement IN ('all_missing', 'post_july_label_without_column')) AS blocked_missing,
      (SELECT (COUNT(*))::bigint FROM classified WHERE in_structural_gate AND provenance_code = 'unresolved_origin' AND label_agreement = 'july_column_conflicts') AS blocked_conflicting,
      (SELECT (COUNT(*))::bigint FROM classified WHERE provenance_code = 'eligible_confirmed_origin') AS all_confirmed,
      (SELECT (COUNT(*))::bigint FROM classified WHERE provenance_code = 'eligible_verified_acquisition') AS all_verified,
      (SELECT (COUNT(*))::bigint FROM classified WHERE provenance_code = 'eligible_leadcapture_unstamped') AS all_leadcapture,
      (SELECT (COUNT(*))::bigint FROM classified WHERE provenance_code = 'unresolved_origin') AS all_unresolved,
      (SELECT (COUNT(*))::bigint FROM classified WHERE status = 'reserved') AS reserved_items,
      (SELECT (COUNT(*))::bigint FROM classified WHERE status = 'reserved' AND provenance_code = 'unresolved_origin') AS reserved_unresolved,
      (SELECT (COUNT(*))::bigint FROM classified WHERE status = 'reserved' AND provenance_code <> 'unresolved_origin') AS reserved_eligible,
      (SELECT (COUNT(*))::bigint FROM "LeadAllocation" a WHERE a.status::text IN (${openStatuses})) AS open_allocation_rows,
      (SELECT (COUNT(*))::bigint FROM open_alloc) AS open_alloc_rows,
      (SELECT (COUNT(*))::bigint FROM open_alloc WHERE provenance_code = 'unresolved_origin') AS open_alloc_unresolved,
      (SELECT (COUNT(*))::bigint FROM open_alloc WHERE provenance_code <> 'unresolved_origin') AS open_alloc_eligible,
      (SELECT (COUNT(*))::bigint FROM open_alloc WHERE missing_inventory) AS open_alloc_missing_inventory,
      (SELECT (COUNT(*))::bigint FROM (
        SELECT order_id
        FROM reserved_alloc
        GROUP BY order_id
        HAVING (COUNT(*) FILTER (WHERE provenance_code = 'unresolved_origin')) > 0
      ) risk) AS at_risk_orders,
      (SELECT (COUNT(*))::bigint FROM (
        SELECT order_id
        FROM reserved_alloc
        GROUP BY order_id
        HAVING (COUNT(*) FILTER (WHERE provenance_code = 'unresolved_origin')) > 0
          AND (COUNT(*) FILTER (WHERE provenance_code <> 'unresolved_origin')) > 0
      ) mixed) AS mixed_orders,
      (SELECT (COUNT(*))::bigint FROM "SourceLeadEvent" e WHERE e."sourceSystem"::text = ${CSV_IMPORT_SOURCE_SYSTEM}) AS csv_event_rows,
      (SELECT (COUNT(*))::bigint FROM labels) AS csv_events,
      (SELECT (COUNT(*))::bigint FROM labels WHERE column_label IS NOT NULL) AS csv_nonempty,
      (SELECT (COUNT(DISTINCT column_label))::bigint FROM labels WHERE column_label IS NOT NULL) AS csv_distinct,
      (SELECT (COUNT(*))::bigint FROM labels WHERE agreement IN ('july_column_only', 'july_column_agrees')) AS csv_recoverable,
      (SELECT (COUNT(*))::bigint FROM labels WHERE agreement = 'july_column_conflicts') AS csv_conflicting,
      (SELECT (COUNT(*))::bigint FROM labels WHERE agreement IN ('all_missing', 'post_july_label_without_column')) AS csv_missing,
      (SELECT (COUNT(DISTINCT column_label))::bigint FROM labels WHERE agreement IN ('july_column_only', 'july_column_agrees')) AS csv_distinct_recoverable,
      (SELECT (COUNT(DISTINCT column_label))::bigint FROM labels WHERE agreement = 'july_column_conflicts') AS csv_distinct_conflicting,
      (SELECT (COUNT(*))::bigint FROM labels WHERE agreement = 'all_missing') AS agree_all_missing,
      (SELECT (COUNT(*))::bigint FROM labels WHERE agreement = 'july_column_only') AS agree_column_only,
      (SELECT (COUNT(*))::bigint FROM labels WHERE agreement = 'july_column_agrees') AS agree_agrees,
      (SELECT (COUNT(*))::bigint FROM labels WHERE agreement = 'july_column_conflicts') AS agree_conflicts,
      (SELECT (COUNT(*))::bigint FROM labels WHERE agreement = 'post_july_label_without_column') AS agree_post_july,
      (SELECT (COUNT(*))::bigint FROM labels WHERE has_inventory) AS inv_linked,
      (SELECT (COUNT(*))::bigint FROM labels WHERE has_inventory AND column_label IS NOT NULL) AS inv_nonempty,
      (SELECT (COUNT(*))::bigint FROM labels WHERE has_inventory AND agreement IN ('july_column_only', 'july_column_agrees')) AS inv_recoverable,
      (SELECT (COUNT(*))::bigint FROM labels WHERE has_inventory AND agreement = 'july_column_conflicts') AS inv_conflicting,
      (SELECT (COUNT(*))::bigint FROM labels WHERE has_inventory AND agreement IN ('all_missing', 'post_july_label_without_column')) AS inv_missing,
      current_database() AS database_name,
      COALESCE(inet_server_addr()::text, 'unknown') AS server_address,
      transaction_timestamp() AS captured_at,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'status', bucket.status,
            'inventoryClass', bucket.inventory_class,
            'count', bucket.count
          )
          ORDER BY bucket.status, bucket.inventory_class
        )
        FROM (
          SELECT status, inventory_class, (COUNT(*))::bigint AS count
          FROM classified
          GROUP BY status, inventory_class
        ) bucket
      ), '[]'::jsonb) AS by_status_and_class,
      ${breakdownJson(Prisma.raw("niche_key"))} AS by_niche,
      ${breakdownJson(Prisma.raw("lot_key"))} AS by_lot,
      ${breakdownJson(Prisma.raw("item_provider"))} AS by_item_provider,
      ${breakdownJson(Prisma.raw("event_provider"))} AS by_event_provider,
      ${breakdownJson(Prisma.raw("event_system"))} AS by_event_system,
      ${blockedRecoveryJson(Prisma.raw("niche_key"))} AS by_blocked_niche,
      ${blockedRecoveryJson(Prisma.raw("lot_key"))} AS by_blocked_lot,
      COALESCE((
        SELECT jsonb_agg(risk.order_number ORDER BY risk.order_number)
        FROM (
          SELECT order_id, MIN(order_number) AS order_number
          FROM reserved_alloc
          GROUP BY order_id
          HAVING (COUNT(*) FILTER (WHERE provenance_code = 'unresolved_origin')) > 0
        ) risk
      ), '[]'::jsonb) AS at_risk_order_numbers,
      COALESCE((
        SELECT jsonb_agg(mixed.order_number ORDER BY mixed.order_number)
        FROM (
          SELECT order_id, MIN(order_number) AS order_number
          FROM reserved_alloc
          GROUP BY order_id
          HAVING (COUNT(*) FILTER (WHERE provenance_code = 'unresolved_origin')) > 0
            AND (COUNT(*) FILTER (WHERE provenance_code <> 'unresolved_origin')) > 0
        ) mixed
      ), '[]'::jsonb) AS mixed_order_numbers
  `;
  assertProvenanceImpactQuerySafe(query);
  return query;
}

export function provenancePolicyProbeSql(): Prisma.Sql {
  return provenanceCodeSql({
    itemProvider: Prisma.sql`${null}::text`,
    eventProvider: Prisma.sql`${null}::text`,
    eventSystem: Prisma.sql`${null}::text`,
    origin: Prisma.sql`${null}::text`,
    verifiedAcquisitionId: Prisma.sql`${null}::text`,
  });
}
