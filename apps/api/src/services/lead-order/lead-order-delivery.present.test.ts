import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ReleasedLeadDeliveryExportPackageRow } from "../../repositories/lead-delivery-export-package.repository.js";
import {
  assertClientReleasedDeliveryIsSafe,
  presentClientReleasedDelivery,
} from "./lead-order-delivery.present.js";

function releasedRow(
  overrides: Partial<ReleasedLeadDeliveryExportPackageRow> = {}
): ReleasedLeadDeliveryExportPackageRow {
  return {
    id: "pkg_released",
    leadOrderId: "ord_1",
    clientAccountId: "acct_a",
    rowCount: 25,
    csvContent: "first_name,last_name\nAda,Lovelace\n",
    spreadsheetDeliveredAt: new Date("2026-08-20T15:00:00.000Z"),
    createdAt: new Date("2026-08-19T12:00:00.000Z"),
    metadataJson: {
      schema: "buyer_csv_export_metadata_v1",
      niche: "vet",
      commerceAgeBucketKey: "COMMERCE_3_6_MO",
    },
    leadOrder: {
      orderNumber: "LO-1001",
      clientDisplayName: "Valley Vet",
      nicheKey: "vet",
      statesJson: ["TX"],
    },
    ...overrides,
  };
}

describe("presentClientReleasedDelivery", () => {
  it("returns only customer-safe released metadata", () => {
    const item = presentClientReleasedDelivery(releasedRow());
    assert.equal(item.id, "pkg_released");
    assert.equal(item.orderId, "ord_1");
    assert.equal(item.releasedAt, "2026-08-20T15:00:00.000Z");
    assert.equal(item.leadCount, 25);
    assert.equal(item.downloadAvailable, true);
    assert.match(item.filename, /\.csv$/);
    assert.equal(item.displayFilename, item.filename);
    assertClientReleasedDeliveryIsSafe(item as unknown as Record<string, unknown>);
    assert.equal(Object.hasOwn(item, "csvContent"), false);
    assert.equal(Object.hasOwn(item, "allocationIds"), false);
    assert.equal(Object.hasOwn(item, "idempotencyKey"), false);
    assert.equal(Object.hasOwn(item, "createdBy"), false);
    assert.equal(Object.hasOwn(item, "spreadsheetDeliveredBy"), false);
  });

  it("preserves multiple packages as distinct customer-safe rows", () => {
    const first = presentClientReleasedDelivery(releasedRow({ id: "pkg_a", rowCount: 10 }));
    const second = presentClientReleasedDelivery(
      releasedRow({
        id: "pkg_b",
        rowCount: 15,
        spreadsheetDeliveredAt: new Date("2026-08-21T15:00:00.000Z"),
      })
    );
    assert.equal(first.id, "pkg_a");
    assert.equal(second.id, "pkg_b");
    assert.equal(first.leadCount, 10);
    assert.equal(second.leadCount, 15);
    assert.notEqual(first.releasedAt, second.releasedAt);
  });
});
