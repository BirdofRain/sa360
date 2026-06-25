/**
 * Centralized mapping: ClientChannelProfileConfig fields → GHL custom value keys.
 *
 * GHL custom values are a workflow-readable mirror of the SA360 profile (SA360 Admin DB stays the
 * source of truth). Only the explicit, non-secret keys below are ever written. Values are formatted
 * for workflow readability: booleans → TRUE/FALSE, enums → UPPERCASE, numbers → numeric strings.
 */
import type { ClientChannelProfileFields } from "./client-channel-profile.constants.js";
import type { ClientChannelWriteMode } from "../../lib/client-channel-profile-env.js";

/** GHL custom value folder that holds the mirror keys. */
export const SA360_CLIENT_PROFILE_CUSTOM_VALUE_FOLDER = "SA360_CLIENT_PROFILE";

/**
 * Substrings that must NEVER appear in a custom value key we write. Defense-in-depth: the explicit
 * mapping below already excludes secrets, but the write path re-checks every key against these.
 */
export const RESTRICTED_CUSTOM_VALUE_SUBSTRINGS = [
  "TOKEN",
  "SECRET",
  "API_KEY",
  "PASSWORD",
  "PRIVATE",
  "OAUTH",
] as const;

export function isRestrictedCustomValueKey(key: string): boolean {
  const upper = key.toUpperCase();
  return RESTRICTED_CUSTOM_VALUE_SUBSTRINGS.some((bad) => upper.includes(bad));
}

function boolStr(value: boolean): string {
  return value ? "TRUE" : "FALSE";
}

function numStr(value: number): string {
  return String(Number.isFinite(value) ? Math.trunc(value) : 0);
}

export type ProfileMirrorMapEntry = {
  /** ClientChannelProfileConfig field (or `__effectiveMode` for the resolved write mode). */
  profileField: keyof ClientChannelProfileFields | "__effectiveMode";
  customValueKey: string;
  serialize: (
    profile: ClientChannelProfileFields,
    effectiveMode: ClientChannelWriteMode
  ) => string;
};

/** The complete, explicit set of mirrorable keys. Nothing outside this list is ever written. */
export const PROFILE_GHL_MIRROR_MAP: ProfileMirrorMapEntry[] = [
  { profileField: "blueEnabled", customValueKey: "SA360_CLIENT_BLUE_ENABLED", serialize: (p) => boolStr(p.blueEnabled) },
  { profileField: "greenEnabled", customValueKey: "SA360_CLIENT_GREEN_ENABLED", serialize: (p) => boolStr(p.greenEnabled) },
  { profileField: "voiceEnabled", customValueKey: "SA360_CLIENT_VOICE_ENABLED", serialize: (p) => boolStr(p.voiceEnabled) },
  { profileField: "closebotEnabled", customValueKey: "SA360_CLIENT_CLOSEBOT_ENABLED", serialize: (p) => boolStr(p.closebotEnabled) },
  { profileField: "ghlAiEnabled", customValueKey: "SA360_CLIENT_GHL_AI_ENABLED", serialize: (p) => boolStr(p.ghlAiEnabled) },
  { profileField: "aiProvider", customValueKey: "SA360_CLIENT_AI_PROVIDER", serialize: (p) => String(p.aiProvider).toUpperCase() },
  { profileField: "defaultLeadChannel", customValueKey: "SA360_CLIENT_DEFAULT_LEAD_CHANNEL", serialize: (p) => String(p.defaultLeadChannel).toUpperCase() },
  { profileField: "fallbackChannel", customValueKey: "SA360_CLIENT_FALLBACK_CHANNEL", serialize: (p) => String(p.fallbackChannel).toUpperCase() },
  {
    profileField: "requiresSameNumberContinuity",
    customValueKey: "SA360_CLIENT_REQUIRES_SAME_NUMBER_CONTINUITY",
    serialize: (p) => boolStr(p.requiresSameNumberContinuity),
  },
  { profileField: "preferredContactWindow", customValueKey: "SA360_CLIENT_PREFERRED_CONTACT_WINDOW", serialize: (p) => String(p.preferredContactWindow).toUpperCase() },
  { profileField: "textStartHour", customValueKey: "SA360_CLIENT_TEXT_START_HOUR", serialize: (p) => numStr(p.textStartHour) },
  { profileField: "textEndHour", customValueKey: "SA360_CLIENT_TEXT_END_HOUR", serialize: (p) => numStr(p.textEndHour) },
  {
    profileField: "sendblueMaxNoReplyAttempts",
    customValueKey: "SA360_CLIENT_SENDBLUE_MAX_NO_REPLY_ATTEMPTS",
    serialize: (p) => numStr(p.sendblueMaxNoReplyAttempts),
  },
  { profileField: "sendblueWindowDays", customValueKey: "SA360_CLIENT_SENDBLUE_WINDOW_DAYS", serialize: (p) => numStr(p.sendblueWindowDays) },
  { profileField: "applyDefaultScope", customValueKey: "SA360_EXISTING_LEAD_UPDATE_SCOPE", serialize: (p) => String(p.applyDefaultScope).toUpperCase() },
  {
    profileField: "__effectiveMode",
    customValueKey: "SA360_DELIVERY_MODE",
    serialize: (_p, effectiveMode) => String(effectiveMode).toUpperCase(),
  },
];

/** All mirror custom value keys (stable order). */
export const PROFILE_GHL_MIRROR_KEYS: string[] = PROFILE_GHL_MIRROR_MAP.map(
  (m) => m.customValueKey
);

export type ProfileMirrorValue = {
  key: string;
  value: string;
  profileField: string;
};

/**
 * Build the intended (key, value) pairs for a profile. Never emits null/undefined and never emits a
 * restricted key. `effectiveMode` is the clamped/effective write mode (used for SA360_DELIVERY_MODE).
 */
export function buildProfileMirrorValues(
  profile: ClientChannelProfileFields,
  effectiveMode: ClientChannelWriteMode
): ProfileMirrorValue[] {
  const out: ProfileMirrorValue[] = [];
  for (const entry of PROFILE_GHL_MIRROR_MAP) {
    if (isRestrictedCustomValueKey(entry.customValueKey)) continue;
    const raw = entry.serialize(profile, effectiveMode);
    const value = raw == null || raw === "" ? "" : String(raw);
    out.push({ key: entry.customValueKey, value, profileField: String(entry.profileField) });
  }
  return out;
}
