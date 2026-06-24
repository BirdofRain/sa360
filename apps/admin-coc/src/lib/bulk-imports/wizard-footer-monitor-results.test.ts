import assert from "node:assert/strict";
import test from "node:test";

import { resolveWizardFooterConfig } from "./wizard-footer-config.ts";
import type { BulkImportBatchState, BulkImportSummary } from "./wizard-steps.ts";

function deliveredBatch(): BulkImportBatchState {
  return {
    status: "completed",
    mappingJson: { first_name: "first_name" },
    destinationClientAccountId: "client_a",
    destinationLocationIdGhl: "loc_a",
    wizardStepJson: { step: "results", mappingConfirmed: true },
    simulatedRows: 1,
    approvedAt: "2026-06-17T12:00:00.000Z",
  };
}

function deliveredSummary(): BulkImportSummary {
  return {
    totalRows: 1,
    eligibleForSimulation: 1,
    simulatedRows: 1,
    normalizedSourceEvents: 1,
    deliveredRows: 1,
  };
}

const baseInput = {
  batch: deliveredBatch(),
  summary: deliveredSummary(),
  mappingConfirmed: true,
  destinationDraftValid: true,
  destinationSaved: true,
  eligibleForSimulation: 1,
  eligibleSimulatedCount: 1,
  missingSourceEvent: 0,
  mutationActive: false,
  preflightReady: true,
  approvalPhraseValid: true,
};

test("monitor footer keeps previous only — View Results is inline in step content", () => {
  const config = resolveWizardFooterConfig({
    ...baseInput,
    viewStep: "monitor",
  });
  assert.equal(config.previousViewStep, "approve");
  assert.equal(config.primaryAction, "none");
  assert.equal(config.primaryLabel, "");
});

test("results footer keeps previous only — no View Results duplicate", () => {
  const config = resolveWizardFooterConfig({
    ...baseInput,
    viewStep: "results",
  });
  assert.equal(config.previousViewStep, "monitor");
  assert.equal(config.previousLabel, "← Previous: Monitor");
  assert.equal(config.primaryAction, "none");
  assert.equal(config.primaryLabel, "");
});
