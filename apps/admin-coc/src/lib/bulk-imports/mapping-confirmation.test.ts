import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessWizardStep,
  deriveWizardStep,
  resolveActiveWizardStep,
} from "./wizard-steps.ts";

test("map step is accessible when batch has raw rows", () => {
  const batch = {
    status: "ready_for_simulation",
    mappingJson: { first_name: "first_name", phone: "phone" },
    destinationClientAccountId: "client-1",
    destinationLocationIdGhl: "loc-1",
    wizardStepJson: {
      step: "simulate",
      mappingConfirmed: true,
      headers: ["first_name", "phone"],
    },
  };
  const summary = { totalRows: 5, eligibleForSimulation: 5, simulatedRows: 0 };

  assert.equal(canAccessWizardStep("map", batch, summary), true);
  assert.equal(resolveActiveWizardStep(batch, summary, "map"), "map");
});

test("deriveWizardStep stays on map until mapping is confirmed", () => {
  const batch = {
    status: "mapping_required",
    mappingJson: { first_name: "first_name" },
    destinationClientAccountId: null,
    destinationLocationIdGhl: null,
    wizardStepJson: {
      step: "destination",
      mappingConfirmed: false,
      headers: ["first_name"],
    },
  };
  assert.equal(deriveWizardStep(batch, { totalRows: 5 }), "map");
});

test("requested map step is honored for batches with saved mapping", () => {
  const batch = {
    status: "ready_for_simulation",
    mappingJson: { first_name: "first_name", phone: "phone" },
    destinationClientAccountId: "client-1",
    destinationLocationIdGhl: "loc-1",
    wizardStepJson: {
      step: "simulate",
      mappingConfirmed: true,
    },
  };
  const summary = { totalRows: 5, eligibleForSimulation: 5 };
  assert.equal(resolveActiveWizardStep(batch, summary, "map"), "map");
});
