import assert from "node:assert/strict";
import test from "node:test";
import { presentBulkImportDetailResponse } from "./bulk-import-detail.present.js";

const presentedRow = {
  id: "row_1",
  rowNumber: 1,
  name: "Jane Doe",
  phone: "+12025550101",
  email: null,
  validationStatus: "ready_for_simulation",
  duplicateStatus: "none",
  deliveryStatus: "pending",
  blockerReasons: [] as string[],
  duplicateCandidates: [],
  unmappedFieldCount: 0,
  excluded: false,
  sourceLeadEventId: "evt_1",
};

const rawPrismaRow = {
  id: "row_1",
  rowNumber: 1,
  rawRowJson: { first_name: "Jane" },
  blockerReasonsJson: [{ message: "missing phone" }],
  validationStatus: "identity_blocked",
};

test("presentBulkImportDetailResponse attaches normalized rows, not raw batch rows", () => {
  const detail = {
    batch: {
      id: "batch_1",
      fileName: "leads.csv",
      importLabel: null,
      status: "ready_for_review",
      totalRows: 1,
      validRows: 1,
      deliveredRows: 0,
      failedRows: 0,
      destinationClientAccountId: "client_a",
      destinationLocationIdGhl: "loc_a",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      mappingJson: { first_name: "first_name" },
      defaultValuesJson: {},
      importOptionsJson: {},
      wizardStepJson: { step: "review" },
      rows: [rawPrismaRow],
    },
    summary: { totalRows: 1, eligibleForSimulation: 1 },
    deliveryMonitor: null,
    rows: [presentedRow],
  };

  const presented = presentBulkImportDetailResponse(detail as never, { nextStep: "review" });
  assert.equal(presented.nextStep, "review");
  assert.equal(presented.batch.rows, detail.rows);
  const firstPresentedRow = presented.batch.rows[0] as typeof presentedRow | undefined;
  assert.deepEqual(firstPresentedRow?.blockerReasons, []);
  assert.notEqual(presented.batch.rows[0], rawPrismaRow);
});

test("legacy mutation shape with raw batch rows is detectably different from presenter output", () => {
  const detail = {
    batch: {
      id: "batch_1",
      fileName: "leads.csv",
      importLabel: null,
      status: "ready_for_review",
      totalRows: 1,
      validRows: 1,
      deliveredRows: 0,
      failedRows: 0,
      destinationClientAccountId: "client_a",
      destinationLocationIdGhl: "loc_a",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      mappingJson: {},
      defaultValuesJson: {},
      importOptionsJson: {},
      wizardStepJson: {},
      rows: [rawPrismaRow],
    },
    summary: { totalRows: 1 },
    deliveryMonitor: null,
    rows: [presentedRow],
  };

  const legacyMutation = {
    batch: detail.batch,
    summary: detail.summary,
    nextStep: "review",
  };
  const canonical = presentBulkImportDetailResponse(detail as never, { nextStep: "review" });

  assert.ok(Array.isArray(legacyMutation.batch.rows?.[0]?.blockerReasonsJson));
  assert.ok(Array.isArray(canonical.batch.rows[0]?.blockerReasons));
  assert.notDeepEqual(legacyMutation.batch.rows, canonical.batch.rows);
});

export function expectMutationResponseMatchesDetailContract(
  mutation: ReturnType<typeof presentBulkImportDetailResponse>,
  detail: ReturnType<typeof presentBulkImportDetailResponse>
) {
  assert.ok(Array.isArray(mutation.batch.rows));
  assert.ok(Array.isArray(detail.batch.rows));
  for (const row of mutation.batch.rows) {
    assert.ok(Array.isArray(row.blockerReasons));
    assert.ok(Array.isArray(row.duplicateCandidates));
  }
  assert.equal(mutation.batch.rows.length, detail.batch.rows.length);
  assert.equal(mutation.batch.status, detail.batch.status);
}

test("expectMutationResponseMatchesDetailContract validates render-compatible rows", () => {
  const detailPayload = {
    batch: {
      id: "batch_1",
      fileName: "leads.csv",
      importLabel: null,
      status: "ready_for_review",
      totalRows: 1,
      validRows: 1,
      deliveredRows: 0,
      failedRows: 0,
      destinationClientAccountId: "client_a",
      destinationLocationIdGhl: "loc_a",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      mappingJson: {},
      defaultValuesJson: {},
      importOptionsJson: {},
      wizardStepJson: {},
      rows: [rawPrismaRow],
    },
    summary: { totalRows: 1 },
    deliveryMonitor: null,
    rows: [presentedRow],
  };
  const canonical = presentBulkImportDetailResponse(detailPayload as never, { nextStep: "review" });
  expectMutationResponseMatchesDetailContract(canonical, canonical);
});
