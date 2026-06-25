import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CLIENT_CHANNEL_PROFILE } from "./client-channel-profile.constants.js";
import { computeMirrorEntries } from "./client-profile-ghl-mirror.service.js";
import type { GhlCustomValue } from "../ghl-custom-value/ghl-custom-value-adapter.js";

function profile(overrides: Partial<typeof DEFAULT_CLIENT_CHANNEL_PROFILE> = {}) {
  return { ...DEFAULT_CLIENT_CHANNEL_PROFILE, ...overrides };
}

test("discovery null → all UNKNOWN actions, no crash, no secrets", () => {
  const entries = computeMirrorEntries(profile(), "simulate", null);
  assert.ok(entries.length > 0);
  assert.ok(entries.every((e) => e.action === "UNKNOWN"));
  assert.ok(entries.every((e) => !/TOKEN|SECRET|API_KEY|PASSWORD|PRIVATE|OAUTH/i.test(e.key)));
});

test("missing custom value → CREATE", () => {
  const discovered: GhlCustomValue[] = [];
  const entries = computeMirrorEntries(profile({ greenEnabled: true }), "simulate", discovered);
  const green = entries.find((e) => e.key === "SA360_CLIENT_GREEN_ENABLED");
  assert.equal(green?.action, "CREATE");
});

test("matching current value → NOOP; differing → UPDATE", () => {
  const discovered: GhlCustomValue[] = [
    { id: "cv1", name: "SA360_CLIENT_GREEN_ENABLED", value: "TRUE" },
    { id: "cv2", name: "SA360_CLIENT_BLUE_ENABLED", value: "FALSE" },
  ];
  const entries = computeMirrorEntries(
    profile({ greenEnabled: true, blueEnabled: true }),
    "simulate",
    discovered
  );
  const green = entries.find((e) => e.key === "SA360_CLIENT_GREEN_ENABLED");
  const blue = entries.find((e) => e.key === "SA360_CLIENT_BLUE_ENABLED");
  assert.equal(green?.action, "NOOP");
  assert.equal(green?.customValueId, "cv1");
  assert.equal(blue?.action, "UPDATE");
  assert.equal(blue?.intendedValue, "TRUE");
  assert.equal(blue?.customValueId, "cv2");
});
