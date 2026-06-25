import type { ClientChannelProfileFields } from "./client-channel-profile.constants.js";

export type ChannelProfileValidationIssue = {
  field: string;
  message: string;
};

export type ChannelProfileValidationResult =
  | { ok: true }
  | { ok: false; issues: ChannelProfileValidationIssue[] };

function isValidHour(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 23;
}

/**
 * Cross-field validation for a fully-merged channel profile. Pure (no DB / no throws) so it can be
 * exercised by the save service and unit tests alike.
 *
 * `forceMigrateAllowed` defaults to false: in this patch, FORCE_MIGRATE_SELECTED may only be saved
 * when the write mode is `simulate` (simulation/dry-run only).
 */
export function validateChannelProfile(
  config: ClientChannelProfileFields
): ChannelProfileValidationResult {
  const issues: ChannelProfileValidationIssue[] = [];

  if (!config.blueEnabled && !config.greenEnabled && !config.voiceEnabled) {
    issues.push({
      field: "channels",
      message: "At least one of Blue, Green, or Voice must be enabled.",
    });
  }

  if (config.defaultLeadChannel === "BLUE" && !config.blueEnabled) {
    issues.push({
      field: "defaultLeadChannel",
      message: "Default lead channel is BLUE but Blue is not enabled.",
    });
  }
  if (config.defaultLeadChannel === "GREEN" && !config.greenEnabled) {
    issues.push({
      field: "defaultLeadChannel",
      message: "Default lead channel is GREEN but Green is not enabled.",
    });
  }

  if (config.fallbackChannel === "GREEN" && !config.greenEnabled) {
    issues.push({
      field: "fallbackChannel",
      message: "Fallback channel is GREEN but Green is not enabled.",
    });
  }

  if (config.aiProvider === "CLOSEBOT" && !config.closebotEnabled) {
    issues.push({
      field: "aiProvider",
      message: "AI provider is CLOSEBOT but CloseBot is not enabled.",
    });
  }
  if (config.aiProvider === "GHL_AI" && !config.ghlAiEnabled) {
    issues.push({
      field: "aiProvider",
      message: "AI provider is GHL_AI but GHL AI is not enabled.",
    });
  }

  if (!isValidHour(config.textStartHour)) {
    issues.push({ field: "textStartHour", message: "Text start hour must be between 0 and 23." });
  }
  if (!isValidHour(config.textEndHour)) {
    issues.push({ field: "textEndHour", message: "Text end hour must be between 0 and 23." });
  }
  if (
    isValidHour(config.textStartHour) &&
    isValidHour(config.textEndHour) &&
    config.textEndHour <= config.textStartHour
  ) {
    issues.push({
      field: "textEndHour",
      message: "Text end hour must be later than text start hour.",
    });
  }

  if (config.applyDefaultScope === "FORCE_MIGRATE_SELECTED" && config.writeMode !== "simulate") {
    issues.push({
      field: "applyDefaultScope",
      message:
        "Force migrate selected leads is simulation-only in this version; write mode must be simulate.",
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true };
}
