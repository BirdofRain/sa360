import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_AGE_BANDS_V1 } from "../lead-inventory/lead-inventory.constants.js";
import { assessLeadInventoryActivationEligibility } from "./lead-inventory-review-eligibility.service.js";

const baseItem = {
  id: "item_1",
  status: "pending_review" as const,
  generatedAt: new Date("2026-06-01T00:00:00.000Z"),
  normalizedState: "TX",
  nicheKey: "vet",
  productType: "aged",
  sourceProvider: "manual_import" as const,
  sourceLane: "aged_inventory_csv",
  inventoryClass: "aged" as const,
  inventoryLotId: "lot_1",
  sourceLeadEventId: "evt_1",
  quarantineReason: null,
  availableAt: null,
  reservedAt: null,
  committedAt: null,
  withdrawnAt: null,
  expiredAt: null,
  rejectedAt: null,
  maxFulfillments: 1,
  fulfillmentCount: 0,
  metadataJson: { importRequestId: "req-import-1" },
};

const baseLot = {
  id: "lot_1",
  status: "active" as const,
  lotKey: "lot-key-1",
  sourceLane: "aged_inventory_csv",
  sourceProvider: "manual_import" as const,
};

const baseEvent = {
  id: "evt_1",
  sourceProvider: "manual_import" as const,
  sourceSystem: "csv_import" as const,
  normalizedPayloadJson: {
    phone_e164: "+15550100001",
    email: "masked@example.com",
    state: "TX",
  },
  enrichmentMetadataJson: { sourceLane: "aged_inventory_csv" },
  receivedAt: new Date("2026-06-01T00:00:00.000Z"),
};

function assess(overrides: Record<string, unknown> = {}) {
  return assessLeadInventoryActivationEligibility({
    item: { ...baseItem, ...(overrides.item as object) },
    lot: overrides.lot === null ? null : { ...baseLot, ...(overrides.lot as object) },
    sourceLeadEvent:
      overrides.sourceLeadEvent === null
        ? null
        : { ...baseEvent, ...(overrides.sourceLeadEvent as object) },
    leadProof: (overrides.leadProof as null) ?? { proofStatus: "UNREVIEWED" },
    verification:
      (overrides.verification as null) ??
      ({ verificationStatus: "PASSED", duplicateStatus: "UNIQUE" } as const),
    allocations: (overrides.allocations as []) ?? [],
    ageBands: (overrides.ageBands as typeof DEFAULT_AGE_BANDS_V1) ?? DEFAULT_AGE_BANDS_V1,
    evaluatedAt: new Date("2026-07-10T00:00:00.000Z"),
  });
}

test("valid pending item is eligible", () => {
  const result = assess();
  assert.equal(result.eligible, true);
  assert.equal(result.blockerCodes.length, 0);
});

test("invalid state blocked", () => {
  const result = assess({ item: { normalizedState: "ZZ" } });
  assert.ok(result.blockerCodes.includes("invalid_state"));
});

test("missing age band blocked", () => {
  const result = assess({ ageBands: [] });
  assert.ok(result.blockerCodes.includes("age_band_unresolved"));
});

test("unknown source lane blocked", () => {
  const result = assess({
    item: { sourceLane: "totally_unknown_lane" },
    sourceLeadEvent: {
      enrichmentMetadataJson: { sourceLane: "totally_unknown_lane" },
    },
  });
  assert.ok(result.blockerCodes.includes("source_lane_unrecognized"));
});

test("missing source event blocked", () => {
  const result = assess({ sourceLeadEvent: null });
  assert.ok(result.blockerCodes.includes("source_event_missing"));
});

test("missing import provenance blocked", () => {
  const result = assess({ item: { metadataJson: {} } });
  assert.ok(result.blockerCodes.includes("import_provenance_missing"));
});

test("identity incomplete blocked", () => {
  const result = assess({
    sourceLeadEvent: { normalizedPayloadJson: { state: "TX" } },
    verification: { verificationStatus: "UNCHECKED", duplicateStatus: "UNIQUE" },
  });
  assert.ok(result.blockerCodes.includes("identity_normalization_incomplete"));
});

test("duplicate unchecked blocked", () => {
  const result = assess({
    verification: { verificationStatus: "PASSED", duplicateStatus: "UNCHECKED" },
  });
  assert.ok(result.blockerCodes.includes("duplicate_status_unchecked"));
});

test("confirmed duplicate blocked", () => {
  const result = assess({
    verification: { verificationStatus: "PASSED", duplicateStatus: "DUPLICATE_GLOBAL" },
  });
  assert.ok(result.blockerCodes.includes("duplicate_detected"));
});

test("possible match blocked", () => {
  const result = assess({
    verification: { verificationStatus: "PASSED", duplicateStatus: "POSSIBLE_MATCH" },
  });
  assert.ok(result.blockerCodes.includes("duplicate_possible_match"));
});

test("allocation conflict blocked", () => {
  const result = assess({
    allocations: [
      {
        id: "alloc_1",
        status: "reserved",
        leadInventoryItemId: "item_1",
        releasedAt: null,
        deliveryInstructionCount: 0,
        deliveryAttemptCount: 0,
      },
    ],
  });
  assert.ok(result.blockerCodes.includes("allocation_conflict"));
});

test("delivery history blocked", () => {
  const result = assess({
    allocations: [
      {
        id: "alloc_1",
        status: "released",
        leadInventoryItemId: "item_1",
        releasedAt: new Date(),
        deliveryInstructionCount: 1,
        deliveryAttemptCount: 1,
      },
    ],
  });
  assert.ok(result.blockerCodes.includes("delivery_history_present"));
});

test("non-pending status blocked", () => {
  const result = assess({ item: { status: "available", availableAt: new Date() } });
  assert.ok(result.blockerCodes.includes("status_not_pending_review"));
  assert.equal(result.eligible, false);
});

test("fulfillment limit invalid blocked", () => {
  const result = assess({ item: { maxFulfillments: 0 } });
  assert.ok(result.blockerCodes.includes("fulfillment_limit_invalid"));
});
