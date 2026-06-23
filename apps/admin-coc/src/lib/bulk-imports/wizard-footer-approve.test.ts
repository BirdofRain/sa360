import assert from "node:assert/strict";
import test from "node:test";
import { resolveWizardFooterConfig } from "./wizard-footer-config.ts";
import type { BulkImportBatchState, BulkImportSummary } from "./wizard-steps.ts";

function simulationCompleteBatch(): BulkImportBatchState {
  return {
    status: "simulation_complete",
    mappingJson: { first_name: "first_name" },
    destinationClientAccountId: "client_a",
    destinationLocationIdGhl: "loc_a",
    wizardStepJson: { step: "approve", mappingConfirmed: true },
    simulatedRows: 5,
  };
}

function simulationCompleteSummary(): BulkImportSummary {
  return {
    totalRows: 6,
    eligibleForSimulation: 6,
    simulatedRows: 5,
    normalizedSourceEvents: 6,
  };
}

test("approve footer does not duplicate preflight status lines", () => {
  const config = resolveWizardFooterConfig({
    viewStep: "approve",
    batch: simulationCompleteBatch(),
    summary: simulationCompleteSummary(),
    mappingConfirmed: true,
    destinationDraftValid: true,
    destinationSaved: true,
    eligibleForSimulation: 6,
    eligibleSimulatedCount: 5,
    missingSourceEvent: 0,
    mutationActive: false,
    preflightReady: false,
    approvalPhraseValid: true,
    approvalText: "APPROVE BULK LEAD DELIVERY",
    preflightBlockers: ["Internal approval status is not_reviewed; approved is required."],
  });

  assert.equal(config.primaryAction, "none");
  assert.equal(config.statusLines, undefined);
  assert.equal(config.previousViewStep, "simulate");
});

test("simulate footer previous from approve targets simulate step", () => {
  const config = resolveWizardFooterConfig({
    viewStep: "approve",
    batch: simulationCompleteBatch(),
    summary: simulationCompleteSummary(),
    mappingConfirmed: true,
    destinationDraftValid: true,
    destinationSaved: true,
    eligibleForSimulation: 6,
    eligibleSimulatedCount: 5,
    missingSourceEvent: 0,
    mutationActive: false,
    preflightReady: false,
    approvalPhraseValid: false,
    approvalText: "",
  });

  assert.equal(config.previousViewStep, "simulate");
});
