import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyStoredInventoryTracking } from "./inventory-tracking-diagnostic.js";

describe("classifyStoredInventoryTracking", () => {
  it("classifies created, reused, missing date, skipped, failed, and not attempted", () => {
    assert.equal(
      classifyStoredInventoryTracking({ inventoryTracking: { outcome: "created", inventoryItemId: "item_1" } })
        .diagnostic,
      "created"
    );
    const reused = classifyStoredInventoryTracking({
      inventoryTracking: { outcome: "reused_phone", inventoryItemId: "item_2" },
    });
    assert.equal(reused.diagnostic, "reused");
    assert.equal(reused.inventoryItemId, "item_2");
    assert.equal(reused.label, "Inventory reused");
    assert.equal(
      classifyStoredInventoryTracking({ inventoryTracking: { outcome: "generated_at_missing" } }).diagnostic,
      "generated_at_missing"
    );
    assert.equal(
      classifyStoredInventoryTracking({ inventoryTracking: { outcome: "skipped_not_resale_supply" } }).diagnostic,
      "skipped"
    );
    assert.equal(
      classifyStoredInventoryTracking({
        inventoryTracking: { outcome: "inventory_tracking_failed", ok: false },
      }).diagnostic,
      "failed"
    );
    assert.equal(classifyStoredInventoryTracking({ intakeStage: "inventory_only" }).diagnostic, "not_attempted");
  });

  it("does not echo an unknown outcome that contains sensitive text", () => {
    const secret = "buyer@secret.example +15551212999";
    const classified = classifyStoredInventoryTracking({
      inventoryTracking: {
        outcome: secret,
        inventoryItemId: "not a safe id user@email.test",
        nested: { phone: "+15551212999" },
      },
    });
    assert.equal(classified.diagnostic, "unrecognized");
    assert.equal(classified.outcome, null);
    assert.equal(classified.inventoryItemId, null);
    assert.equal(classified.label, "Unrecognized tracking outcome");
    const encoded = JSON.stringify(classified);
    assert.equal(encoded.includes("buyer@secret.example"), false);
    assert.equal(encoded.includes("+15551212999"), false);
    assert.equal(encoded.includes("user@email.test"), false);
    assert.equal(
      classifyStoredInventoryTracking({
        inventoryTracking: { outcome: "reused_phone_extra_secret@example.test" },
      }).diagnostic,
      "unrecognized"
    );
    assert.equal(
      classifyStoredInventoryTracking({
        inventoryTracking: { outcome: "skipped_custom_note" },
      }).diagnostic,
      "unrecognized"
    );
  });
});
