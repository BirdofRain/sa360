import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import {
  facetsSingleFlightSizeForTests,
  normalizeFacetsFlightKey,
  resetFacetsSingleFlightForTests,
  runFacetsSingleFlight,
} from "./lead-inventory-facets-single-flight.js";

test("normalizeFacetsFlightKey is stable and omits empty values", () => {
  assert.equal(
    normalizeFacetsFlightKey({ nicheKey: "vet", status: undefined, lotId: "" }),
    normalizeFacetsFlightKey({ nicheKey: "vet" })
  );
  assert.notEqual(
    normalizeFacetsFlightKey({ nicheKey: "vet" }),
    normalizeFacetsFlightKey({ nicheKey: "solar" })
  );
});

test("runFacetsSingleFlight clears rejected work", async () => {
  resetFacetsSingleFlightForTests();
  await assert.rejects(() =>
    runFacetsSingleFlight("k1", async () => {
      throw new Error("boom");
    })
  );
  assert.equal(facetsSingleFlightSizeForTests(), 0);

  const value = await runFacetsSingleFlight("k1", async () => {
    await sleep(5);
    return 42;
  });
  assert.equal(value, 42);
  assert.equal(facetsSingleFlightSizeForTests(), 0);
});
