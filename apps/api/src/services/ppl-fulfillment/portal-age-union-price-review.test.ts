import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPortalAgeUnionOrderLine } from "./ppl-order-pricing.js";
import {
  assessPortalAgeUnionRelease,
  recordPortalAgeUnionPriceReview,
  snapshotPricedPplFromOrderLines,
} from "./ppl-order-pricing.js";

function unionLine(overrides: Record<string, unknown> = {}) {
  const built = buildPortalAgeUnionOrderLine({
    nicheKey: "vet",
    states: ["TX", "FL"],
    requestedQuantity: 8,
  });
  assert.equal(built.ok, true);
  if (!built.ok) throw new Error("union line");
  return {
    id: "line_union",
    ...built.data,
    ...overrides,
  };
}

describe("portal 6–12 price review", () => {
  it("does not snapshot a missing, zero, or single union price", () => {
    const missing = unionLine();
    const zero = unionLine({ unitPriceCents: 0, lineTotalCents: 0 });
    const single = unionLine({ unitPriceCents: 300, lineTotalCents: 2400 });
    assert.equal(snapshotPricedPplFromOrderLines([missing]), null);
    assert.equal(snapshotPricedPplFromOrderLines([zero]), null);
    assert.equal(snapshotPricedPplFromOrderLines([single]), null);
    assert.equal(assessPortalAgeUnionRelease([missing]).status, "review_required");
    assert.equal(assessPortalAgeUnionRelease([zero]).status, "invalid_price");
    assert.equal(assessPortalAgeUnionRelease([single]).status, "invalid_price");
  });

  it("records constituent review without writing a unit price", async () => {
    const line = unionLine();
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      leadOrder: { findUnique: async () => ({ id: "ord_union" }) },
      leadOrderLine: {
        findMany: async () => [line],
        update: async (input: { data: { metadataJson: Record<string, unknown> } }) => {
          updates.push(input.data);
          (line as { metadataJson: unknown }).metadataJson = input.data.metadataJson;
          return line;
        },
      },
    };

    const reviewed = await recordPortalAgeUnionPriceReview("ord_union", "  alex  ", db as never);
    assert.equal(reviewed.ok, true);
    if (!reviewed.ok) return;
    assert.equal(reviewed.unitPriceCents, null);
    assert.equal(reviewed.priceReviewedBy, "alex");
    assert.equal(reviewed.alreadyReviewed, false);
    assert.equal("unitPriceCents" in (updates[0] ?? {}), false);
    assert.equal(line.unitPriceCents, null);
    assert.equal(line.lineTotalCents, null);
    const assessment = assessPortalAgeUnionRelease([line]);
    assert.equal(assessment.status, "reviewed");
    if (assessment.status === "reviewed") {
      assert.equal(assessment.constituentUnitPriceCents.COMMERCE_6_9_MO, 300);
      assert.equal(assessment.constituentUnitPriceCents.COMMERCE_9_12_MO, 200);
    }

    const again = await recordPortalAgeUnionPriceReview("ord_union", "sam", db as never);
    assert.equal(again.ok, true);
    if (again.ok) {
      assert.equal(again.alreadyReviewed, true);
      assert.equal(again.priceReviewedBy, "alex");
      assert.equal(again.unitPriceCents, null);
    }
    assert.equal(updates.length, 1);
  });

  it("refuses review when a numeric price is already stored", async () => {
    const line = unionLine({ unitPriceCents: 0, lineTotalCents: 0 });
    let updated = false;
    const db = {
      leadOrder: { findUnique: async () => ({ id: "ord_union" }) },
      leadOrderLine: {
        findMany: async () => [line],
        update: async () => {
          updated = true;
          return line;
        },
      },
    };
    const result = await recordPortalAgeUnionPriceReview("ord_union", "alex", db as never);
    assert.deepEqual(result, { ok: false, code: "union_price_invalid" });
    assert.equal(updated, false);
    assert.deepEqual(
      await recordPortalAgeUnionPriceReview("ord_union", "   ", db as never),
      { ok: false, code: "reviewer_required" }
    );
  });
});
