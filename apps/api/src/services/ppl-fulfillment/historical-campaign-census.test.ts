import assert from "node:assert/strict";
import { test } from "node:test";

import { isHistoricalOrderNumber } from "../../lib/historical-campaign-census-auth.js";
import {
  HISTORICAL_ASSOCIATION_AUTH,
  HISTORICAL_ASSOCIATION_ROUTES,
} from "./historical-campaign-association-contract.js";
import {
  assembleHistoricalCensusReport,
  assembleHistoricalOrderReport,
  historicalCensusQueriesAreReadOnly,
} from "./historical-campaign-census.js";
import {
  assertHistoricalCensusSqlSafe,
  buildHistoricalCampaignCensusQuery,
  buildHistoricalOrderDrilldownQuery,
} from "./historical-campaign-census-query.js";

test("historical census SQL stays aggregate and read-only", () => {
  assert.equal(historicalCensusQueriesAreReadOnly(), true);
  const census = buildHistoricalCampaignCensusQuery();
  const order = buildHistoricalOrderDrilldownQuery("LO-1053");
  assertHistoricalCensusSqlSafe(census);
  assertHistoricalCensusSqlSafe(order);
  assert.match(census.strings.join(" "), /MATERIALIZED/);
  assert.match(order.strings.join(" "), /"orderNumber" = /);
});

test("order numbers stay bounded", () => {
  assert.equal(isHistoricalOrderNumber("LO-1053"), true);
  assert.equal(isHistoricalOrderNumber("lo-1053"), false);
  assert.equal(isHistoricalOrderNumber("LO-1053;drop"), false);
  assert.equal(isHistoricalOrderNumber(""), false);
});

