import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveDefaultStep,
  deriveFurthestUnlockedStep,
  getStepBlockedReason,
  resolveWizardStepRouting,
} from "./wizard-step-routing.ts";
import { resolveViewStep } from "./wizard-steps.ts";
import type { BulkImportBatchState, BulkImportSummary } from "./wizard-steps.ts";

function readyForReviewBatch(
  overrides: Partial<BulkImportBatchState> = {}
): BulkImportBatchState {
  return {
    status: "ready_for_review",
    mappingJson: { first_name: "first_name", phone: "phone" },
    destinationClientAccountId: "client_a",
    destinationLocationIdGhl: "loc_a",
    wizardStepJson: { step: "review", mappingConfirmed: true },
    ...overrides,
  };
}

function readyForReviewSummary(
  overrides: Partial<BulkImportSummary> = {}
): BulkImportSummary {
  return {
    totalRows: 3,
    eligibleForSimulation: 0,
    normalizedSourceEvents: 0,
    ...overrides,
  };
}

test("ready_for_review batch + ?step=destination renders Destination routing", () => {
  const batch = readyForReviewBatch();
  const summary = readyForReviewSummary();
  const routing = resolveWizardStepRouting(batch, summary, "destination");
  assert.equal(routing.requestedStep, "destination");
  assert.equal(routing.renderedStep, "destination");
  assert.equal(routing.defaultStep, "review");
  assert.equal(resolveViewStep(batch, summary, "destination"), "destination");
});

test("ready_for_review batch + ?step=review renders Review routing", () => {
  const batch = readyForReviewBatch();
  const summary = readyForReviewSummary();
  const routing = resolveWizardStepRouting(batch, summary, "review");
  assert.equal(routing.renderedStep, "review");
});

test("active step pill uses renderedStep not batch.status alone", () => {
  const batch = readyForReviewBatch();
  const summary = readyForReviewSummary();
  const rendered = resolveWizardStepRouting(batch, summary, "destination").renderedStep;
  const pills = ["map", "destination", "review", "simulate", "approve", "monitor", "results"];
  for (const pill of pills) {
    assert.equal(pill === rendered, pill === "destination");
  }
});

test("Previous Destination from Review resolves to destination step", () => {
  const batch = readyForReviewBatch();
  const summary = readyForReviewSummary({ eligibleForSimulation: 2 });
  assert.equal(resolveViewStep(batch, summary, "destination"), "destination");
});

test("invalid gated future step falls back with inline reason", () => {
  const batch = readyForReviewBatch();
  const summary = readyForReviewSummary();
  const routing = resolveWizardStepRouting(batch, summary, "approve");
  assert.equal(routing.renderedStep, "review");
  assert.match(routing.stepBlockedReason ?? "", /approval/i);
  assert.match(getStepBlockedReason("approve", batch, summary), /simulated/i);
});

test("no step param defaults to furthest valid step", () => {
  const batch = readyForReviewBatch();
  const summary = readyForReviewSummary();
  const routing = resolveWizardStepRouting(batch, summary, undefined);
  assert.equal(routing.renderedStep, deriveDefaultStep(batch, summary));
  assert.equal(routing.renderedStep, "review");
  assert.equal(routing.furthestUnlockedStep, deriveFurthestUnlockedStep(batch, summary));
});

test("completed Map step can return to Destination when mapping is confirmed", () => {
  const batch = readyForReviewBatch({
    wizardStepJson: { step: "review", mappingConfirmed: true },
  });
  const summary = readyForReviewSummary();
  assert.equal(resolveViewStep(batch, summary, "map"), "map");
  assert.equal(resolveViewStep(batch, summary, "destination"), "destination");
});

test("Destination remains accessible after Source Intake records exist", () => {
  const batch = readyForReviewBatch({
    destinationClientAccountId: null,
    destinationLocationIdGhl: null,
    wizardStepJson: { step: "review", mappingConfirmed: true },
  });
  const summary = readyForReviewSummary({ normalizedSourceEvents: 4 });
  const routing = resolveWizardStepRouting(batch, summary, "destination");
  assert.equal(routing.renderedStep, "destination");
});

test("Review accessible when only Source Intake records exist", () => {
  const batch = readyForReviewBatch({
    destinationClientAccountId: null,
    destinationLocationIdGhl: null,
  });
  const summary = readyForReviewSummary({ normalizedSourceEvents: 2 });
  assert.equal(resolveWizardStepRouting(batch, summary, "review").renderedStep, "review");
});

function simulationCompleteBatch(
  overrides: Partial<BulkImportBatchState> = {}
): BulkImportBatchState {
  return readyForReviewBatch({
    status: "simulation_complete",
    simulatedRows: 5,
    wizardStepJson: { step: "approve", mappingConfirmed: true },
    ...overrides,
  });
}

function simulationCompleteSummary(
  overrides: Partial<BulkImportSummary> = {}
): BulkImportSummary {
  return readyForReviewSummary({
    normalizedSourceEvents: 6,
    eligibleForSimulation: 6,
    simulatedRows: 5,
    ...overrides,
  });
}

test("simulation_complete batch + ?step=simulate renders Simulate", () => {
  const batch = simulationCompleteBatch();
  const summary = simulationCompleteSummary();
  const routing = resolveWizardStepRouting(batch, summary, "simulate");
  assert.equal(routing.renderedStep, "simulate");
  assert.equal(resolveViewStep(batch, summary, "simulate"), "simulate");
});

test("simulation_complete batch + ?step=approve renders Approve", () => {
  const batch = simulationCompleteBatch();
  const summary = simulationCompleteSummary();
  const routing = resolveWizardStepRouting(batch, summary, "approve");
  assert.equal(routing.renderedStep, "approve");
});

test("simulation_complete active step pill matches renderedStep", () => {
  const batch = simulationCompleteBatch();
  const summary = simulationCompleteSummary();
  const rendered = resolveWizardStepRouting(batch, summary, "simulate").renderedStep;
  const pills = ["map", "destination", "review", "simulate", "approve", "monitor", "results"];
  for (const pill of pills) {
    assert.equal(pill === rendered, pill === "simulate");
  }
});

test("no step param on simulation_complete defaults to Approve", () => {
  const batch = simulationCompleteBatch();
  const summary = simulationCompleteSummary();
  const routing = resolveWizardStepRouting(batch, summary, undefined);
  assert.equal(routing.renderedStep, "approve");
  assert.equal(deriveDefaultStep(batch, summary), "approve");
});
