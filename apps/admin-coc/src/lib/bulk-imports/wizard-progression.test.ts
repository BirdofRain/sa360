import test from "node:test";
import assert from "node:assert/strict";
import { resolvePostActionWizardStep } from "./wizard-advance.js";
import { resolveActiveWizardStep } from "./wizard-steps.js";

test("ready_for_review batch honors ?step=destination over persisted review", () => {
  const batch = {
    status: "ready_for_review",
    destinationClientAccountId: "client_a",
    destinationLocationIdGhl: "loc_a",
    wizardStepJson: { step: "review", mappingConfirmed: true },
    mappingJson: { first_name: "first_name", phone: "phone" },
  };
  const summary = { eligibleForSimulation: 0, totalRows: 1, normalizedSourceEvents: 0 };
  const step = resolveActiveWizardStep(batch, summary, "destination");
  assert.equal(step, "destination");
});

test("ready_for_review batch honors ?step=review when requested", () => {
  const batch = {
    status: "ready_for_review",
    destinationClientAccountId: "client_a",
    destinationLocationIdGhl: "loc_a",
    wizardStepJson: { step: "review", mappingConfirmed: true },
    mappingJson: { first_name: "first_name", phone: "phone" },
  };
  const summary = { eligibleForSimulation: 0, totalRows: 1 };
  assert.equal(resolveActiveWizardStep(batch, summary, "review"), "review");
});

test("normalization progress does not override explicit ?step=review", () => {
  const batch = {
    status: "ready_for_simulation",
    destinationClientAccountId: "client_a",
    destinationLocationIdGhl: "loc_a",
    wizardStepJson: { step: "simulate", mappingConfirmed: true },
    mappingJson: { first_name: "first_name", phone: "phone" },
  };
  const summary = { eligibleForSimulation: 5, normalizedSourceEvents: 5 };
  assert.equal(resolveActiveWizardStep(batch, summary, "review"), "review");
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
  assert.equal(
    resolvePostActionWizardStep(
      "approve",
      {
        ...batch,
        status: "simulation_complete",
        wizardStepJson: { step: "approve" },
      },
      { ...summary, simulatedRows: 5 }
    ),
    "approve"
  );
});
