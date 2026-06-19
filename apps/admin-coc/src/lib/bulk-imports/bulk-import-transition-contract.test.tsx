import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { BulkImportReviewTable } from "@/components/bulk-imports/bulk-import-review-table";
import {
  expectMutationResponseMatchesDetailContract,
  normalizeBulkImportReviewRow,
  validateBulkImportDetailDto,
} from "@/lib/bulk-imports/bulk-import-detail-contract";

test.afterEach(() => {
  cleanup();
});

const rawPrismaLikeRow = {
  id: "row_1",
  rowNumber: 1,
  rawRowJson: { first_name: "Jane", phone: "+12025550101" },
  blockerReasonsJson: [{ message: "missing mapping" }],
  validationStatus: "mapping_required",
  duplicateStatus: "none",
  deliveryStatus: "pending",
  excluded: false,
};

const legacyMutationResponse = {
  batch: {
    id: "batch_1",
    fileName: "leads.csv",
    status: "ready_for_review",
    updatedAt: "2026-01-02T00:00:00.000Z",
    rows: [rawPrismaLikeRow],
  },
  summary: { totalRows: 1 },
  nextStep: "review",
};

const canonicalRow = normalizeBulkImportReviewRow({
  id: "row_1",
  rowNumber: 1,
  name: "Jane",
  phone: "+12025550101",
  email: null,
  validationStatus: "ready_for_simulation",
  duplicateStatus: "none",
  deliveryStatus: "pending",
  blockerReasons: [],
  duplicateCandidates: [],
  unmappedFieldCount: 0,
  excluded: false,
});

test("legacy destination mutation response with raw rows fails detail contract validation", () => {
  const result = validateBulkImportDetailDto(legacyMutationResponse);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /incomplete/i);
    assert.ok(result.correlationId.startsWith("bi-"));
  }
});

test("canonical destination mutation response passes detail contract validation", () => {
  const result = validateBulkImportDetailDto({
    batch: {
      id: "batch_1",
      fileName: "leads.csv",
      status: "ready_for_review",
      updatedAt: "2026-01-02T00:00:00.000Z",
      mappingJson: {},
      defaultValuesJson: {},
      importOptionsJson: null,
      wizardStepJson: { step: "review" },
      destinationClientAccountId: "client_a",
      destinationLocationIdGhl: "loc_a",
      rows: [canonicalRow],
    },
    summary: { totalRows: 1, eligibleForSimulation: 1 },
    deliveryMonitor: null,
    nextStep: "review",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.nextStep, "review");
    assert.deepEqual(result.data.batch.rows[0]?.blockerReasons, []);
  }
});

test("review table renders rows missing blockerReasons when normalized first", () => {
  render(<BulkImportReviewTable rows={[canonicalRow]} />);
  assert.ok(screen.getByText("Jane"));
});

test("review table does not crash when blockerReasons is normalized from malformed input", () => {
  const row = normalizeBulkImportReviewRow(rawPrismaLikeRow as Record<string, unknown>);
  render(<BulkImportReviewTable rows={[row]} />);
  assert.ok(screen.getByText("mapping_required"));
});

function canonicalDetail(nextStep: string, rows: ReturnType<typeof normalizeBulkImportReviewRow>[]) {
  return {
    batch: {
      id: "batch_1",
      fileName: "leads.csv",
      status: "ready_for_review",
      updatedAt: "2026-01-02T00:00:00.000Z",
      mappingJson: {},
      defaultValuesJson: {},
      importOptionsJson: null,
      wizardStepJson: { step: nextStep },
      destinationClientAccountId: "client_a",
      destinationLocationIdGhl: "loc_a",
      rows,
    },
    summary: { totalRows: rows.length, eligibleForSimulation: rows.length },
    deliveryMonitor: null,
    nextStep,
  };
}

const transitionCases = [
  { name: "mapping to destination", nextStep: "destination" },
  { name: "destination to review", nextStep: "review" },
  { name: "review to simulate", nextStep: "simulate" },
  { name: "simulate to approve", nextStep: "approve" },
  { name: "approve to monitor", nextStep: "monitor" },
] as const;

for (const transition of transitionCases) {
  test(`${transition.name} mutation response matches GET detail contract`, () => {
    const row = normalizeBulkImportReviewRow({
      id: "row_1",
      rowNumber: 1,
      validationStatus: "ready_for_simulation",
      duplicateStatus: "none",
      deliveryStatus: "pending",
      blockerReasons: [],
      duplicateCandidates: [],
      normalizationIssues: [],
    });
    const mutation = validateBulkImportDetailDto(
      canonicalDetail(transition.nextStep, [row])
    );
    const detail = validateBulkImportDetailDto(
      canonicalDetail(transition.nextStep, [row])
    );
    assert.equal(mutation.ok, true);
    assert.equal(detail.ok, true);
    if (mutation.ok && detail.ok) {
      expectMutationResponseMatchesDetailContract(mutation.data, detail.data);
    }
  });
}

test("row variants expose required array fields after normalization", () => {
  const variants = [
    { validationStatus: "ready_for_simulation", duplicateCandidates: [{ originLabel: "dup" }] },
    { validationStatus: "identity_blocked", blockerReasons: ["missing phone"] },
    { validationStatus: "duplicate_review", duplicateCandidates: [{ originLabel: "existing" }] },
    { validationStatus: "mapping_required" },
    { validationStatus: "failed", deliveryStatus: "failed" },
    { validationStatus: "ready_for_simulation", deliveryStatus: "simulated" },
    { validationStatus: "ready_for_simulation", deliveryStatus: "delivered" },
  ];
  for (const variant of variants) {
    const row = normalizeBulkImportReviewRow({
      id: "row_1",
      rowNumber: 1,
      duplicateStatus: "none",
      deliveryStatus: "pending",
      ...variant,
    });
    assert.ok(Array.isArray(row.blockerReasons));
    assert.ok(Array.isArray(row.duplicateCandidates));
    assert.ok(Array.isArray(row.normalizationIssues));
  }
});
