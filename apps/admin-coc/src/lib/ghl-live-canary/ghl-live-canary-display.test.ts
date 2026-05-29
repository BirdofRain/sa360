import test from "node:test";
import assert from "node:assert/strict";
import {
  ghlLiveRunStatusLabel,
  liveCanaryCanRunFromPreflight,
  truncateIdempotencyKey,
} from "./ghl-live-canary-display.ts";
import type { GhlLiveCanaryPreflight } from "./types.ts";

test("ghlLiveRunStatusLabel formats status", () => {
  assert.equal(ghlLiveRunStatusLabel("partial_success"), "partial success");
});

test("liveCanaryCanRunFromPreflight respects canExecute", () => {
  const ready = { canExecute: true } as GhlLiveCanaryPreflight;
  const blocked = { canExecute: false, blockers: ["x"] } as GhlLiveCanaryPreflight;
  assert.equal(liveCanaryCanRunFromPreflight(ready), true);
  assert.equal(liveCanaryCanRunFromPreflight(blocked), false);
  assert.equal(liveCanaryCanRunFromPreflight(null), false);
});

test("truncateIdempotencyKey shortens long keys", () => {
  const key = "a".repeat(64);
  const out = truncateIdempotencyKey(key);
  assert.ok(out.includes("…"));
  assert.ok(out.length < key.length);
});
