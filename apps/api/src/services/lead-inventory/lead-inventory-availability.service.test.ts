import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateLeadInventoryAvailability } from "./lead-inventory-availability.service.js";
import { DEFAULT_AGE_BANDS_V1 } from "./lead-inventory.constants.js";

const baseItem = {
  id: "item_1",
  status: "available" as const,
  generatedAt: new Date("2026-07-01T00:00:00.000Z"),
  normalizedState: "TX",
  inventoryClass: "aged" as const,
  nicheKey: "VET",
  maxFulfillments: 1,
  fulfillmentCount: 0,
  quarantineReason: null,
  withdrawnAt: null,
  expiredAt: null,
};

const baseEvent = {
  sourceProvider: "leadcapture_io" as const,
  sourceSystem: "leadcapture_io_legacy" as const,
  normalizedPayloadJson: {
    phone_e164: "+15550103903",
    email: "masked@example.com",
    state: "Texas",
    contact: { lead_uid: "uid-1" },
  },
  enrichmentMetadataJson: null,
};

test("ready inventory item is available when evidence passes", () => {
  const result = evaluateLeadInventoryAvailability({
    item: baseItem,
    lot: { status: "active" },
    sourceLeadEvent: baseEvent,
    leadProof: { proofStatus: "PROOF_ATTACHED" },
    verification: { verificationStatus: "PASSED", duplicateStatus: "UNIQUE" },
    activeAllocations: [],
    ageBands: DEFAULT_AGE_BANDS_V1,
    evaluatedAt: new Date("2026-07-10T00:00:00.000Z"),
  });
  assert.equal(result.available, true);
  assert.equal(result.blockers.length, 0);
});

test("missing proof blocks availability", () => {
  const result = evaluateLeadInventoryAvailability({
    item: baseItem,
    lot: { status: "active" },
    sourceLeadEvent: baseEvent,
    leadProof: { proofStatus: "PROOF_MISSING" },
    verification: { verificationStatus: "PASSED", duplicateStatus: "UNIQUE" },
    activeAllocations: [],
    ageBands: DEFAULT_AGE_BANDS_V1,
    evaluatedAt: new Date("2026-07-10T00:00:00.000Z"),
  });
  assert.equal(result.available, false);
  assert.ok(result.blockers.includes("proof_not_ready"));
});

test("active reservation and lot pause block availability", () => {
  const reserved = evaluateLeadInventoryAvailability({
    item: baseItem,
    lot: { status: "active" },
    sourceLeadEvent: baseEvent,
    leadProof: { proofStatus: "PROOF_ATTACHED" },
    verification: { verificationStatus: "PASSED", duplicateStatus: "UNIQUE" },
    activeAllocations: [{ status: "reserved" }],
    ageBands: DEFAULT_AGE_BANDS_V1,
    evaluatedAt: new Date("2026-07-10T00:00:00.000Z"),
  });
  assert.ok(reserved.blockers.includes("active_reservation"));

  const pausedLot = evaluateLeadInventoryAvailability({
    item: baseItem,
    lot: { status: "paused" },
    sourceLeadEvent: baseEvent,
    leadProof: { proofStatus: "PROOF_ATTACHED" },
    verification: { verificationStatus: "PASSED", duplicateStatus: "UNIQUE" },
    activeAllocations: [],
    ageBands: DEFAULT_AGE_BANDS_V1,
    evaluatedAt: new Date("2026-07-10T00:00:00.000Z"),
  });
  assert.ok(pausedLot.blockers.includes("lot_not_active"));
});
