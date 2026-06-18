import assert from "node:assert/strict";
import test from "node:test";

import {
  clearWizardActionError,
  isStaleSimulationError,
  type WizardActionError,
} from "./wizard-action-errors.ts";

const staleSimulateError: WizardActionError = {
  action: "simulate",
  code: "no_eligible_rows_for_simulation",
  message: "No eligible rows were available for simulation.",
};

test("isStaleSimulationError is true when eligible count becomes positive", () => {
  assert.equal(isStaleSimulationError(staleSimulateError, 0), false);
  assert.equal(isStaleSimulationError(staleSimulateError, 3), true);
});

test("isStaleSimulationError ignores non-simulate errors", () => {
  const normalizeError: WizardActionError = {
    action: "normalize",
    message: "No eligible rows were available for simulation.",
  };
  assert.equal(isStaleSimulationError(normalizeError, 5), false);
});

test("clearWizardActionError removes stale simulation errors when eligible count rises", () => {
  assert.equal(
    clearWizardActionError(staleSimulateError, { eligibleForSimulation: 2 }),
    null
  );
});

test("clearWizardActionError keeps active simulation errors while eligible count stays zero", () => {
  assert.equal(
    clearWizardActionError(staleSimulateError, { eligibleForSimulation: 0 }),
    staleSimulateError
  );
});

test("clearWizardActionError clears simulate errors on step change", () => {
  assert.equal(clearWizardActionError(staleSimulateError, { stepChanged: true }), null);
});

test("clearWizardActionError clears all errors when import changes", () => {
  const approveError: WizardActionError = {
    action: "approve",
    message: "confirmation required",
  };
  assert.equal(clearWizardActionError(approveError, { importChanged: true }), null);
});

test("clearWizardActionError keeps unrelated errors on eligible count refresh", () => {
  const normalizationError: WizardActionError = {
    action: "simulate",
    code: "normalization_incomplete",
    message: "Eligible identities are missing normalized Source Intake records.",
  };
  assert.equal(
    clearWizardActionError(normalizationError, { eligibleForSimulation: 4 }),
    normalizationError
  );
});
