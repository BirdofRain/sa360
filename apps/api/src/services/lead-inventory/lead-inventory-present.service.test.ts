import { test } from "node:test";
import assert from "node:assert/strict";

import { presentInventoryItemListRow } from "./lead-inventory-present.service.js";

test("inventory list row exposes masked identifier only", () => {
  const row = presentInventoryItemListRow({
    id: "clinv_abc123",
    maskedItemId: "inv***abc",
    normalizedState: "TX",
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ageDays: 10,
    ageBandKey: "RECENT_8_30",
    inventoryClass: "aged",
    sourceLane: "life_agent_launch",
    lotDisplayName: "Lot A",
    lotId: "lot-1",
    proofStatus: "ready",
    verificationStatus: "passed",
    itemStatus: "available",
    reservationStatus: "none",
    available: true,
    blockers: [],
  });

  assert.equal(row.maskedItemId, "inv***abc");
  assert.equal("inventoryItemId" in row, false);
  assert.equal("name" in row, false);
  assert.equal("email" in row, false);
  assert.equal("phone" in row, false);
});
