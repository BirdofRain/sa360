import test from "node:test";
import assert from "node:assert/strict";
import {
  filterStaleSimulationBlockers,
  ghlLiveRunStatusLabel,
  liveCanaryCanRunFromPreflight,
  liveCanarySimulationBadge,
  truncateIdempotencyKey,
} from "./ghl-live-canary-display.ts";
import type { GhlLiveCanaryPreflight } from "./types.ts";

const SIM_REQUIRED_BLOCKER =
  "Recent successful GHL adapter simulation is required before live canary. No adapter run found for this deliveryPlanId.";
const GATE_BLOCKERS = [
  "Adapter mode must be live_canary.",
  "deliveryEnabled must be true.",
  "deliveryMode must be live.",
  "clientCutoverApproved must be true.",
  "internalApprovalStatus must be approved.",
];

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

test("successful adapter simulation marks the canary badge passed (no reload needed)", () => {
  const badge = liveCanarySimulationBadge({
    preflight: { lastAdapterSimulationPassed: true } as GhlLiveCanaryPreflight,
    planId: "plan_1",
    simulatedPlanId: "plan_1",
  });
  assert.equal(badge.status, "passed");
  assert.equal(badge.label, "Simulation: passed");
});

test("no passing simulation for the current plan shows required", () => {
  const badge = liveCanarySimulationBadge({
    preflight: { lastAdapterSimulationPassed: false } as GhlLiveCanaryPreflight,
    planId: "plan_1",
    simulatedPlanId: null,
  });
  assert.equal(badge.status, "required");
  assert.equal(badge.label, "Simulation: required");
});

test("regenerating the delivery plan after simulation requires a new simulation", () => {
  const badge = liveCanarySimulationBadge({
    preflight: { lastAdapterSimulationPassed: false } as GhlLiveCanaryPreflight,
    planId: "plan_2_new",
    simulatedPlanId: "plan_1_old",
  });
  assert.equal(badge.status, "required_new_plan");
  assert.equal(badge.label, "Simulation: required for this new plan");
});

test("stale simulatedPlanId never falsely marks simulation as passed", () => {
  // Preflight is authoritative for the current plan; a stale simulatedPlanId cannot force "passed".
  const badge = liveCanarySimulationBadge({
    preflight: { lastAdapterSimulationPassed: false } as GhlLiveCanaryPreflight,
    planId: "plan_current",
    simulatedPlanId: "plan_stale",
  });
  assert.notEqual(badge.status, "passed");
});

test("filterStaleSimulationBlockers drops only the simulation-required blocker once passed", () => {
  const blockers = [SIM_REQUIRED_BLOCKER, ...GATE_BLOCKERS];
  const filtered = filterStaleSimulationBlockers(blockers, true);
  // The "No adapter run found" / "simulation is required" blocker is gone…
  assert.ok(!filtered.some((b) => b.toLowerCase().includes("no adapter run found")));
  assert.ok(!filtered.some((b) => b.toLowerCase().includes("simulation is required")));
  // …but every live gate blocker remains.
  for (const gate of GATE_BLOCKERS) {
    assert.ok(filtered.includes(gate));
  }
});

test("filterStaleSimulationBlockers keeps the simulation blocker when not passed", () => {
  const blockers = [SIM_REQUIRED_BLOCKER, ...GATE_BLOCKERS];
  const filtered = filterStaleSimulationBlockers(blockers, false);
  assert.deepEqual(filtered, blockers);
});
