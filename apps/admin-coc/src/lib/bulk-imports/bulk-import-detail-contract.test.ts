import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeBulkImportReviewRow,
  validateBulkImportDetailDto,
} from "./bulk-import-detail-contract.js";

test("malformed destination response with raw prisma rows is rejected", () => {
  const result = validateBulkImportDetailDto({
    batch: {
      id: "batch_1",
      fileName: "leads.csv",
      status: "ready_for_review",
      updatedAt: "2026-01-02T00:00:00.000Z",
      rows: [
        {
          id: "row_1",
          rowNumber: 1,
          rawRowJson: {},
          blockerReasonsJson: [],
        },
      ],
    },
    summary: {},
    nextStep: "review",
  });
  assert.equal(result.ok, false);
});

test("normalized review row preserves live delivery snapshot fields", () => {
  const row = normalizeBulkImportReviewRow({
    id: "row_1",
    rowNumber: 1,
    validationStatus: "eligible",
    duplicateStatus: "none",
    deliveryStatus: "delivered",
    ghlContactId: "contact_123",
    ghlOpportunityId: "opp_456",
    liveDelivery: {
      ghlContactId: "contact_123",
      ghlOpportunityId: "opp_456",
      destinationLocationIdGhl: "loc_a",
      contactAction: "created",
      ownerId: null,
      ownerName: null,
      tagsAdded: ["source:goat"],
      workflowTriggerStrategy: "source_tag_only",
      workflowTriggerNote: "No NEW_LEAD or AI_READY trigger tag was added.",
      liveRunId: "run_789",
      deliveredAt: "2026-06-17T12:00:00.000Z",
    },
  });
  assert.equal(row.ghlContactId, "contact_123");
  assert.equal(row.liveDelivery?.liveRunId, "run_789");
  assert.deepEqual(row.liveDelivery?.tagsAdded, ["source:goat"]);
});

test("normalized review row always exposes blockerReasons array", () => {
  const row = normalizeBulkImportReviewRow({
    id: "row_1",
    rowNumber: 1,
    validationStatus: "eligible",
    duplicateStatus: "none",
    deliveryStatus: "pending",
  });
  assert.deepEqual(row.blockerReasons, []);
  assert.deepEqual(row.duplicateCandidates, []);
  assert.deepEqual(row.normalizationIssues, []);
});
