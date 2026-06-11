import test from "node:test";
import assert from "node:assert/strict";
import {
  ENABLE_LIVE_CANARY_CONFIRMATION_TEXT,
  RETURN_TO_SIMULATE_CONFIRMATION_TEXT,
} from "./types.ts";

test("runtime mode confirmation constants match API contract", () => {
  assert.equal(ENABLE_LIVE_CANARY_CONFIRMATION_TEXT, "ENABLE LIVE CANARY");
  assert.equal(RETURN_TO_SIMULATE_CONFIRMATION_TEXT, "RETURN TO SIMULATE");
});
