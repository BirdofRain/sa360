import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { clientFetchPplPricingCatalog } from "./client-api.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("clientFetchPplPricingCatalog", () => {
  it("loads catalog through the Admin C.O.C. pricing proxy", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      assert.equal(String(input), "/api/fulfillment-ops/ppl-pricing");
      return new Response(
        JSON.stringify({
          ok: true,
          catalog: {
            pricingVersion: "ppl_aged_beta_2026_08_v1",
            activeAgedBuckets: [
              {
                key: "COMMERCE_1_3_MO",
                label: "1–3 Months",
                minDaysInclusive: 30,
                maxDaysExclusive: 90,
                unitPriceCents: 600,
                status: "active",
              },
            ],
            holdBuckets: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await clientFetchPplPricingCatalog();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.pricingVersion, "ppl_aged_beta_2026_08_v1");
      assert.equal(result.data.activeAgedBuckets[0]?.unitPriceCents, 600);
    }
  });

  it("fails closed when the proxy has no catalog", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: "down" }), {
        status: 502,
      })) as typeof fetch;
    const result = await clientFetchPplPricingCatalog();
    assert.equal(result.ok, false);
  });
});
