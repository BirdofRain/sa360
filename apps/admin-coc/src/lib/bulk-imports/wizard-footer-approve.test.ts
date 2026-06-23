import assert from "node:assert/strict";
import test from "node:test";
import { resolveWizardFooterConfig } from "./wizard-footer-config.ts";
import type { BulkImportBatchState, BulkImportSummary } from "./wizard-steps.ts";
import { BULK_IMPORT_APPROVE_PHRASE } from "./types.ts";

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

test("approve footer shows phrase accepted and preflight blockers near disabled action", () => {
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
    approvalText: BULK_IMPORT_APPROVE_PHRASE,
    preflightBlockers: ["Effective runtime mode is simulate; live_canary is required."],
  });

  assert.equal(config.primaryDisabled, true);
  assert.ok(config.statusLines?.includes("Approval phrase accepted."));
  assert.ok(
    config.statusLines?.some((line) => line.includes("live_canary is required"))
  );
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
