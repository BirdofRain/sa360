import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  findSelectableBucket,
  formatUsdFromCents,
  type PplPricingCatalog,
} from "./ppl-pricing-catalog.ts";

const catalog: PplPricingCatalog = {
  pricingVersion: "ppl_aged_beta_2026_08_v1",
  activeAgedBuckets: [
    {
      key: "COMMERCE_3_6_MO",
      label: "3–6 Months",
      minDaysInclusive: 90,
      maxDaysExclusive: 180,
      unitPriceCents: 777,
      status: "active",
    },
  ],
  holdBuckets: [
    {
      key: "FRESH",
      label: "Fresh",
      minDaysInclusive: 0,
      maxDaysExclusive: 10,
      status: "HOLD",
    },
    {
      key: "SEMI_FRESH",
      label: "Semi-Fresh",
      minDaysInclusive: 10,
      maxDaysExclusive: 30,
      status: "HOLD",
    },
  ],
};

describe("ppl pricing catalog authority", () => {
  it("uses server catalog cents and never a local hardcoded registry", () => {
    const selected = findSelectableBucket(catalog, "COMMERCE_3_6_MO");
    assert.equal(selected?.unitPriceCents, 777);
    assert.equal(formatUsdFromCents(selected!.unitPriceCents), "$7.77");
    assert.equal(findSelectableBucket(catalog, "FRESH"), null);
    assert.equal(findSelectableBucket(null, "COMMERCE_3_6_MO"), null);
  });

  it("workbench source does not contain a hardcoded cents authority table", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const workbench = readFileSync(
      join(here, "../../components/fulfillment-ops/fulfillment-ops-workbench.tsx"),
      "utf8"
    );
    assert.doesNotMatch(workbench, /unitPriceCents:\s*600/);
    assert.doesNotMatch(workbench, /AGED_BUCKET_OPTIONS/);
  });
});
