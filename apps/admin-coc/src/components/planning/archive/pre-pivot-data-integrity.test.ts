import assert from "node:assert/strict";
import test from "node:test";
import { WORKFLOW_MODULES } from "../workflow/workflow-data.ts";
import { PRE_PIVOT_WORKFLOW_MODULES } from "./pre-pivot-workflow-data.ts";
import { PIVOT_COMPARISON_ROWS } from "./pre-pivot-compare-data.ts";

test("archived pre-pivot workflow data does not replace current LF workflow map", () => {
  assert.equal(WORKFLOW_MODULES[0]?.id, "LF1");
  assert.equal(PRE_PIVOT_WORKFLOW_MODULES[0]?.id, "M1");
  assert.notEqual(WORKFLOW_MODULES[0]?.id, PRE_PIVOT_WORKFLOW_MODULES[0]?.id);
});

test("pivot comparison includes legacy and deprecated roadmap boundary rows", () => {
  const hasLegacy = PIVOT_COMPARISON_ROWS.some((r) => r.status === "Legacy / Retainer Only");
  const hasDeprecated = PIVOT_COMPARISON_ROWS.some(
    (r) => r.status === "Deprecated / Do Not Build"
  );
  assert.equal(hasLegacy, true);
  assert.equal(hasDeprecated, true);
});
