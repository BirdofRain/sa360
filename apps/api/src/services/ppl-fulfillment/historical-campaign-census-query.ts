import { Prisma } from "@prisma/client";

import { CSV_IMPORT_SOURCE_SYSTEM } from "./provenance-eligibility.js";
import {
  PROVENANCE_AUDIT_OPEN_ALLOCATION_STATUSES,
  campaignLabelAgreementSql,
  provenanceCodeSql,
} from "./provenance-impact-query.js";

export const HISTORICAL_CENSUS_STATEMENT_TIMEOUT_MS = 120_000;
export const HISTORICAL_ORDER_STATEMENT_TIMEOUT_MS = 20_000;
export const HISTORICAL_CENSUS_MAX_GROUPS = 500;

const WRITE_SQL = /\b(insert|update|delete|drop|alter|truncate|grant|copy|create|merge)\b/i;
const CONTACT_SQL_TOKENS = [
  "phone",
  "email",
  "firstname",
  "lastname",
  "clientdisplayname",
  "csvcontent",
  "beneficiary",
  "dateofbirth",
];

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

export function assertHistoricalCensusSqlSafe(query: Prisma.Sql): void {
  const text = collectSqlText(query);
  const withoutStrings = text.replace(/'[^']*'/g, "''");
  if (!/\bselect\b/i.test(withoutStrings)) throw new Error("census_sql_must_be_select");
  if (WRITE_SQL.test(withoutStrings)) throw new Error("census_sql_must_not_write");
  if (!/\bmaterialized\b/i.test(withoutStrings)) throw new Error("census_sql_must_materialize_scope");
  const compact = withoutStrings.toLowerCase().replace(/["'`_\s]/g, "");
  for (const token of CONTACT_SQL_TOKENS) {
    if (compact.includes(token)) throw new Error(`census_sql_selects_contact:${token}`);
  }
}

function countMetrics(): Prisma.Sql {
  return Prisma.sql`
    (COUNT(*))::bigint AS inventory_rows,
    (COUNT(DISTINCT column_label))::bigint AS distinct_original_labels,
    (COUNT(*) FILTER (WHERE provenance_code = 'unresolved_origin'))::bigint AS unresolved_origin_rows,
    (COUNT(*) FILTER (WHERE origin_id IS NOT NULL))::bigint AS stamped_origin_rows,
    (COUNT(*) FILTER (
      WHERE label_agreement IN ('july_column_only', 'july_column_agrees')
    ))::bigint AS consistent_original_label_rows,
    (COUNT(*) FILTER (
      WHERE label_agreement IN ('all_missing', 'post_july_label_without_column')
    ))::bigint AS missing_attribution_rows,
    (COUNT(*) FILTER (
      WHERE label_agreement = 'july_column_conflicts'
    ))::bigint AS conflicting_attribution_rows,
    (COUNT(*) FILTER (WHERE item_status = 'reserved'))::bigint AS reserved_rows
  `;
}

function groupedJson(selectKeys: Prisma.Sql, objectKeys: Prisma.Sql, groupBy: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          ${objectKeys},
          'inventoryRows', grouped.inventory_rows,
          'distinctOriginalLabels', grouped.distinct_original_labels,
          'unresolvedOriginRows', grouped.unresolved_origin_rows,
          'stampedOriginRows', grouped.stamped_origin_rows,
          'consistentOriginalLabelRows', grouped.consistent_original_label_rows,
          'missingAttributionRows', grouped.missing_attribution_rows,
          'conflictingAttributionRows', grouped.conflicting_attribution_rows,
          'reservedRows', grouped.reserved_rows
        )
        ORDER BY grouped.inventory_rows DESC, grouped.sort_key
      )
      FROM (
        SELECT
          ${selectKeys},
          ${countMetrics()}
        FROM labeled
        GROUP BY ${groupBy}
      ) grouped
    ), '[]'::jsonb)
  `;
}

/**
 * One materialized pass over historical manual_import / csv_import inventory.
 * July `sourceCampaignName` is classified and then discarded. The outer select
 * returns counts only.
 */
export function buildHistoricalCampaignCensusQuery(): Prisma.Sql {
  const provenance = provenanceCodeSql({
    itemProvider: Prisma.raw(`i."sourceProvider"::text`),
    eventProvider: Prisma.raw(`e."sourceProvider"::text`),
    eventSystem: Prisma.raw(`e."sourceSystem"::text`),
    origin: Prisma.raw(`i."originClientAccountId"`),
    verifiedAcquisitionId: Prisma.raw("NULL::text"),
  });
  const columnLabel = Prisma.sql`NULLIF(BTRIM(e."sourceCampaignName"), '')`;
  const normalizedLabel = Prisma.sql`NULLIF(BTRIM(e."normalizedPayloadJson"->>'campaign_name'), '')`;
  const rawLabel = Prisma.sql`NULLIF(BTRIM(e."rawPayloadJson"#>>'{master,lead_type}'), '')`;
  const agreement = campaignLabelAgreementSql(
    Prisma.raw("column_label"),
    Prisma.raw("normalized_label"),
    Prisma.raw("raw_label")
  );
  const openStatuses = Prisma.join(
    PROVENANCE_AUDIT_OPEN_ALLOCATION_STATUSES.map((status) => Prisma.sql`${status}`)
  );
  const query = Prisma.sql`
    WITH scoped AS MATERIALIZED (
      SELECT
        i.id AS item_id,
        i.status::text AS item_status,
        COALESCE(NULLIF(BTRIM(i."nicheKey"), ''), '(blank)') AS niche_key,
        COALESCE(NULLIF(BTRIM(l."lotKey"), ''), '(blank)') AS lot_key,
        COALESCE(
          NULLIF(BTRIM(e."rawPayloadJson"->>'importRequestId'), ''),
          NULLIF(BTRIM(e."bulkImportId"), ''),
          '(none)'
        ) AS import_request,
        NULLIF(BTRIM(i."originClientAccountId"), '') AS origin_id,
        ${columnLabel} AS column_label,
        ${normalizedLabel} AS normalized_label,
        ${rawLabel} AS raw_label,
        ${provenance} AS provenance_code
      FROM "LeadInventoryItem" i
      JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
      JOIN "InventoryLot" l ON l.id = i."inventoryLotId"
      WHERE e."sourceSystem"::text = ${CSV_IMPORT_SOURCE_SYSTEM}
         OR e."sourceProvider"::text = 'manual_import'
         OR i."sourceProvider"::text = 'manual_import'
    ),
    labeled AS MATERIALIZED (
      SELECT
        item_id,
        item_status,
        niche_key,
        lot_key,
        import_request,
        origin_id,
        column_label,
        provenance_code,
        ${agreement} AS label_agreement
      FROM scoped
    ),
    label_sizes AS (
      SELECT column_label, (COUNT(*))::bigint AS inventory_rows
      FROM labeled
      WHERE column_label IS NOT NULL
      GROUP BY column_label
    ),
    open_alloc AS (
      SELECT a.status::text AS allocation_status
      FROM "LeadAllocation" a
      JOIN labeled ON labeled.item_id = a."leadInventoryItemId"
      WHERE a.status::text IN (${openStatuses})
    )
    SELECT
      (SELECT (COUNT(*))::bigint FROM labeled) AS inventory_rows,
      (SELECT (COUNT(*))::bigint FROM labeled WHERE provenance_code = 'unresolved_origin') AS unresolved_origin_rows,
      (SELECT (COUNT(*))::bigint FROM labeled WHERE origin_id IS NOT NULL) AS stamped_origin_rows,
      (SELECT (COUNT(*))::bigint FROM labeled WHERE label_agreement IN ('july_column_only', 'july_column_agrees')) AS consistent_original_label_rows,
      (SELECT (COUNT(*))::bigint FROM labeled WHERE label_agreement IN ('all_missing', 'post_july_label_without_column')) AS missing_attribution_rows,
      (SELECT (COUNT(*))::bigint FROM labeled WHERE label_agreement = 'july_column_conflicts') AS conflicting_attribution_rows,
      (SELECT (COUNT(*))::bigint FROM labeled WHERE column_label IS NOT NULL) AS rows_with_original_label,
      (SELECT (COUNT(*))::bigint FROM labeled WHERE column_label IS NULL) AS rows_missing_original_label,
      (SELECT (COUNT(*))::bigint FROM label_sizes) AS distinct_original_labels,
      (SELECT (COUNT(*))::bigint FROM label_sizes WHERE inventory_rows = 1) AS labels_one,
      (SELECT (COUNT(*))::bigint FROM label_sizes WHERE inventory_rows BETWEEN 2 AND 10) AS labels_two_to_ten,
      (SELECT (COUNT(*))::bigint FROM label_sizes WHERE inventory_rows BETWEEN 11 AND 100) AS labels_eleven_to_one_hundred,
      (SELECT (COUNT(*))::bigint FROM label_sizes WHERE inventory_rows BETWEEN 101 AND 1000) AS labels_one_hundred_one_to_one_thousand,
      (SELECT (COUNT(*))::bigint FROM label_sizes WHERE inventory_rows > 1000) AS labels_over_one_thousand,
      (SELECT COALESCE(MAX(inventory_rows), 0)::bigint FROM label_sizes) AS largest_label_inventory_rows,
      (SELECT (COUNT(*))::bigint FROM open_alloc) AS open_allocation_rows,
      current_database() AS database_name,
      COALESCE(inet_server_addr()::text, 'unknown') AS server_address,
      transaction_timestamp() AS captured_at,
      ${groupedJson(
        Prisma.sql`niche_key, niche_key AS sort_key`,
        Prisma.sql`'nicheKey', grouped.niche_key`,
        Prisma.sql`niche_key`
      )} AS by_niche,
      ${groupedJson(
        Prisma.sql`lot_key, lot_key AS sort_key`,
        Prisma.sql`'lotKey', grouped.lot_key`,
        Prisma.sql`lot_key`
      )} AS by_lot,
      ${groupedJson(
        Prisma.sql`niche_key, lot_key, niche_key || ':' || lot_key AS sort_key`,
        Prisma.sql`'nicheKey', grouped.niche_key, 'lotKey', grouped.lot_key`,
        Prisma.sql`niche_key, lot_key`
      )} AS by_niche_and_lot,
      ${groupedJson(
        Prisma.sql`import_request, import_request AS sort_key`,
        Prisma.sql`'importRequest', grouped.import_request`,
        Prisma.sql`import_request`
      )} AS by_import_request,
      ${groupedJson(
        Prisma.sql`label_agreement, label_agreement AS sort_key`,
        Prisma.sql`'agreement', grouped.label_agreement`,
        Prisma.sql`label_agreement`
      )} AS by_agreement,
      ${groupedJson(
        Prisma.sql`item_status, item_status AS sort_key`,
        Prisma.sql`'status', grouped.item_status`,
        Prisma.sql`item_status`
      )} AS by_inventory_status,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'originClientAccountId', clients.origin_id,
            'inventoryRows', clients.inventory_rows
          )
          ORDER BY clients.inventory_rows DESC, clients.origin_id
        )
        FROM (
          SELECT origin_id, (COUNT(*))::bigint AS inventory_rows
          FROM labeled
          WHERE origin_id IS NOT NULL
          GROUP BY origin_id
        ) clients
      ), '[]'::jsonb) AS stamped_origin_clients,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'status', bucket.allocation_status,
            'allocations', bucket.allocations
          )
          ORDER BY bucket.allocation_status
        )
        FROM (
          SELECT allocation_status, (COUNT(*))::bigint AS allocations
          FROM open_alloc
          GROUP BY allocation_status
        ) bucket
      ), '[]'::jsonb) AS open_allocations_by_status
  `;
  assertHistoricalCensusSqlSafe(query);
  return query;
}

/**
 * One order, one snapshot. Counts only: no contact fields, payloads, label text,
 * CSV bytes, or replacement reasons.
 */
export function buildHistoricalOrderDrilldownQuery(orderNumber: string): Prisma.Sql {
  const provenance = provenanceCodeSql({
    itemProvider: Prisma.raw(`i."sourceProvider"::text`),
    eventProvider: Prisma.raw(`e."sourceProvider"::text`),
    eventSystem: Prisma.raw(`e."sourceSystem"::text`),
    origin: Prisma.raw(`i."originClientAccountId"`),
    verifiedAcquisitionId: Prisma.raw("NULL::text"),
  });
  const query = Prisma.sql`
    WITH target AS MATERIALIZED (
      SELECT
        id,
        "orderNumber" AS order_number,
        "clientAccountId" AS buyer_client_account_id,
        status::text AS order_status
      FROM "LeadOrder"
      WHERE "orderNumber" = ${orderNumber}
    ),
    alloc AS (
      SELECT
        a.id AS allocation_id,
        a.status::text AS allocation_status,
        a."clientAccountId" AS allocation_buyer,
        t.buyer_client_account_id,
        COALESCE(NULLIF(BTRIM(l."lotKey"), ''), '(missing)') AS lot_key,
        NULLIF(BTRIM(i."originClientAccountId"), '') AS origin_id,
        (i.id IS NULL) AS missing_inventory,
        (
          i.id IS NOT NULL
          AND (
            e."sourceSystem"::text = ${CSV_IMPORT_SOURCE_SYSTEM}
            OR e."sourceProvider"::text = 'manual_import'
            OR i."sourceProvider"::text = 'manual_import'
          )
        ) AS historical,
        CASE
          WHEN i.id IS NULL THEN 'missing_inventory'
          ELSE ${provenance}
        END AS provenance_code,
        CASE
          WHEN i.id IS NULL THEN 'would_block_missing_inventory'
          WHEN NOT (
            e."sourceSystem"::text = ${CSV_IMPORT_SOURCE_SYSTEM}
            OR e."sourceProvider"::text = 'manual_import'
            OR i."sourceProvider"::text = 'manual_import'
          ) THEN 'outside_historical_gate'
          WHEN NULLIF(BTRIM(i."originClientAccountId"), '') IS NULL THEN 'would_block_unresolved_origin'
          WHEN NULLIF(BTRIM(i."originClientAccountId"), '') = t.buyer_client_account_id
            THEN 'would_block_same_origin'
          ELSE 'would_block_until_resale_authorization'
        END AS revised_policy
      FROM "LeadAllocation" a
      JOIN target t ON t.id = a."leadOrderId"
      LEFT JOIN "LeadInventoryItem" i ON i.id = a."leadInventoryItemId"
      LEFT JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
      LEFT JOIN "InventoryLot" l ON l.id = i."inventoryLotId"
    )
    SELECT
      (SELECT (COUNT(*))::bigint FROM target) AS order_rows,
      (SELECT buyer_client_account_id FROM target LIMIT 1) AS buyer_client_account_id,
      (SELECT order_status FROM target LIMIT 1) AS order_status,
      (SELECT order_number FROM target LIMIT 1) AS order_number,
      current_database() AS database_name,
      COALESCE(inet_server_addr()::text, 'unknown') AS server_address,
      transaction_timestamp() AS captured_at,
      (SELECT (COUNT(*))::bigint FROM alloc) AS allocation_rows,
      (SELECT (COUNT(*))::bigint FROM alloc WHERE allocation_status = 'reserved') AS reserved_rows,
      (SELECT (COUNT(*))::bigint FROM alloc WHERE allocation_buyer IS DISTINCT FROM buyer_client_account_id) AS buyer_mismatch_rows,
      (SELECT (COUNT(*))::bigint FROM alloc WHERE missing_inventory) AS missing_inventory_rows,
      (SELECT (COUNT(*))::bigint FROM alloc WHERE origin_id IS NOT NULL AND origin_id = buyer_client_account_id) AS origin_equals_buyer_rows,
      (SELECT (COUNT(*))::bigint FROM alloc WHERE origin_id IS NOT NULL AND origin_id IS DISTINCT FROM buyer_client_account_id) AS origin_other_client_rows,
      (SELECT (COUNT(*))::bigint FROM alloc WHERE NOT missing_inventory AND origin_id IS NULL) AS origin_unstamped_rows,
      (SELECT (COUNT(*))::bigint FROM alloc WHERE allocation_status = 'reserved' AND revised_policy = 'would_block_unresolved_origin') AS reserved_block_unresolved,
      (SELECT (COUNT(*))::bigint FROM alloc WHERE allocation_status = 'reserved' AND revised_policy = 'would_block_same_origin') AS reserved_block_same_origin,
      (SELECT (COUNT(*))::bigint FROM alloc WHERE allocation_status = 'reserved' AND revised_policy = 'would_block_until_resale_authorization') AS reserved_block_resale,
      (SELECT (COUNT(*))::bigint FROM alloc WHERE allocation_status = 'reserved' AND revised_policy = 'outside_historical_gate') AS reserved_outside_historical,
      (SELECT (COUNT(*))::bigint FROM alloc WHERE allocation_status = 'reserved' AND revised_policy = 'would_block_missing_inventory') AS reserved_block_missing,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object('status', bucket.allocation_status, 'allocations', bucket.allocations)
          ORDER BY bucket.allocation_status
        )
        FROM (
          SELECT allocation_status, (COUNT(*))::bigint AS allocations
          FROM alloc
          GROUP BY allocation_status
        ) bucket
      ), '[]'::jsonb) AS by_status,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object('provenance', bucket.provenance_code, 'allocations', bucket.allocations)
          ORDER BY bucket.provenance_code
        )
        FROM (
          SELECT provenance_code, (COUNT(*))::bigint AS allocations
          FROM alloc
          GROUP BY provenance_code
        ) bucket
      ), '[]'::jsonb) AS by_provenance,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'lotKey', bucket.lot_key,
            'allocations', bucket.allocations,
            'unresolvedOrigin', bucket.unresolved_origin,
            'originEqualsBuyer', bucket.origin_equals_buyer,
            'originOtherClient', bucket.origin_other_client,
            'originUnstamped', bucket.origin_unstamped
          )
          ORDER BY bucket.lot_key
        )
        FROM (
          SELECT
            lot_key,
            (COUNT(*))::bigint AS allocations,
            (COUNT(*) FILTER (WHERE provenance_code = 'unresolved_origin'))::bigint AS unresolved_origin,
            (COUNT(*) FILTER (WHERE origin_id IS NOT NULL AND origin_id = buyer_client_account_id))::bigint AS origin_equals_buyer,
            (COUNT(*) FILTER (WHERE origin_id IS NOT NULL AND origin_id IS DISTINCT FROM buyer_client_account_id))::bigint AS origin_other_client,
            (COUNT(*) FILTER (WHERE NOT missing_inventory AND origin_id IS NULL))::bigint AS origin_unstamped
          FROM alloc
          GROUP BY lot_key
        ) bucket
      ), '[]'::jsonb) AS by_lot,
      (SELECT (COUNT(*))::bigint FROM "LeadDeliveryExportPackage" p JOIN target t ON t.id = p."leadOrderId") AS export_packages,
      (SELECT (COUNT(*))::bigint FROM "LeadDeliveryExportPackage" p JOIN target t ON t.id = p."leadOrderId" WHERE p."spreadsheetDeliveredAt" IS NOT NULL) AS spreadsheet_delivered_packages,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object('status', bucket.notify_status, 'packages', bucket.packages)
          ORDER BY bucket.notify_status
        )
        FROM (
          SELECT COALESCE(p."customerReleaseNotifyStatus", '(unset)') AS notify_status,
                 (COUNT(*))::bigint AS packages
          FROM "LeadDeliveryExportPackage" p
          JOIN target t ON t.id = p."leadOrderId"
          GROUP BY COALESCE(p."customerReleaseNotifyStatus", '(unset)')
        ) bucket
      ), '[]'::jsonb) AS notify_by_status,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object('status', bucket.status, 'instructions', bucket.instructions)
          ORDER BY bucket.status
        )
        FROM (
          SELECT di.status::text AS status, (COUNT(*))::bigint AS instructions
          FROM "DeliveryInstruction" di
          JOIN alloc ON alloc.allocation_id = di."leadAllocationId"
          GROUP BY di.status::text
        ) bucket
      ), '[]'::jsonb) AS instructions_by_status,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object('status', bucket.status, 'requests', bucket.requests)
          ORDER BY bucket.status
        )
        FROM (
          SELECT r.status AS status, (COUNT(*))::bigint AS requests
          FROM "LeadReplacementRequest" r
          JOIN target t ON t.id = r."leadOrderId"
          GROUP BY r.status
        ) bucket
      ), '[]'::jsonb) AS replacements_by_status
  `;
  assertHistoricalCensusSqlSafe(query);
  return query;
}
