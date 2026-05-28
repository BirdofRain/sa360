import test from "node:test";
import assert from "node:assert/strict";
import {
  formatGhlAdapterValidation,
  ghlAdapterStatusLabel,
  redactRequestPreview,
} from "./ghl-adapter-display.ts";

test("ghlAdapterStatusLabel formats snake case", () => {
  assert.equal(ghlAdapterStatusLabel("failed_validation"), "failed validation");
});

test("formatGhlAdapterValidation joins errors", () => {
  const text = formatGhlAdapterValidation({
    valid: false,
    errors: ["Workflow missing"],
    warnings: [],
    missingConfig: ["destinationWorkflowIdGhl"],
  });
  assert.match(text, /Workflow missing/);
  assert.match(text, /destinationWorkflowIdGhl/);
});

test("redactRequestPreview redacts bearer tokens", () => {
  const out = redactRequestPreview({ auth: "Bearer secret-token" });
  assert.match(out, /REDACTED/);
  assert.doesNotMatch(out, /secret-token/);
});
