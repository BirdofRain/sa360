import assert from "node:assert/strict";
import test from "node:test";

import { resolveWizardFooterConfig } from "./wizard-footer-config.ts";
import {
  deriveProgressStep,
  resolveViewStep,
  type BulkImportBatchState,
  type BulkImportSummary,
} from "./wizard-steps.ts";
import {
  loadingMessageForStep,
  messageForViewStep,
  successMessageForStep,
} from "./wizard-messages.ts";

function batch(overrides: Partial<BulkImportBatchState> = {}): BulkImportBatchState {
  return {
    status: "ready_for_review",
    mappingJson: { first_name: "first_name", phone: "phone" },
    wizardStepJson: {
      step: "destination",
      mappingConfirmed: true,
      missingRequired: [],
    },
    destinationClientAccountId: null,
    destinationLocationIdGhl: null,
    ...overrides,
  };
}

function summary(overrides: Partial<BulkImportSummary> = {}): BulkImportSummary {
  return {
    totalRows: 1,
    mappingConfirmed: true,
    eligibleForSimulation: 0,
    ...overrides,
  };
}

test("resolveViewStep honors accessible requested earlier step over persisted progress", () => {
  const b = batch({
    destinationClientAccountId: "client_a",
    destinationLocationIdGhl: "loc_a",
    wizardStepJson: { step: "destination", mappingConfirmed: true },
  });
  const s = summary({ eligibleForSimulation: 0 });
  assert.equal(deriveProgressStep(b, s), "review");
  assert.equal(resolveViewStep(b, s, "map"), "map");
  assert.equal(resolveViewStep(b, s, "destination"), "destination");
});

test("reload on map keeps progress at destination when destination not saved", () => {
  const b = batch({
    wizardStepJson: { step: "destination", mappingConfirmed: true },
  });
  const s = summary();
  assert.equal(deriveProgressStep(b, s), "destination");
  assert.equal(resolveViewStep(b, s, "map"), "map");
});

test("scoped messages only show on matching view step", () => {
  const mapSuccess = successMessageForStep("map", "Mapping confirmed.");
  assert.equal(messageForViewStep(mapSuccess, "map")?.text, "Mapping confirmed.");
  assert.equal(messageForViewStep(mapSuccess, "destination"), null);
  const destLoading = loadingMessageForStep("destination", "Saving destination…");
  assert.equal(messageForViewStep(destLoading, "destination")?.text, "Saving destination…");
  assert.equal(messageForViewStep(destLoading, "map"), null);
});

test("mapping transition message does not appear on destination view", () => {
  const stale = successMessageForStep("map", "Mapping confirmed. Opening Destination…");
  assert.equal(messageForViewStep(stale, "destination"), null);
});

test("footer mapping shows Return to Destination when confirmed and progress is destination", () => {
  const config = resolveWizardFooterConfig({
    viewStep: "map",
    batch: batch({ wizardStepJson: { step: "destination", mappingConfirmed: true } }),
    summary: summary(),
    mappingConfirmed: true,
    destinationDraftValid: false,
    destinationSaved: false,
    eligibleForSimulation: 0,
    eligibleSimulatedCount: 0,
    missingSourceEvent: 0,
    mutationActive: false,
    preflightReady: null,
    approvalPhraseValid: false,
  });
  assert.equal(config.primaryAction, "navigate");
  assert.equal(config.primaryTargetStep, "destination");
  assert.equal(config.primaryLabel, "Return to Destination");
});

test("footer destination shows Save destination when unsaved", () => {
  const config = resolveWizardFooterConfig({
    viewStep: "destination",
    batch: batch(),
    summary: summary(),
    mappingConfirmed: true,
    destinationDraftValid: true,
    destinationSaved: false,
    eligibleForSimulation: 0,
    eligibleSimulatedCount: 0,
    missingSourceEvent: 0,
    mutationActive: false,
    preflightReady: null,
    approvalPhraseValid: false,
  });
  assert.equal(config.primaryAction, "save-destination");
  assert.equal(config.primaryLabel, "Save destination");
  assert.equal(config.previousViewStep, "map");
});

test("footer destination shows Return to Review when saved and progress is review", () => {
  const config = resolveWizardFooterConfig({
    viewStep: "destination",
    batch: batch({
      destinationClientAccountId: "client_a",
      destinationLocationIdGhl: "loc_a",
      wizardStepJson: { step: "review", mappingConfirmed: true },
    }),
    summary: summary(),
    mappingConfirmed: true,
    destinationDraftValid: true,
    destinationSaved: true,
    eligibleForSimulation: 0,
    eligibleSimulatedCount: 0,
    missingSourceEvent: 0,
    mutationActive: false,
    preflightReady: null,
    approvalPhraseValid: false,
  });
  assert.equal(config.primaryAction, "navigate");
  assert.equal(config.primaryTargetStep, "review");
  assert.equal(config.primaryLabel, "Return to Review");
});

test("background refresh does not disable footer save via mutation lock", () => {
  const refreshing = resolveWizardFooterConfig({
    viewStep: "destination",
    batch: batch(),
    summary: summary(),
    mappingConfirmed: true,
    destinationDraftValid: true,
    destinationSaved: false,
    eligibleForSimulation: 0,
    eligibleSimulatedCount: 0,
    missingSourceEvent: 0,
    mutationActive: false,
    preflightReady: null,
    approvalPhraseValid: false,
  });
  assert.equal(refreshing.primaryDisabled, false);

  const saving = resolveWizardFooterConfig({
    viewStep: "destination",
    batch: batch(),
    summary: summary(),
    mappingConfirmed: true,
    destinationDraftValid: true,
    destinationSaved: false,
    eligibleForSimulation: 0,
    eligibleSimulatedCount: 0,
    missingSourceEvent: 0,
    mutationActive: true,
    preflightReady: null,
    approvalPhraseValid: false,
  });
  assert.equal(saving.primaryDisabled, true);
  assert.equal(saving.primaryLabel, "Saving destination…");
});
