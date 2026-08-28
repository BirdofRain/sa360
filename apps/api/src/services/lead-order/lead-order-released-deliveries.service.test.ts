import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ReleasedLeadDeliveryExportPackageRow } from "../../repositories/lead-delivery-export-package.repository.js";
import {
  getClientReleasedDeliveryDownload,
  listClientReleasedDeliveries,
} from "./lead-order-released-deliveries.service.js";

const ownerOrder = {
  id: "ord_1",
  clientAccountId: "acct_a",
  orderNumber: "LO-1001",
};

function releasedRow(
  overrides: Partial<ReleasedLeadDeliveryExportPackageRow> = {}
): ReleasedLeadDeliveryExportPackageRow {
  return {
    id: "pkg_released",
    leadOrderId: "ord_1",
    clientAccountId: "acct_a",
    rowCount: 3,
    csvContent: "first_name,last_name\nAda,Lovelace\n",
    spreadsheetDeliveredAt: new Date("2026-08-20T15:00:00.000Z"),
    createdAt: new Date("2026-08-19T12:00:00.000Z"),
    metadataJson: { niche: "vet", commerceAgeBucketKey: "COMMERCE_3_6_MO" },
    leadOrder: {
      orderNumber: "LO-1001",
      clientDisplayName: "Valley Vet",
      nicheKey: "vet",
      statesJson: ["TX"],
    },
    ...overrides,
  };
}

describe("listClientReleasedDeliveries", () => {
  it("returns null when the tenant does not own the order", async () => {
    const result = await listClientReleasedDeliveries(
      { orderId: "ord_1", clientAccountId: "acct_b" },
      {
        findLeadOrderByIdImpl: async () => ownerOrder as never,
        listReleasedLeadDeliveryExportPackagesForOrderImpl: async () => {
          throw new Error("must not list packages for a foreign tenant");
        },
      }
    );
    assert.equal(result, null);
  });

  it("omits generated/unreleased packages and lists only released rows", async () => {
    const listed: Array<{ leadOrderId: string; clientAccountId: string }> = [];
    const result = await listClientReleasedDeliveries(
      { orderId: "ord_1", clientAccountId: "acct_a" },
      {
        findLeadOrderByIdImpl: async () => ownerOrder as never,
        listReleasedLeadDeliveryExportPackagesForOrderImpl: async (input) => {
          listed.push(input);
          return [
            releasedRow({ id: "pkg_a", rowCount: 10 }),
            releasedRow({
              id: "pkg_b",
              rowCount: 5,
              spreadsheetDeliveredAt: new Date("2026-08-21T12:00:00.000Z"),
            }),
          ];
        },
      }
    );
    assert.ok(result);
    assert.deepEqual(
      result.items.map((item) => item.id),
      ["pkg_a", "pkg_b"]
    );
    assert.equal(result.items[0]?.leadCount, 10);
    assert.equal(result.items[1]?.leadCount, 5);
    assert.deepEqual(listed, [{ leadOrderId: "ord_1", clientAccountId: "acct_a" }]);
  });
});

describe("getClientReleasedDeliveryDownload", () => {
  it("returns persisted CSV bytes for an owned released package", async () => {
    const result = await getClientReleasedDeliveryDownload(
      { orderId: "ord_1", exportId: "pkg_released", clientAccountId: "acct_a" },
      {
        findLeadOrderByIdImpl: async () => ownerOrder as never,
        findReleasedLeadDeliveryExportPackageForClientImpl: async () => releasedRow(),
      }
    );
    assert.ok(result);
    assert.equal(result.contentType, "text/csv; charset=utf-8");
    assert.equal(result.csv, "first_name,last_name\nAda,Lovelace\n");
    assert.equal(result.item.downloadAvailable, true);
    assert.match(result.filename, /\.csv$/);
  });

  it("returns null for another tenant, missing package, or unreleased lookup", async () => {
    const foreign = await getClientReleasedDeliveryDownload(
      { orderId: "ord_1", exportId: "pkg_released", clientAccountId: "acct_b" },
      {
        findLeadOrderByIdImpl: async () => ownerOrder as never,
        findReleasedLeadDeliveryExportPackageForClientImpl: async () => {
          throw new Error("must not load package for a foreign tenant");
        },
      }
    );
    assert.equal(foreign, null);

    const missing = await getClientReleasedDeliveryDownload(
      { orderId: "ord_1", exportId: "pkg_missing", clientAccountId: "acct_a" },
      {
        findLeadOrderByIdImpl: async () => ownerOrder as never,
        findReleasedLeadDeliveryExportPackageForClientImpl: async () => null,
      }
    );
    assert.equal(missing, null);
  });
});
