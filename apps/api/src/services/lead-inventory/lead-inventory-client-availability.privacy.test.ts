import { test } from "node:test";
import assert from "node:assert/strict";

import { CLIENT_LEADS_ON_DEMAND_CATALOG_SCOPE } from "./lead-inventory-client-availability.service.js";

test("client catalog scope is global and exposes no internal valuation fields", async () => {
  const payload = {
    catalogScope: CLIENT_LEADS_ON_DEMAND_CATALOG_SCOPE,
    rows: [
      {
        nicheKey: "VET",
        productType: null,
        state: "NC",
        ageBandLabel: "0–7 days",
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        availabilityLabel: "Available",
        unitPriceCents: null,
        evaluatedAt: "2026-07-15T00:00:00.000Z",
      },
    ],
    evaluatedAt: "2026-07-15T00:00:00.000Z",
  };

  const serialized = JSON.stringify(payload);
  assert.equal(payload.catalogScope, "global_lal_inventory");
  assert.equal(payload.rows[0]?.unitPriceCents, null);
  assert.equal(serialized.includes("internalValueCents"), false);
  assert.equal(serialized.includes("acquisitionCostCents"), false);
  assert.equal(serialized.includes("inventoryItemId"), false);
  assert.equal(serialized.includes("sourceLeadEventId"), false);
});
