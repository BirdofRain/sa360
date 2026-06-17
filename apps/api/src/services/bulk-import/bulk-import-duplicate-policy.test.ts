import test from "node:test";
import assert from "node:assert/strict";
import {
  BULK_IMPORT_DELETE_CONFIRMATION,
} from "@sa360/shared";
import {
  classifyDuplicateStatus,
  detectWithinBatchDuplicates,
  getBlockingDuplicateCandidates,
  buildWithinBatchDuplicateIndex,
} from "./bulk-import-duplicate.service.js";
import { evaluateRowEligibility } from "./bulk-import-eligibility.service.js";

test("same row does not duplicate against itself via blocking filter", () => {
  const candidates = [
    {
      kind: "phone" as const,
      detail: "self",
      blocksReview: false,
      severity: "informational_cancelled_duplicate" as const,
    },
  ];
  assert.equal(getBlockingDuplicateCandidates(candidates).length, 0);
  assert.equal(classifyDuplicateStatus(candidates), "none");
});

test("cancelled undelivered import is informational not blocking", () => {
  const candidates = [
    {
      kind: "phone" as const,
      detail: "Previous batch cancelled",
      blocksReview: false,
      severity: "informational_cancelled_duplicate" as const,
      previousBatchCancelled: true,
      deliveredToGhl: false,
    },
  ];
  const result = evaluateRowEligibility({
    normalized: {
      contact: {
        lead_uid: "lead_1",
        phone_e164: "+15550101001",
        email: "a@example.test",
        first_name: "Alex",
        last_name: "Veteran",
      },
    } as never,
    mappingComplete: true,
    destinationSelected: true,
    destinationReadyForSimulation: true,
    duplicateCandidates: candidates,
  });
  assert.equal(result.validationStatus, "eligible");
});

test("delivered cancelled import remains blocking", () => {
  const candidates = [
    {
      kind: "phone" as const,
      detail: "Delivered duplicate",
      blocksReview: true,
      severity: "blocking_delivered_duplicate" as const,
      previousBatchCancelled: true,
      deliveredToGhl: true,
    },
  ];
  const result = evaluateRowEligibility({
    normalized: {
      contact: {
        lead_uid: "lead_2",
        phone_e164: "+15550101002",
        email: "b@example.test",
        first_name: "Blair",
        last_name: "Test",
      },
    } as never,
    mappingComplete: true,
    destinationSelected: true,
    destinationReadyForSimulation: true,
    duplicateCandidates: candidates,
  });
  assert.equal(result.validationStatus, "duplicate_review");
});

test("separate row with same phone still triggers duplicate review", () => {
  const index = buildWithinBatchDuplicateIndex([
    { rowNumber: 1, phone: "15550101001" },
    { rowNumber: 4, phone: "15550101001" },
  ]);
  const dupes = detectWithinBatchDuplicates(4, "15550101001", undefined, undefined, index, "batch_1");
  assert.ok(dupes.length > 0);
  assert.equal(classifyDuplicateStatus(dupes), "within_batch_duplicate");
});

test("delete confirmation phrase is required constant", () => {
  assert.equal(BULK_IMPORT_DELETE_CONFIRMATION, "DELETE BULK IMPORT");
});
