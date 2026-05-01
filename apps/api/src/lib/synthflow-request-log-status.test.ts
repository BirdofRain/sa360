import test from "node:test";
import assert from "node:assert/strict";
import { deriveSynthflowProcessingStatus } from "./synthflow-request-log-status.js";

test("deriveSynthflowProcessingStatus maps lookup outcomes", () => {
  assert.equal(deriveSynthflowProcessingStatus("matched_local"), "matched_local");
  assert.equal(deriveSynthflowProcessingStatus("matched_ghl"), "matched_ghl");
  assert.equal(deriveSynthflowProcessingStatus("not_found"), "not_found");
  assert.equal(deriveSynthflowProcessingStatus("not_found_local"), "not_found_local");
  assert.equal(deriveSynthflowProcessingStatus("lookup_error"), "lookup_error");
  assert.equal(deriveSynthflowProcessingStatus("invalid_payload"), "validation_failed");
  assert.equal(deriveSynthflowProcessingStatus("internal_error"), "guardrail");
  assert.equal(deriveSynthflowProcessingStatus("disabled"), "guardrail");
  assert.equal(deriveSynthflowProcessingStatus("invalid_phone"), "guardrail");
  assert.equal(deriveSynthflowProcessingStatus("error"), "failed");
  assert.equal(deriveSynthflowProcessingStatus("unknown_xyz"), "failed");
});
