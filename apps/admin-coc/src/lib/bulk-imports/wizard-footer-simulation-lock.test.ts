import assert from "node:assert/strict";
import test from "node:test";
import { resolveWizardFooterConfig } from "./wizard-footer-config.ts";
import { SIMULATION_LOCKED_MESSAGE } from "./simulation-lock-state.ts";
import type { BulkImportBatchState, BulkImportSummary } from "./wizard-steps.ts";

const baseBatch: BulkImportBatchState & { approvedAt?: string | null } = {
  status: "failed",
  approvedAt: "2026-06-17T12:00:00.000Z",
  mappingJson: { first_name: "first_name" },
  destinationClientAccountId: "client_a",
  destinationLocationIdGhl: "loc_a",
  wizardStepJson: { step: "simulate" },
};

const baseSummary: BulkImportSummary = {
  eligibleForSimulation: 5,
  simulatedRows: 0,
  deliveredRows: 0,
};

test("simulate footer hides simulate button when live approval locks simulation", () => {
  const config = resolveWizardFooterConfig({
    viewStep: "simulate",
    batch: baseBatch,
    summary: baseSummary,
    mappingConfirmed: true,
    destinationDraftValid: true,
    destinationSaved: true,
    eligibleForSimulation: 5,
    eligibleSimulatedCount: 0,
    missingSourceEvent: 0,
    mutationActive: false,
    preflightReady: null,
    approvalPhraseValid: false,
  });

  assert.equal(config.primaryAction, "clear-live-approval");
  assert.equal(config.primaryLabel, "Reset to Review and clear live approval");
  assert.notEqual(config.primaryAction, "simulate");
  assert.ok(config.statusLines?.includes(SIMULATION_LOCKED_MESSAGE));
});

test("simulate footer disables clear-live-approval when delivered rows exist", () => {
  const config = resolveWizardFooterConfig({
    viewStep: "simulate",
    batch: baseBatch,
    summary: { ...baseSummary, deliveredRows: 1 },
    mappingConfirmed: true,
    destinationDraftValid: true,
    destinationSaved: true,
    eligibleForSimulation: 5,
    eligibleSimulatedCount: 0,
    missingSourceEvent: 0,
    mutationActive: false,
    preflightReady: null,
    approvalPhraseValid: false,
  });

  assert.equal(config.primaryDisabled, true);
  assert.match(config.primaryDisabledReason ?? "", /delivered rows/i);
});
