import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CLIENT_CHANNEL_PROFILE } from "./client-channel-profile.constants.js";
import {
  PROFILE_GHL_MIRROR_KEYS,
  PROFILE_GHL_MIRROR_MAP,
  buildProfileMirrorValues,
  isRestrictedCustomValueKey,
} from "./client-profile-ghl-mirror.mapping.js";

function profile(overrides: Partial<typeof DEFAULT_CLIENT_CHANNEL_PROFILE> = {}) {
  return { ...DEFAULT_CLIENT_CHANNEL_PROFILE, ...overrides };
}

test("all expected profile fields map to GHL custom value keys", () => {
  const keys = PROFILE_GHL_MIRROR_KEYS;
  for (const expected of [
    "SA360_CLIENT_BLUE_ENABLED",
    "SA360_CLIENT_GREEN_ENABLED",
    "SA360_CLIENT_VOICE_ENABLED",
    "SA360_CLIENT_CLOSEBOT_ENABLED",
    "SA360_CLIENT_GHL_AI_ENABLED",
    "SA360_CLIENT_AI_PROVIDER",
    "SA360_CLIENT_DEFAULT_LEAD_CHANNEL",
    "SA360_CLIENT_FALLBACK_CHANNEL",
    "SA360_CLIENT_REQUIRES_SAME_NUMBER_CONTINUITY",
    "SA360_CLIENT_PREFERRED_CONTACT_WINDOW",
    "SA360_CLIENT_TEXT_START_HOUR",
    "SA360_CLIENT_TEXT_END_HOUR",
    "SA360_CLIENT_SENDBLUE_MAX_NO_REPLY_ATTEMPTS",
    "SA360_CLIENT_SENDBLUE_WINDOW_DAYS",
    "SA360_EXISTING_LEAD_UPDATE_SCOPE",
    "SA360_DELIVERY_MODE",
  ]) {
    assert.ok(keys.includes(expected), `missing mapping for ${expected}`);
  }
  assert.equal(PROFILE_GHL_MIRROR_MAP.length, 16);
});

test("booleans serialize to TRUE/FALSE", () => {
  const values = buildProfileMirrorValues(
    profile({ blueEnabled: true, greenEnabled: false }),
    "simulate"
  );
  assert.equal(values.find((v) => v.key === "SA360_CLIENT_BLUE_ENABLED")?.value, "TRUE");
  assert.equal(values.find((v) => v.key === "SA360_CLIENT_GREEN_ENABLED")?.value, "FALSE");
});

test("enums serialize uppercase", () => {
  const values = buildProfileMirrorValues(
    profile({ aiProvider: "CLOSEBOT", defaultLeadChannel: "BLUE", blueEnabled: true }),
    "simulate"
  );
  assert.equal(values.find((v) => v.key === "SA360_CLIENT_AI_PROVIDER")?.value, "CLOSEBOT");
  assert.equal(values.find((v) => v.key === "SA360_CLIENT_DEFAULT_LEAD_CHANNEL")?.value, "BLUE");
});

test("hours/attempts/days serialize to numeric strings", () => {
  const values = buildProfileMirrorValues(
    profile({ textStartHour: 9, textEndHour: 21, sendblueMaxNoReplyAttempts: 4, sendblueWindowDays: 4 }),
    "simulate"
  );
  assert.equal(values.find((v) => v.key === "SA360_CLIENT_TEXT_START_HOUR")?.value, "9");
  assert.equal(values.find((v) => v.key === "SA360_CLIENT_SENDBLUE_WINDOW_DAYS")?.value, "4");
});

test("effective write mode maps to SA360_DELIVERY_MODE uppercase", () => {
  const values = buildProfileMirrorValues(profile(), "shadow");
  assert.equal(values.find((v) => v.key === "SA360_DELIVERY_MODE")?.value, "SHADOW");
});

test("never emits null/empty for defaults", () => {
  const values = buildProfileMirrorValues(profile(), "simulate");
  for (const v of values) {
    assert.ok(v.value !== null && v.value !== undefined && v.value.length > 0, `${v.key} empty`);
  }
});

test("restricted key names are detected and absent from the mapping", () => {
  for (const bad of [
    "SA360_OAUTH_TOKEN",
    "GHL_API_KEY",
    "SOME_SECRET",
    "USER_PASSWORD",
    "PRIVATE_THING",
  ]) {
    assert.equal(isRestrictedCustomValueKey(bad), true, `${bad} should be restricted`);
  }
  for (const key of PROFILE_GHL_MIRROR_KEYS) {
    assert.equal(isRestrictedCustomValueKey(key), false, `${key} must not be restricted`);
  }
});
