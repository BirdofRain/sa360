import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computePartialFulfillmentEconomics } from "./partial-fulfillment-economics.js";

describe("partial fulfillment economics", () => {
  it("computes requested / delivered / potential credit for confirmed shortfall", () => {
    const economics = computePartialFulfillmentEconomics({
      requestedQuantity: 100,
      selectedQuantity: 87,
      unitPriceCents: 400,
    });
    assert.equal(economics.requestedOrderValueCents, 40_000);
    assert.equal(economics.deliveredValueCents, 34_800);
    assert.equal(economics.potentialCreditCents, 5_200);
    assert.equal(economics.creditStatus, "confirmed_shortfall");
  });

  it("does not confirm credit when scan limit reached", () => {
    const economics = computePartialFulfillmentEconomics({
      requestedQuantity: 100,
      selectedQuantity: 40,
      unitPriceCents: 400,
      scanLimitReached: true,
    });
    assert.equal(economics.potentialCreditCents, null);
    assert.equal(economics.creditStatus, "search_incomplete");
  });
});
