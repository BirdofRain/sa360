import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatKpiDisplay } from "./lead-fulfillment-adapters.ts";

describe("overview metric display", () => {
  it("does not render a fake 0 when a metric is unavailable or not wired", () => {
    assert.equal(
      formatKpiDisplay({
        key: "freshHold",
        label: "Fresh tracked · 0–9 days · HOLD",
        value: null,
        availability: "unavailable",
      }),
      "Unavailable"
    );
    assert.equal(
      formatKpiDisplay({
        key: "deliveryFailures",
        label: "Delivery failures",
        value: null,
        availability: "not_wired",
      }),
      "Not wired"
    );
    assert.equal(
      formatKpiDisplay({
        key: "inventoryTracked",
        label: "Inventory tracked",
        value: 243056,
        availability: "ok",
      }),
      "243056"
    );
  });
});
