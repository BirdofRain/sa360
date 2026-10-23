import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPortalAgeUnionOrderLine } from "./ppl-order-pricing.js";
import {
  assessPortalAgeUnionRelease,
  quotePortalAgeUnionDeliveredCharge,
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

  it("rejects a review stamp after quantity, niche, states, or rates change", async () => {
    const line = unionLine();
    const db = {
      leadOrder: { findUnique: async () => ({ id: "ord_union" }) },
      leadOrderLine: {
        findMany: async () => [line],
        update: async (input: { data: { metadataJson: Record<string, unknown> } }) => {
          (line as { metadataJson: unknown }).metadataJson = input.data.metadataJson;
          return line;
        },
      },
    };
    const reviewed = await recordPortalAgeUnionPriceReview("ord_union", "alex", db as never);
    assert.equal(reviewed.ok, true);
    const metadata = () => line.metadataJson as {
      constituentUnitPriceCents: Record<string, number>;
      priceReviewedBy?: string;
      priceReviewFingerprint?: string;
    };

    line.requestedQuantity = 9;
    const quantityDrift = assessPortalAgeUnionRelease([line]);
    assert.equal(quantityDrift.status, "review_required");
    if (quantityDrift.status === "review_required") assert.equal(quantityDrift.stale, true);
    line.requestedQuantity = 8;

    line.nicheKey = "mortgage";
    const nicheDrift = assessPortalAgeUnionRelease([line]);
    assert.equal(nicheDrift.status, "review_required");
    line.nicheKey = "vet";

    line.normalizedStatesJson = ["TX"];
    const stateDrift = assessPortalAgeUnionRelease([line]);
    assert.equal(stateDrift.status, "review_required");
    line.normalizedStatesJson = ["TX", "FL"];

    metadata().constituentUnitPriceCents = {
      ...metadata().constituentUnitPriceCents,
      COMMERCE_6_9_MO: 250,
    };
    const rateDrift = assessPortalAgeUnionRelease([line]);
    assert.equal(rateDrift.status, "review_required");
    if (rateDrift.status === "review_required") assert.equal(rateDrift.stale, true);

    const rerecorded = await recordPortalAgeUnionPriceReview("ord_union", "sam", db as never);
    assert.equal(rerecorded.ok, true);
    if (rerecorded.ok) {
      assert.equal(rerecorded.alreadyReviewed, false);
      assert.equal(rerecorded.priceReviewedBy, "sam");
      assert.equal(rerecorded.unitPriceCents, null);
    }
    const again = assessPortalAgeUnionRelease([line]);
    assert.equal(again.status, "reviewed");
    if (again.status === "reviewed") {
      assert.equal(again.constituentUnitPriceCents.COMMERCE_6_9_MO, 250);
      assert.equal(again.priceReviewedBy, "sam");
      assert.equal(metadata().priceReviewFingerprint, again.priceReviewFingerprint);
    }

    line.maxAgeDays = 400;
    assert.equal(assessPortalAgeUnionRelease([line]).status, "invalid_price");
    const refused = await recordPortalAgeUnionPriceReview("ord_union", "sam", db as never);
    assert.deepEqual(refused, { ok: false, code: "union_price_invalid" });
  });

  it("prices a 6–12 release from delivered inventory age and reviewed rates", () => {
    const evaluatedAt = new Date("2026-10-22T00:00:00.000Z");
    const day = 24 * 60 * 60 * 1000;
    const atAge = (days: number) => new Date(evaluatedAt.getTime() - days * day);
    const rates = { COMMERCE_6_9_MO: 300, COMMERCE_9_12_MO: 200 };
    const quoted = quotePortalAgeUnionDeliveredCharge({
      generatedAts: [atAge(200), atAge(200), atAge(300)],
      constituentUnitPriceCents: rates,
      evaluatedAt,
    });
    assert.deepEqual(quoted, {
      ok: true,
      deliveredConstituentCounts: { COMMERCE_6_9_MO: 2, COMMERCE_9_12_MO: 1 },
      deliveredChargeCents: 800,
      chargeBasis: "delivered_quantity_times_reviewed_constituent_rate",
    });

    const onlyOlder = quotePortalAgeUnionDeliveredCharge({
      generatedAts: [atAge(270), atAge(364)],
      constituentUnitPriceCents: rates,
      evaluatedAt,
    });
    assert.equal(onlyOlder.ok, true);
    if (onlyOlder.ok) {
      assert.deepEqual(onlyOlder.deliveredConstituentCounts, {
        COMMERCE_6_9_MO: 0,
        COMMERCE_9_12_MO: 2,
      });
      assert.equal(onlyOlder.deliveredChargeCents, 400);
    }

    for (const days of [40, 179, 365, 400]) {
      const outside = quotePortalAgeUnionDeliveredCharge({
        generatedAts: [atAge(200), atAge(days)],
        constituentUnitPriceCents: rates,
        evaluatedAt,
      });
      assert.equal(outside.ok, false);
      if (!outside.ok) assert.equal(outside.code, "union_delivered_age_mismatch");
    }
    const missingInventory = quotePortalAgeUnionDeliveredCharge({
      generatedAts: [null],
      constituentUnitPriceCents: rates,
      evaluatedAt,
    });
    assert.equal(missingInventory.ok, false);
  });
});
