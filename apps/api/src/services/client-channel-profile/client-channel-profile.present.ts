import type { ClientChannelProfileConfig } from "@prisma/client";
import {
  DEFAULT_CLIENT_CHANNEL_PROFILE,
  type ClientChannelAiProvider,
  type ClientChannelApplyScope,
  type ClientChannelDefaultLeadChannel,
  type ClientChannelFallbackChannel,
  type ClientChannelHealthStatus,
  type ClientChannelPreferredContactWindow,
  type ClientChannelProfileFields,
  type ClientChannelWriteMode,
} from "./client-channel-profile.constants.js";

export type ClientChannelProfileDto = ClientChannelProfileFields & {
  clientAccountId: string;
  subaccountIdGhl: string | null;
  /** True when a persisted row exists; false when defaults are being returned. */
  exists: boolean;
  lastValidatedAt: string | null;
  lastAppliedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

/** Extract the normalized, fully-defaulted profile fields from a DB row. */
export function rowToProfileFields(
  row: ClientChannelProfileConfig
): ClientChannelProfileFields {
  return {
    blueEnabled: row.blueEnabled,
    greenEnabled: row.greenEnabled,
    voiceEnabled: row.voiceEnabled,
    closebotEnabled: row.closebotEnabled,
    ghlAiEnabled: row.ghlAiEnabled,
    aiProvider: row.aiProvider as ClientChannelAiProvider,
    defaultLeadChannel: row.defaultLeadChannel as ClientChannelDefaultLeadChannel,
    fallbackChannel: row.fallbackChannel as ClientChannelFallbackChannel,
    requiresSameNumberContinuity: row.requiresSameNumberContinuity,
    blueNumber: row.blueNumber,
    greenNumber: row.greenNumber,
    voiceNumber: row.voiceNumber,
    blueHealthStatus: (row.blueHealthStatus as ClientChannelHealthStatus | null) ?? null,
    greenHealthStatus: (row.greenHealthStatus as ClientChannelHealthStatus | null) ?? null,
    sendblueMaxNoReplyAttempts: row.sendblueMaxNoReplyAttempts,
    sendblueWindowDays: row.sendblueWindowDays,
    textStartHour: row.textStartHour,
    textEndHour: row.textEndHour,
    preferredContactWindow:
      row.preferredContactWindow as ClientChannelPreferredContactWindow,
    applyDefaultScope: row.applyDefaultScope as ClientChannelApplyScope,
    writeMode: row.writeMode as ClientChannelWriteMode,
  };
}

export function presentClientChannelProfile(
  clientAccountId: string,
  subaccountIdGhl: string | null,
  row: ClientChannelProfileConfig | null
): ClientChannelProfileDto {
  const fields = row ? rowToProfileFields(row) : { ...DEFAULT_CLIENT_CHANNEL_PROFILE };
  const normalizedSub = subaccountIdGhl?.trim() || (row?.subaccountIdGhl ?? "");
  return {
    ...fields,
    clientAccountId: clientAccountId.trim(),
    subaccountIdGhl: normalizedSub ? normalizedSub : null,
    exists: Boolean(row),
    lastValidatedAt: row?.lastValidatedAt?.toISOString() ?? null,
    lastAppliedAt: row?.lastAppliedAt?.toISOString() ?? null,
    createdAt: row?.createdAt?.toISOString() ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}
