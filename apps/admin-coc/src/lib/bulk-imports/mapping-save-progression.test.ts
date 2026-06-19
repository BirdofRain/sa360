import test from "node:test";
import assert from "node:assert/strict";
import {
  isMappingConfirmationRequired,
  isMappingSaveRequired,
  mappingSaveButtonLabel,
  resolveMappingSaveSuccessMessage,
  shouldAdvanceWizardAfterMappingSave,
  shouldNoOpMappingSave,
} from "./mapping-save-progression.js";

test("confirmation is required when mappingConfirmed is false", () => {
  assert.equal(isMappingConfirmationRequired(false), true);
  assert.equal(isMappingConfirmationRequired(true), false);
});

test("save is required for confirmation even without mapping changes", () => {
  assert.equal(isMappingSaveRequired({ mappingConfirmed: false, mappingChanged: false }), true);
  assert.equal(isMappingSaveRequired({ mappingConfirmed: true, mappingChanged: false }), false);
  assert.equal(isMappingSaveRequired({ mappingConfirmed: true, mappingChanged: true }), true);
});

test("no-op only when confirmed and unchanged", () => {
  assert.equal(shouldNoOpMappingSave({ mappingConfirmed: true, mappingChanged: false }), true);
  assert.equal(shouldNoOpMappingSave({ mappingConfirmed: false, mappingChanged: false }), false);
});

test("success message distinguishes confirmation from unchanged save", () => {
  assert.equal(
    resolveMappingSaveSuccessMessage({
      mappingChanged: false,
      confirmationChanged: true,
      resetPerformed: false,
    }),
    "Mapping confirmed. Opening Destination…"
  );
  assert.equal(
    resolveMappingSaveSuccessMessage({
      mappingChanged: false,
      confirmationChanged: false,
      resetPerformed: false,
    }),
    "No mapping changes to save."
  );
});

test("wizard advances for destination nextStep only", () => {
  assert.equal(shouldAdvanceWizardAfterMappingSave("destination"), true);
  assert.equal(shouldAdvanceWizardAfterMappingSave("map"), false);
  assert.equal(shouldAdvanceWizardAfterMappingSave(undefined), false);
});

test("confirmed edit uses Save changes label", () => {
  assert.equal(
    mappingSaveButtonLabel({ mappingConfirmed: true, mappingChanged: true }),
    "Save changes"
  );
});