test("association contract separates ownership, resale, and preview", () => {
  assert.equal(HISTORICAL_ASSOCIATION_AUTH.auditCredentialAccepted, false);
  assert.equal(HISTORICAL_ASSOCIATION_AUTH.defaultEnabled, false);
  assert.equal(HISTORICAL_ASSOCIATION_AUTH.header, "x-sa360-admin-key");
  const routes = Object.values(HISTORICAL_ASSOCIATION_ROUTES);
  const paths = routes.map((route) => route.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(HISTORICAL_ASSOCIATION_ROUTES.ownershipPreview.registered, true);
  assert.equal(HISTORICAL_ASSOCIATION_ROUTES.ownershipConfirm.registered, false);
  assert.equal(HISTORICAL_ASSOCIATION_ROUTES.ownershipReassign.registered, false);
  assert.equal(HISTORICAL_ASSOCIATION_ROUTES.resalePreview.registered, false);
  assert.equal(HISTORICAL_ASSOCIATION_ROUTES.resaleConfirm.registered, false);
  assert.equal(HISTORICAL_ASSOCIATION_ROUTES.ownershipPreview.writesInventory, false);
  assert.equal(HISTORICAL_ASSOCIATION_ROUTES.ownershipPreview.confirmsOwnership, false);
  assert.equal(HISTORICAL_ASSOCIATION_ROUTES.ownershipPreview.confirmsResale, false);
  assert.equal(HISTORICAL_ASSOCIATION_ROUTES.ownershipConfirm.confirmsResale, false);
  assert.equal(HISTORICAL_ASSOCIATION_ROUTES.resaleConfirm.confirmsOwnership, false);
  assert.equal(HISTORICAL_ASSOCIATION_ROUTES.resaleConfirm.writesInventory, false);
  assert.notEqual(
    HISTORICAL_ASSOCIATION_ROUTES.ownershipConfirm.path,
    HISTORICAL_ASSOCIATION_ROUTES.resaleConfirm.path
  );
  assert.notEqual(
    HISTORICAL_ASSOCIATION_ROUTES.ownershipPreview.path,
    HISTORICAL_ASSOCIATION_ROUTES.ownershipConfirm.path
  );
});

function censusGroup(keyName: string, key: string, inventoryRows: number) {
  return {
    [keyName]: key,
    inventoryRows,
    distinctOriginalLabels: 1,
    unresolvedOriginRows: inventoryRows,
    stampedOriginRows: 0,
    consistentOriginalLabelRows: inventoryRows,
    missingAttributionRows: 0,
    conflictingAttributionRows: 0,
    reservedRows: 0,
  };
}

test("census assembly omits label text and withholds a broken partition", () => {
  const group = censusGroup("nicheKey", "vet", 2);
  const report = assembleHistoricalCensusReport({
    inventory_rows: 2n,
    unresolved_origin_rows: 2n,
    stamped_origin_rows: 0n,
    consistent_original_label_rows: 2n,
    missing_attribution_rows: 0n,
    conflicting_attribution_rows: 0n,
    rows_with_original_label: 2n,
    rows_missing_original_label: 0n,
    distinct_original_labels: 1n,
    labels_one: 0n,
    labels_two_to_ten: 1n,
    labels_eleven_to_one_hundred: 0n,
    labels_one_hundred_one_to_one_thousand: 0n,
    labels_over_one_thousand: 0n,
    largest_label_inventory_rows: 2n,
    open_allocation_rows: 0n,
    database_name: "sa360_test",
    server_address: "127.0.0.1",
    captured_at: new Date("2026-10-19T00:00:00.000Z"),
    by_niche: [group],
    by_lot: [censusGroup("lotKey", "lot_vet", 2)],
    by_niche_and_lot: [{ ...censusGroup("nicheKey", "vet", 2), lotKey: "lot_vet" }],
    by_import_request: [censusGroup("importRequest", "aged-bulk-vet", 2)],
    by_agreement: [censusGroup("agreement", "july_column_agrees", 2)],
    by_inventory_status: [censusGroup("status", "available", 2)],
    stamped_origin_clients: [],
    open_allocations_by_status: [],
    sourceCampaignName: "must not be copied",
  });
  assert.equal(JSON.stringify(report).includes("must not be copied"), false);
  assert.equal(report.population.inventoryRows, 2);
  assert.throws(
    () =>
      assembleHistoricalCensusReport({
        inventory_rows: 2n,
        unresolved_origin_rows: 1n,
        stamped_origin_rows: 0n,
        consistent_original_label_rows: 2n,
        missing_attribution_rows: 0n,
        conflicting_attribution_rows: 0n,
        rows_with_original_label: 2n,
        rows_missing_original_label: 0n,
        distinct_original_labels: 1n,
        labels_one: 0n,
        labels_two_to_ten: 1n,
        labels_eleven_to_one_hundred: 0n,
        labels_one_hundred_one_to_one_thousand: 0n,
        labels_over_one_thousand: 0n,
        largest_label_inventory_rows: 2n,
        open_allocation_rows: 0n,
        database_name: "sa360_test",
        server_address: "127.0.0.1",
        captured_at: new Date("2026-10-19T00:00:00.000Z"),
        by_niche: [],
        by_lot: [],
        by_niche_and_lot: [],
        by_import_request: [],
        by_agreement: [],
        by_inventory_status: [],
        stamped_origin_clients: [],
        open_allocations_by_status: [],
      }),
    /origin_partition/
  );
});

test("order assembly keeps an email-shaped account id and omits a missing order", () => {
  const missing = assembleHistoricalOrderReport({ order_rows: 0n }, "LO-1053");
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "historical_order_not_found");
  assert.equal(JSON.stringify(missing).includes("reservedRows"), false);

  const report = assembleHistoricalOrderReport(
    {
      order_rows: 1n,
      order_number: "LO-1053",
      order_status: "active",
      buyer_client_account_id: "buyer@example.test",
      database_name: "sa360_test",
      server_address: "127.0.0.1",
      captured_at: new Date("2026-10-19T00:00:00.000Z"),
      allocation_rows: 1n,
      reserved_rows: 1n,
      buyer_mismatch_rows: 0n,
      missing_inventory_rows: 0n,
      origin_equals_buyer_rows: 0n,
      origin_other_client_rows: 0n,
      origin_unstamped_rows: 1n,
      reserved_block_unresolved: 1n,
      reserved_block_same_origin: 0n,
      reserved_block_resale: 0n,
      reserved_outside_historical: 0n,
      reserved_block_missing: 0n,
      by_status: [{ status: "reserved", allocations: 1 }],
      by_provenance: [{ provenance: "unresolved_origin", allocations: 1 }],
      by_lot: [
        {
          lotKey: "lot_vet",
          allocations: 1,
          unresolvedOrigin: 1,
          originEqualsBuyer: 0,
          originOtherClient: 0,
          originUnstamped: 1,
        },
      ],
      export_packages: 0n,
      spreadsheet_delivered_packages: 0n,
      notify_by_status: [],
      instructions_by_status: [],
      replacements_by_status: [],
    },
    "LO-1053"
  );
  assert.equal(report.ok, true);
  if (report.ok) assert.equal(report.buyerClientAccountId, "buyer@example.test");
  assert.throws(
    () =>
      assembleHistoricalOrderReport(
        {
          order_rows: 1n,
          order_number: "LO-1053",
          order_status: "active",
          buyer_client_account_id: "buyer_1",
          database_name: "sa360_test",
          server_address: "127.0.0.1",
          captured_at: new Date("2026-10-19T00:00:00.000Z"),
          allocation_rows: 1n,
          reserved_rows: 1n,
          buyer_mismatch_rows: 0n,
          missing_inventory_rows: 0n,
          origin_equals_buyer_rows: 0n,
          origin_other_client_rows: 0n,
          origin_unstamped_rows: 1n,
          reserved_block_unresolved: 1n,
          reserved_block_same_origin: 0n,
          reserved_block_resale: 0n,
          reserved_outside_historical: 0n,
          reserved_block_missing: 0n,
          by_status: [{ status: "reserved", allocations: 1 }],
          by_provenance: [{ provenance: "lead@example.test", allocations: 1 }],
          by_lot: [
            {
              lotKey: "lot_vet",
              allocations: 1,
              unresolvedOrigin: 1,
              originEqualsBuyer: 0,
              originOtherClient: 0,
              originUnstamped: 1,
            },
          ],
          export_packages: 0n,
          spreadsheet_delivered_packages: 0n,
          notify_by_status: [],
          instructions_by_status: [],
          replacements_by_status: [],
        },
        "LO-1053"
      ),
    /unsafe_value/
  );
});
