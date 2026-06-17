import test from "node:test";
import assert from "node:assert/strict";
import {
  canAccessWizardStep,
  getCompletedWizardSteps,
  requiresResetForWizardNavigation,
} from "./wizard-steps.js";

test("completed steps allow backward navigation", () => {
  const batch = {
    status: "ready_for_simulation",
    mappingJson: { first_name: "first_name" },
    destinationClientAccountId: "client_1",
    destinationLocationIdGhl: "loc_1",
    wizardStepJson: { step: "simulate" },
  };
  const summary = { eligibleForSimulation: 3, simulatedRows: 0 };
  const completed = getCompletedWizardSteps(batch, summary);
  assert.ok(completed.has("map"));
  assert.ok(completed.has("destination"));
  assert.ok(completed.has("review"));
  assert.ok(canAccessWizardStep("map", batch, summary));
  assert.ok(canAccessWizardStep("destination", batch, summary));
});

test("incomplete future steps remain disabled", () => {
  const batch = {
    status: "mapping_required",
    mappingJson: {},
    wizardStepJson: { step: "map" },
  };
  const summary = {};
  assert.equal(canAccessWizardStep("simulate", batch, summary), false);
  assert.equal(canAccessWizardStep("approve", batch, summary), false);
});

test("viewing mapping step does not require reset confirmation", () => {
  const batch = {
    status: "ready_for_review",
    mappingJson: { first_name: "first_name" },
    destinationClientAccountId: "client_1",
    wizardStepJson: { step: "review" },
  };
  const summary = { eligibleForSimulation: 2, normalizedSourceEvents: 5 };
  assert.equal(requiresResetForWizardNavigation("map", batch, summary), null);
});

test("translateBulkImportApiError maps normalization_incomplete", async () => {
  const { translateBulkImportApiError } = await import("./action-results.js");
  assert.match(
    translateBulkImportApiError("normalization_incomplete"),
    /Source Intake records/
  );
});

test("changing destination after simulation prompts reset warning", () => {
  const batch = {
    status: "simulation_complete",
    mappingJson: { first_name: "first_name" },
    destinationClientAccountId: "client_1",
    destinationLocationIdGhl: "loc_1",
    simulatedRows: 2,
    wizardStepJson: { step: "approve" },
  };
  const summary = { simulatedRows: 2, eligibleForSimulation: 2 };
  assert.equal(requiresResetForWizardNavigation("destination", batch, summary)?.target, "destination");
});
