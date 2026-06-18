import test from "node:test";
import assert from "node:assert/strict";
import { resolvePostActionWizardStep } from "./wizard-advance.js";
import { resolveActiveWizardStep } from "./wizard-steps.js";

test("stale destination step does not pin wizard after server advances to review", () => {
  const batch = {
    status: "ready_for_review",
    destinationClientAccountId: "client_a",
    destinationLocationIdGhl: "loc_a",
    wizardStepJson: { step: "review" },
  };
  const summary = { eligibleForSimulation: 0 };
  const step = resolveActiveWizardStep(batch, summary, "destination");
  assert.equal(step, "review");
});

test("stale review step does not pin wizard after normalization advances to simulate", () => {
  const batch = {
    status: "ready_for_simulation",
    destinationClientAccountId: "client_a",
    destinationLocationIdGhl: "loc_a",
    wizardStepJson: { step: "simulate" },
  };
  const summary = { eligibleForSimulation: 5 };
  const step = resolveActiveWizardStep(batch, summary, "review");
  assert.equal(step, "simulate");
});

test("resolvePostActionWizardStep prefers API nextStep", () => {
  const batch = {
    status: "ready_for_simulation",
    destinationClientAccountId: "client_a",
    destinationLocationIdGhl: "loc_a",
    wizardStepJson: { step: "simulate" },
  };
  const summary = { eligibleForSimulation: 5 };
  assert.equal(resolvePostActionWizardStep("simulate", batch, summary), "simulate");
  assert.equal(resolvePostActionWizardStep("approve", {
    ...batch,
    status: "simulation_complete",
    wizardStepJson: { step: "approve" },
  }, { ...summary, simulatedRows: 5 }), "approve");
});
