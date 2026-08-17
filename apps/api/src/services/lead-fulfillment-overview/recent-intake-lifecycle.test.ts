import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveRecentIntakeLifecycle,
  isGeneratedAtMissingFromEnrichment,
} from "./recent-intake-lifecycle.js";

const evaluatedAt = new Date("2026-08-17T12:00:00.000Z");

describe("deriveRecentIntakeLifecycle", () => {
  it("returns INTAKE ONLY when the source event has no inventory item", () => {
    assert.equal(
      deriveRecentIntakeLifecycle({
        hasInventoryItem: false,
        generatedAtMissing: false,
        evaluatedAt,
      }),
      "INTAKE_ONLY"
    );
  });

  it("returns DATE MISSING when tracking recorded generated_at_missing", () => {
    assert.equal(
      deriveRecentIntakeLifecycle({
        hasInventoryItem: false,
        generatedAtMissing: true,
        evaluatedAt,
      }),
      "DATE_MISSING"
    );
    assert.equal(
      isGeneratedAtMissingFromEnrichment({
        inventoryTracking: { outcome: "generated_at_missing" },
      }),
      true
    );
  });

  it("returns FRESH HOLD for a Meta-aged 3-day available item", () => {
    assert.equal(
      deriveRecentIntakeLifecycle({
        hasInventoryItem: true,
        generatedAtMissing: false,
        inventoryStatus: "available",
        generatedAt: new Date("2026-08-14T12:00:00.000Z"),
        evaluatedAt,
      }),
      "FRESH_HOLD"
    );
  });

  it("returns SEMI-FRESH HOLD for a 15-day LeadCapture item", () => {
    assert.equal(
      deriveRecentIntakeLifecycle({
        hasInventoryItem: true,
        generatedAtMissing: false,
        inventoryStatus: "pending_review",
        generatedAt: new Date("2026-08-02T12:00:00.000Z"),
        evaluatedAt,
      }),
      "SEMI_FRESH_HOLD"
    );
  });

  it("does not show Aged Available for a 35-day pending_review lead", () => {
    const lifecycle = deriveRecentIntakeLifecycle({
      hasInventoryItem: true,
      generatedAtMissing: false,
      inventoryStatus: "pending_review",
      generatedAt: new Date("2026-07-13T12:00:00.000Z"),
      evaluatedAt,
    });
    assert.equal(lifecycle, "AGED_BLOCKED_REVIEW");
    assert.notEqual(lifecycle, "AGED_AVAILABLE");
  });

  it("returns AGED AVAILABLE only when status is available and age >= 30", () => {
    assert.equal(
      deriveRecentIntakeLifecycle({
        hasInventoryItem: true,
        generatedAtMissing: false,
        inventoryStatus: "available",
        generatedAt: new Date("2026-06-01T12:00:00.000Z"),
        evaluatedAt,
      }),
      "AGED_AVAILABLE"
    );
  });
});
