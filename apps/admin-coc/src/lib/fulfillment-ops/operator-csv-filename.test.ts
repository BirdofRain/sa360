import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildOperatorBuyerCsvFilename } from "./operator-csv-filename.ts";

describe("Admin C.O.C. operator CSV filename", () => {
  it("includes client/order/niche/state/bucket/count safely", () => {
    const filename = buildOperatorBuyerCsvFilename({
      clientDisplayName: "Smart Agent 360 Demo",
      orderNumber: "LO-1048",
      nicheKey: "VET",
      states: ["NC"],
      commerceAgeBucketKey: "COMMERCE_9_12_MO",
      rowCount: 1,
    });
    assert.equal(filename, "Smart-Agent-360-Demo_LO-1048_VET_NC_9-12mo_1-lead.csv");
    assert.match(filename, /^[A-Za-z0-9._-]+\.csv$/);
  });

  it("matches the API golden Buyer Co vector", () => {
    assert.equal(
      buildOperatorBuyerCsvFilename({
        clientDisplayName: "Buyer Co",
        orderNumber: "LO-9",
        nicheKey: "vet",
        states: ["NC"],
        commerceAgeBucketKey: "COMMERCE_3_6_MO",
        rowCount: 2,
      }),
      "Buyer-Co_LO-9_VET_NC_3-6mo_2-leads.csv"
    );
  });
});
