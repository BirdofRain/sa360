import assert from "node:assert/strict";
import test from "node:test";
import { validateDestinationSaveResponse } from "./destination-save-response.ts";

test("malformed destination response produces inline error", () => {
  const result = validateDestinationSaveResponse({ nextStep: "review" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /batch/i);
  }
});

test("destination save response normalizes missing rows to array", () => {
  const result = validateDestinationSaveResponse({
    batch: { id: "batch_1", status: "ready_for_review" },
    summary: { totalRows: 1 },
    nextStep: "review",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data.rows, []);
    assert.equal(result.data.nextStep, "review");
  }
});

test("invalid nextStep falls back to review", () => {
  const result = validateDestinationSaveResponse({
    batch: { id: "batch_1" },
    summary: {},
    nextStep: "not-a-step",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.nextStep, "review");
});
