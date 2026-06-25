import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CLIENT_CHANNEL_PROFILE } from "./client-channel-profile.constants.js";
import { validateChannelProfile } from "./client-channel-profile-validation.js";

function profile(overrides: Partial<typeof DEFAULT_CLIENT_CHANNEL_PROFILE> = {}) {
  return { ...DEFAULT_CLIENT_CHANNEL_PROFILE, ...overrides };
}

test("default profile is valid (green enabled)", () => {
  const result = validateChannelProfile(profile());
  assert.equal(result.ok, true);
});

test("rejects when no channel enabled", () => {
  const result = validateChannelProfile(
    profile({ greenEnabled: false, blueEnabled: false, voiceEnabled: false })
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.field === "channels"));
  }
});

test("rejects BLUE default when blueEnabled is false", () => {
  const result = validateChannelProfile(
    profile({ defaultLeadChannel: "BLUE", blueEnabled: false })
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.field === "defaultLeadChannel"));
  }
});

test("accepts BLUE default when blueEnabled is true", () => {
  const result = validateChannelProfile(
    profile({ defaultLeadChannel: "BLUE", blueEnabled: true })
  );
  assert.equal(result.ok, true);
});

test("rejects GREEN fallback when greenEnabled is false", () => {
  const result = validateChannelProfile(
    profile({ greenEnabled: false, blueEnabled: true, fallbackChannel: "GREEN" })
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.field === "fallbackChannel"));
  }
});

test("rejects CLOSEBOT provider when closebotEnabled is false", () => {
  const result = validateChannelProfile(
    profile({ aiProvider: "CLOSEBOT", closebotEnabled: false })
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.field === "aiProvider"));
  }
});

test("rejects GHL_AI provider when ghlAiEnabled is false", () => {
  const result = validateChannelProfile(
    profile({ aiProvider: "GHL_AI", ghlAiEnabled: false })
  );
  assert.equal(result.ok, false);
});

test("rejects invalid hours", () => {
  const tooHigh = validateChannelProfile(profile({ textStartHour: 24 }));
  assert.equal(tooHigh.ok, false);
  const negative = validateChannelProfile(profile({ textEndHour: -1 }));
  assert.equal(negative.ok, false);
});

test("rejects end hour not after start hour", () => {
  const result = validateChannelProfile(profile({ textStartHour: 21, textEndHour: 9 }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.field === "textEndHour"));
  }
});

test("force migrate is rejected unless write mode is simulate", () => {
  const live = validateChannelProfile(
    profile({ applyDefaultScope: "FORCE_MIGRATE_SELECTED", writeMode: "live" })
  );
  assert.equal(live.ok, false);
  const simulated = validateChannelProfile(
    profile({ applyDefaultScope: "FORCE_MIGRATE_SELECTED", writeMode: "simulate" })
  );
  assert.equal(simulated.ok, true);
});
