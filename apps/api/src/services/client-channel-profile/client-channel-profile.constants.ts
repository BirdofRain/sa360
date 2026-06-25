/**
 * Defaults + GHL discovery expectations for the client channel profile layer.
 * Pure constants/types — safe to import anywhere (no DB / no side effects).
 */

export const CLIENT_CHANNEL_AI_PROVIDERS = ["CLOSEBOT", "GHL_AI", "NONE"] as const;
export type ClientChannelAiProvider = (typeof CLIENT_CHANNEL_AI_PROVIDERS)[number];

export const CLIENT_CHANNEL_DEFAULT_LEAD_CHANNELS = ["AUTO", "BLUE", "GREEN"] as const;
export type ClientChannelDefaultLeadChannel =
  (typeof CLIENT_CHANNEL_DEFAULT_LEAD_CHANNELS)[number];

export const CLIENT_CHANNEL_FALLBACK_CHANNELS = ["GREEN", "NONE"] as const;
export type ClientChannelFallbackChannel = (typeof CLIENT_CHANNEL_FALLBACK_CHANNELS)[number];

export const CLIENT_CHANNEL_HEALTH_STATUSES = [
  "HEALTHY",
  "WARNING",
  "DEGRADED",
  "PAUSED",
] as const;
export type ClientChannelHealthStatus = (typeof CLIENT_CHANNEL_HEALTH_STATUSES)[number];

export const CLIENT_CHANNEL_PREFERRED_CONTACT_WINDOWS = [
  "ANYTIME_ALLOWED",
  "AFTERNOON_3_6",
  "EVENING",
  "CUSTOM",
] as const;
export type ClientChannelPreferredContactWindow =
  (typeof CLIENT_CHANNEL_PREFERRED_CONTACT_WINDOWS)[number];

export const CLIENT_CHANNEL_APPLY_SCOPES = [
  "NEW_LEADS_ONLY",
  "ACTIVE_UNLOCKED_ONLY",
  "FORCE_MIGRATE_SELECTED",
] as const;
export type ClientChannelApplyScope = (typeof CLIENT_CHANNEL_APPLY_SCOPES)[number];

export const CLIENT_CHANNEL_WRITE_MODES = ["simulate", "shadow", "live"] as const;
export type ClientChannelWriteMode = (typeof CLIENT_CHANNEL_WRITE_MODES)[number];

/** Normalized, fully-defaulted shape of a channel profile (no DB-only fields). */
export type ClientChannelProfileFields = {
  blueEnabled: boolean;
  greenEnabled: boolean;
  voiceEnabled: boolean;
  closebotEnabled: boolean;
  ghlAiEnabled: boolean;
  aiProvider: ClientChannelAiProvider;
  defaultLeadChannel: ClientChannelDefaultLeadChannel;
  fallbackChannel: ClientChannelFallbackChannel;
  requiresSameNumberContinuity: boolean;
  blueNumber: string | null;
  greenNumber: string | null;
  voiceNumber: string | null;
  blueHealthStatus: ClientChannelHealthStatus | null;
  greenHealthStatus: ClientChannelHealthStatus | null;
  sendblueMaxNoReplyAttempts: number;
  sendblueWindowDays: number;
  textStartHour: number;
  textEndHour: number;
  preferredContactWindow: ClientChannelPreferredContactWindow;
  applyDefaultScope: ClientChannelApplyScope;
  writeMode: ClientChannelWriteMode;
};

/** Default channel profile applied when no row exists yet. */
export const DEFAULT_CLIENT_CHANNEL_PROFILE: ClientChannelProfileFields = {
  blueEnabled: false,
  greenEnabled: true,
  voiceEnabled: false,
  closebotEnabled: false,
  ghlAiEnabled: false,
  aiProvider: "NONE",
  defaultLeadChannel: "AUTO",
  fallbackChannel: "GREEN",
  requiresSameNumberContinuity: true,
  blueNumber: null,
  greenNumber: null,
  voiceNumber: null,
  blueHealthStatus: null,
  greenHealthStatus: null,
  sendblueMaxNoReplyAttempts: 4,
  sendblueWindowDays: 4,
  textStartHour: 9,
  textEndHour: 21,
  preferredContactWindow: "ANYTIME_ALLOWED",
  applyDefaultScope: "NEW_LEADS_ONLY",
  writeMode: "simulate",
};

/** GHL custom fields the channel profile expects to exist for live operation (read-only check). */
export const CLIENT_CHANNEL_EXPECTED_CUSTOM_FIELDS = [
  "sa360_client_blue_enabled",
  "sa360_client_green_enabled",
  "sa360_client_voice_enabled",
  "sa360_client_ai_provider",
  "sa360_client_closebot_enabled",
  "sa360_client_ghl_ai_enabled",
  "sa360_client_default_lead_channel",
  "sa360_client_fallback_channel",
  "sa360_client_requires_same_number_continuity",
  "sa360_channel_mode",
  "sa360_channel_number",
  "sa360_channel_locked",
  "sa360_ai_provider_selected",
  "sa360_ai_mode",
  "sa360_voice_enabled",
  "sa360_call_in_progress",
  "sa360_sendblue_fallback_triggered",
  "sa360_booking_detected",
] as const;

/** GHL custom values (message templates) the channel profile expects for M2 fast-track flows. */
export const CLIENT_CHANNEL_EXPECTED_CUSTOM_VALUES = [
  "SA360_MSG_M2FT_BLUE_CONFIRM",
  "SA360_MSG_M2FT_BLUE_ATTEMPT",
  "SA360_MSG_M2FT_GREEN_CONFIRM",
  "SA360_MSG_M2FT_GREEN_ATTEMPT",
] as const;

export type ClientChannelReadinessStatus =
  | "READY"
  | "PARTIAL"
  | "MISSING_CONFIG"
  | "UNKNOWN";
