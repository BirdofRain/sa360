import test from "node:test";
import assert from "node:assert/strict";
import { DIRECT_DEMO_LIVE_CONFIRMATION_TEXT } from "./types.ts";

test("live confirmation gate requires exact phrase", () => {
  assert.notEqual("deliver one lead", DIRECT_DEMO_LIVE_CONFIRMATION_TEXT);
  assert.equal(DIRECT_DEMO_LIVE_CONFIRMATION_TEXT, "DELIVER ONE LEAD");
});
