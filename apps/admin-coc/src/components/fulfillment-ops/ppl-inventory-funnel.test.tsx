import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, render } from "@testing-library/react";

import type { InventorySelectionFunnelReport } from "@/lib/fulfillment-ops/client-api";
import { PplInventoryFunnelPanel } from "./ppl-inventory-funnel.tsx";

const report: InventorySelectionFunnelReport = {
  orderId: "ord_lo1055",
  orderNumber: "LO-1055",
  nicheKey: "vet",
  nicheDisplayName: "Veteran",
  nicheAliases: ["vet", "veteran", "vet_fex", "n_vet", "n_veteran"],
  nicheMatchPolicy: "commerce_niche_aliases",
  states: ["IN", "SC", "AZ"],
  commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
  ageDayRanges: [{ minDaysInclusive: 30, maxDaysExclusive: 90 }],
  requestedQuantity: 85,
  evaluatedAt: "2026-10-05T00:00:00.000Z",
  stages: {
    nicheMatch: 120,
    states: 90,
    ageBucket: 80,
    inventoryClassAged: 80,
    activeLot: 70,
    status: { available: 10, pending_review: 55, reserved: 3, committed: 2, other: 0 },
    commerceExcludedAt: { set: 1, null: 69 },
    commerceIncluded: 9,
    validIdentity: 8,
    invalidIdentity: 1,
    buyerReady: {
      ready: 2,
      rejected: 6,
      missing_consumer_age: 6,
      first_name_too_short: 0,
      last_name_too_short: 0,
      first_name_multipart: 0,
      last_name_multipart: 0,
    },
    protectedAgentExcluded: 0,
    afterProtectedAgent: 2,
    originClientExcluded: 0,
    afterOriginClient: 2,
    sameBuyerPriorDelivery: 0,
    afterSameBuyer: 2,
    withinSelectionDuplicate: 0,
    finalEligible: 2,
  },
  otherwiseEligibleBlockedByMissingConsumerAge: 0,
  eligibleMissingConsumerAge: 6,
  recoverableStoredConsumerAge: 0,
  noStoredConsumerAge: 6,
  pendingReviewConsumerAge: {
    scanned: 55,
    normalizedReadable: 0,
    recoverableFromStoredSource: 0,
    noStoredConsumerAge: 55,
  },
  agedImportFieldLoss: {
    summary: "Historical aged CSV commits omitted consumer age.",
    historicalCanonicalMappingOmittedConsumerAge: true,
    currentCanonicalMappingSupportsConsumerAge: true,
    historicalRawPayloadRetainsSourceCells: false,
    historicalInitialStatus: "pending_review",
  },
  causes: {
    inventoryActivation: true,
    importFieldLoss: false,
    buyerReadyPolicy: false,
  },
  primaryDisappearance: "status_pending_review",
  summary: "Eligible inventory is short of the requested quantity. Largest drop: status pending review.",
  cohortScanTruncated: false,
};

describe("PplInventoryFunnelPanel", () => {
  afterEach(() => cleanup());

  it("explains a shortage without rendering lead payloads", () => {
    const { container } = render(<PplInventoryFunnelPanel report={report} />);
    const text = container.textContent ?? "";
    assert.match(text, /Inventory funnel/);
    assert.match(text, /Pending review/);
    assert.match(text, /Missing consumer age \(informational\)/);
    assert.match(text, /Eligible without consumer age/);
    assert.match(text, /vet, veteran, vet_fex/);
    assert.match(text, /IN, SC, AZ/);
    assert.match(text, /Causes: inventory activation/);
    assert.equal(text.includes("buyer-ready policy"), false);
    assert.equal(text.includes("@"), false);
    assert.equal(text.includes("+1"), false);
  });
});
