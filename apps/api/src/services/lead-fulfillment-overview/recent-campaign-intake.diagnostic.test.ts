import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadRecentCampaignIntake } from "./recent-campaign-intake.service.js";

describe("recent campaign intake tracking diagnostics", () => {
  it("labels a reused item on another source event instead of INTAKE ONLY", async () => {
    const db = {
      sourceLeadEvent: {
        findMany: async () => [
          {
            id: "evt_reused",
            sourceLeadUid: "uid-reused",
            sourceProvider: "leadcapture_io",
            sourceSystem: "leadcapture_io_nextgen",
            receivedAt: new Date("2026-08-18T15:00:00.000Z"),
            normalizedPayloadJson: { routing: { niche_key: "NURSE" } },
            enrichmentMetadataJson: {
              sourceLane: "leadcapture_io",
              inventoryTracking: {
                outcome: "reused_source_lead_id",
                inventoryItemId: "item_canonical",
              },
            },
            leadInventoryItem: null,
          },
          {
            id: "evt_missing",
            sourceLeadUid: "uid-missing",
            sourceProvider: "leadcapture_io",
            sourceSystem: "leadcapture_io_nextgen",
            receivedAt: new Date("2026-08-18T14:00:00.000Z"),
            normalizedPayloadJson: null,
            enrichmentMetadataJson: { inventoryTracking: { outcome: "generated_at_missing" } },
            leadInventoryItem: null,
          },
          {
            id: "evt_failed",
            sourceLeadUid: "uid-failed",
            sourceProvider: "leadcapture_io",
            sourceSystem: "leadcapture_io_nextgen",
            receivedAt: new Date("2026-08-18T13:00:00.000Z"),
            normalizedPayloadJson: null,
            enrichmentMetadataJson: { inventoryTracking: { outcome: "inventory_tracking_failed" } },
            leadInventoryItem: null,
          },
          {
            id: "evt_new",
            sourceLeadUid: "uid-new",
            sourceProvider: "leadcapture_io",
            sourceSystem: "leadcapture_io_nextgen",
            receivedAt: new Date("2026-08-18T12:00:00.000Z"),
            normalizedPayloadJson: null,
            enrichmentMetadataJson: {
              inventoryTracking: { outcome: "created", inventoryItemId: "item_new" },
            },
            leadInventoryItem: {
              id: "item_new",
              status: "pending_review",
              generatedAt: new Date("2026-08-18T12:00:00.000Z"),
              normalizedState: "NC",
              nicheKey: "nurse",
              sourceLane: "leadcapture_io",
              sourceLeadEventId: "evt_new",
            },
          },
        ],
      },
      leadProof: { findMany: async () => [] },
      leadVerificationResult: { findMany: async () => [] },
      leadInventoryItem: {
        findMany: async () => [
          {
            id: "item_canonical",
            status: "pending_review",
            generatedAt: new Date("2026-08-18T12:00:00.000Z"),
            normalizedState: "NC",
            nicheKey: "nurse",
            sourceLane: "leadcapture_io",
            sourceLeadEventId: "evt_original",
          },
        ],
      },
    };

    const result = await loadRecentCampaignIntake(db as never, {
      evaluatedAt: new Date("2026-08-18T16:00:00.000Z"),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const reused = result.rows.find((row) => row.leadUid === "uid-reused");
    assert.ok(reused);
    assert.equal(reused.inventoryTrackingOutcome, "reused");
    assert.equal(reused.inventoryTrackingLabel, "Inventory reused");
    assert.equal(reused.canonicalInventoryOnOtherEvent, true);
    assert.equal(reused.inventoryLifecycle, "FRESH_HOLD");
    assert.notEqual(reused.inventoryLifecycleLabel, "INTAKE ONLY");
    assert.match(reused.inventoryLifecycleLabel, /Inventory reused/);

    const missing = result.rows.find((row) => row.leadUid === "uid-missing");
    assert.equal(missing?.inventoryTrackingOutcome, "generated_at_missing");
    assert.equal(missing?.inventoryLifecycle, "DATE_MISSING");

    const failed = result.rows.find((row) => row.leadUid === "uid-failed");
    assert.equal(failed?.inventoryTrackingOutcome, "failed");
    assert.equal(failed?.inventoryTrackingLabel, "Tracking failed");

    const created = result.rows.find((row) => row.leadUid === "uid-new");
    assert.equal(created?.inventoryTrackingOutcome, "created");
    assert.equal(created?.inventoryLifecycle, "FRESH_HOLD");
  });
});
