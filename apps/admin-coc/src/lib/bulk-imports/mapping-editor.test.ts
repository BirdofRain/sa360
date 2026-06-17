import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomTarget,
  confidenceBadgeLabel,
  detectCanonicalConflicts,
  extractSampleValues,
  isReservedCustomKey,
  maskEmail,
  maskPhone,
  MAPPING_IGNORE,
  MAPPING_UNMAPPED,
  summarizeMapping,
} from "./mapping-editor.js";
import {
  canAccessWizardStep,
  deriveWizardStep,
  getCompletedWizardSteps,
  resolveActiveWizardStep,
} from "./wizard-steps.js";

test("confidence badges distinguish exact and alias matches", () => {
  assert.equal(
    confidenceBadgeLabel(
      { csvColumn: "phone", suggestedCanonical: "phone", confidence: "high", action: "map" },
      "phone"
    ),
    "Exact match"
  );
  assert.equal(
    confidenceBadgeLabel(
      {
        csvColumn: "Phone Number",
        suggestedCanonical: "phone",
        confidence: "high",
        action: "map",
      },
      "Phone Number"
    ),
    "Recognized alias"
  );
  assert.equal(
    confidenceBadgeLabel(
      { csvColumn: "x", suggestedCanonical: "phone", confidence: "low", action: "map" },
      "x"
    ),
    "Review recommended"
  );
  assert.equal(confidenceBadgeLabel(undefined, "vendor_extra"), "Unmapped");
});

test("sanitized sample values mask identity fields by default", () => {
  const samples = extractSampleValues(
    [{ rowNumber: 1, fields: { phone: "+12025550101", email: "alex@example.com" } }],
    "phone"
  );
  assert.match(samples[0] ?? "", /•••/);
  const emailSamples = extractSampleValues(
    [{ rowNumber: 1, fields: { email: "alex@example.com" } }],
    "email"
  );
  assert.match(emailSamples[0] ?? "", /•••@/);
  assert.equal(maskPhone("+12025550101"), "+1•••0101");
  assert.equal(maskEmail("alex@example.com"), "a•••@example.com");
});

test("duplicate canonical targets produce conflict", () => {
  const conflicts = detectCanonicalConflicts({
    phone: "phone",
    phone_number: "phone",
    first_name: "first_name",
  });
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0]?.csvColumns.sort(), ["phone", "phone_number"]);
});

test("reserved custom keys are rejected", () => {
  assert.equal(isReservedCustomKey("phone"), true);
  assert.equal(isReservedCustomKey("preferred_language"), false);
  assert.equal(buildCustomTarget("Preferred Language"), "custom:preferred_language");
});

test("summarize mapping counts actions", () => {
  const summary = summarizeMapping({
    first_name: "first_name",
    notes: MAPPING_UNMAPPED,
    junk: MAPPING_IGNORE,
    lang: buildCustomTarget("preferred_language"),
  });
  assert.equal(summary.standardMapped, 1);
  assert.equal(summary.preserved, 1);
  assert.equal(summary.ignored, 1);
  assert.equal(summary.customAttributes, 1);
});

test("reset to mapping immediately displays Mapping", () => {
  const batch = {
    status: "mapping_required",
    mappingJson: { first_name: "first_name" },
    wizardStepJson: { step: "map", missingRequired: ["phone"] },
  };
  const summary = {};
  assert.equal(resolveActiveWizardStep(batch, summary, "map"), "map");
  assert.equal(deriveWizardStep(batch, summary), "map");
  assert.equal(canAccessWizardStep("map", batch, summary), true);
});

test("reset to destination immediately displays Destination", () => {
  const batch = {
    status: "ready_for_review",
    mappingJson: { first_name: "first_name", phone: "phone" },
    wizardStepJson: { step: "destination", missingRequired: [] },
  };
  const summary = {};
  assert.equal(resolveActiveWizardStep(batch, summary, "destination"), "destination");
});

test("reset to review immediately displays Review", () => {
  const batch = {
    status: "ready_for_review",
    mappingJson: { first_name: "first_name", phone: "phone" },
    destinationClientAccountId: "client_1",
    destinationLocationIdGhl: "loc_1",
    wizardStepJson: { step: "review", missingRequired: [] },
  };
  const summary = { eligibleForSimulation: 0 };
  assert.equal(resolveActiveWizardStep(batch, summary, "review"), "review");
});

test("inaccessible future steps remain disabled after reset to mapping", () => {
  const batch = {
    status: "mapping_required",
    wizardStepJson: { step: "map", missingRequired: ["phone"] },
    mappingJson: { first_name: "first_name" },
  };
  const summary = {};
  const completed = getCompletedWizardSteps(batch, summary);
  assert.ok(completed.has("map"));
  assert.equal(canAccessWizardStep("simulate", batch, summary), false);
  assert.equal(canAccessWizardStep("approve", batch, summary), false);
});

test("requested URL step is validated before display", () => {
  const batch = {
    status: "mapping_required",
    wizardStepJson: { step: "map" },
    mappingJson: {},
  };
  const summary = {};
  assert.equal(resolveActiveWizardStep(batch, summary, "approve"), "map");
});
