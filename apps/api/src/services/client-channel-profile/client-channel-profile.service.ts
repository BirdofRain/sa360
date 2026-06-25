import { findClientAccountById } from "../../repositories/client-account.repository.js";
import {
  findClientChannelProfile,
  upsertClientChannelProfile,
} from "../../repositories/client-channel-profile.repository.js";
import {
  clampWriteModeToMax,
  getAdminConfigMaxWriteMode,
  type ClientChannelWriteMode,
} from "../../lib/client-channel-profile-env.js";
import type { ClientChannelProfileSaveBody } from "../../schemas/client-channel-profile.schema.js";
import {
  DEFAULT_CLIENT_CHANNEL_PROFILE,
  type ClientChannelProfileFields,
} from "./client-channel-profile.constants.js";
import {
  presentClientChannelProfile,
  rowToProfileFields,
  type ClientChannelProfileDto,
} from "./client-channel-profile.present.js";
import {
  validateChannelProfile,
  type ChannelProfileValidationIssue,
} from "./client-channel-profile-validation.js";
import {
  simulateChannelProfileConfigWrites,
  type ChannelProfileSimulation,
} from "./client-channel-profile-simulation.js";
import {
  validateClientChannelProfileReadiness,
  type ChannelProfileReadinessReport,
} from "./client-channel-profile-readiness.service.js";

export type WriteModeInfo = {
  effectiveWriteMode: ClientChannelWriteMode;
  maxWriteMode: ClientChannelWriteMode;
  requestedWriteMode: ClientChannelWriteMode;
  clamped: boolean;
  liveWritesEnabled: boolean;
};

export type GetClientChannelProfileResult =
  | {
      ok: true;
      data: {
        profile: ClientChannelProfileDto;
        defaultsApplied: boolean;
        writeMode: WriteModeInfo;
        readiness: ChannelProfileReadinessReport;
      };
    }
  | { ok: false; error: string; code: "CLIENT_NOT_FOUND" };

export type SaveClientChannelProfileResult =
  | {
      ok: true;
      data: {
        profile: ClientChannelProfileDto;
        writeMode: WriteModeInfo;
        simulation: ChannelProfileSimulation;
      };
    }
  | {
      ok: false;
      error: string;
      code: "CLIENT_NOT_FOUND" | "VALIDATION";
      details?: ChannelProfileValidationIssue[];
    };

function buildWriteModeInfo(requested: ClientChannelWriteMode): WriteModeInfo {
  const max = getAdminConfigMaxWriteMode();
  const { effective, clamped } = clampWriteModeToMax(requested, max);
  return {
    effectiveWriteMode: effective,
    maxWriteMode: max,
    requestedWriteMode: requested,
    clamped,
    liveWritesEnabled: false,
  };
}

/** Merge a partial save body onto a base (existing row fields or defaults). */
function mergeProfile(
  base: ClientChannelProfileFields,
  body: ClientChannelProfileSaveBody
): ClientChannelProfileFields {
  const pick = <T>(value: T | undefined, fallback: T): T =>
    value === undefined ? fallback : value;
  return {
    blueEnabled: pick(body.blueEnabled, base.blueEnabled),
    greenEnabled: pick(body.greenEnabled, base.greenEnabled),
    voiceEnabled: pick(body.voiceEnabled, base.voiceEnabled),
    closebotEnabled: pick(body.closebotEnabled, base.closebotEnabled),
    ghlAiEnabled: pick(body.ghlAiEnabled, base.ghlAiEnabled),
    aiProvider: pick(body.aiProvider, base.aiProvider),
    defaultLeadChannel: pick(body.defaultLeadChannel, base.defaultLeadChannel),
    fallbackChannel: pick(body.fallbackChannel, base.fallbackChannel),
    requiresSameNumberContinuity: pick(
      body.requiresSameNumberContinuity,
      base.requiresSameNumberContinuity
    ),
    blueNumber: pick(body.blueNumber, base.blueNumber),
    greenNumber: pick(body.greenNumber, base.greenNumber),
    voiceNumber: pick(body.voiceNumber, base.voiceNumber),
    blueHealthStatus: pick(body.blueHealthStatus, base.blueHealthStatus),
    greenHealthStatus: pick(body.greenHealthStatus, base.greenHealthStatus),
    sendblueMaxNoReplyAttempts: pick(
      body.sendblueMaxNoReplyAttempts,
      base.sendblueMaxNoReplyAttempts
    ),
    sendblueWindowDays: pick(body.sendblueWindowDays, base.sendblueWindowDays),
    textStartHour: pick(body.textStartHour, base.textStartHour),
    textEndHour: pick(body.textEndHour, base.textEndHour),
    preferredContactWindow: pick(body.preferredContactWindow, base.preferredContactWindow),
    applyDefaultScope: pick(body.applyDefaultScope, base.applyDefaultScope),
    writeMode: pick(body.writeMode, base.writeMode),
  };
}

export async function getClientChannelProfile(input: {
  clientAccountId: string;
  subaccountIdGhl?: string | null;
}): Promise<GetClientChannelProfileResult> {
  const client = await findClientAccountById(input.clientAccountId.trim());
  if (!client) {
    return { ok: false, error: "Client not found", code: "CLIENT_NOT_FOUND" };
  }

  const row = await findClientChannelProfile(input.clientAccountId, input.subaccountIdGhl);
  const profile = presentClientChannelProfile(
    client.clientAccountId,
    input.subaccountIdGhl ?? null,
    row
  );
  const readiness = await validateClientChannelProfileReadiness({
    clientAccountId: client.clientAccountId,
    subaccountIdGhl: input.subaccountIdGhl,
  });

  return {
    ok: true,
    data: {
      profile,
      defaultsApplied: !row,
      writeMode: buildWriteModeInfo(profile.writeMode),
      readiness,
    },
  };
}

export async function saveClientChannelProfile(input: {
  clientAccountId: string;
  body: ClientChannelProfileSaveBody;
}): Promise<SaveClientChannelProfileResult> {
  const client = await findClientAccountById(input.clientAccountId.trim());
  if (!client) {
    return { ok: false, error: "Client not found", code: "CLIENT_NOT_FOUND" };
  }

  const subaccountIdGhl = input.body.subaccountIdGhl ?? null;
  const existing = await findClientChannelProfile(input.clientAccountId, subaccountIdGhl);
  const base = existing ? rowToProfileFields(existing) : { ...DEFAULT_CLIENT_CHANNEL_PROFILE };
  const merged = mergeProfile(base, input.body);

  // Clamp write mode to the environment maximum BEFORE validation so force-migrate rules apply
  // to the effective (clamped) mode.
  const writeMode = buildWriteModeInfo(merged.writeMode);
  merged.writeMode = writeMode.effectiveWriteMode;

  const validation = validateChannelProfile(merged);
  if (!validation.ok) {
    return {
      ok: false,
      error: "Channel profile validation failed.",
      code: "VALIDATION",
      details: validation.issues,
    };
  }

  const saved = await upsertClientChannelProfile(input.clientAccountId, subaccountIdGhl, {
    blueEnabled: merged.blueEnabled,
    greenEnabled: merged.greenEnabled,
    voiceEnabled: merged.voiceEnabled,
    closebotEnabled: merged.closebotEnabled,
    ghlAiEnabled: merged.ghlAiEnabled,
    aiProvider: merged.aiProvider,
    defaultLeadChannel: merged.defaultLeadChannel,
    fallbackChannel: merged.fallbackChannel,
    requiresSameNumberContinuity: merged.requiresSameNumberContinuity,
    blueNumber: merged.blueNumber,
    greenNumber: merged.greenNumber,
    voiceNumber: merged.voiceNumber,
    blueHealthStatus: merged.blueHealthStatus,
    greenHealthStatus: merged.greenHealthStatus,
    sendblueMaxNoReplyAttempts: merged.sendblueMaxNoReplyAttempts,
    sendblueWindowDays: merged.sendblueWindowDays,
    textStartHour: merged.textStartHour,
    textEndHour: merged.textEndHour,
    preferredContactWindow: merged.preferredContactWindow,
    applyDefaultScope: merged.applyDefaultScope,
    writeMode: merged.writeMode,
  });

  const profile = presentClientChannelProfile(
    client.clientAccountId,
    subaccountIdGhl,
    saved
  );
  const targetLocation =
    subaccountIdGhl?.trim() ||
    client.ghlDestination?.destinationSubaccountIdGhl?.trim() ||
    null;
  const simulation = simulateChannelProfileConfigWrites({
    profile: rowToProfileFields(saved),
    targetLocation,
  });

  return { ok: true, data: { profile, writeMode, simulation } };
}

/**
 * Normalized read helper for future routing logic. Returns the effective channel decision inputs
 * with safe defaults applied. Never throws; falls back to defaults if the client/profile is missing.
 *
 * NOTE: this is informational/read-only. It does NOT change live routing decisions.
 */
export type NormalizedClientChannelProfile = {
  clientAccountId: string;
  subaccountIdGhl: string | null;
  exists: boolean;
  defaultLeadChannel: ClientChannelProfileFields["defaultLeadChannel"];
  fallbackChannel: ClientChannelProfileFields["fallbackChannel"];
  enabledChannels: { blue: boolean; green: boolean; voice: boolean };
  aiProvider: ClientChannelProfileFields["aiProvider"];
  voiceEnabled: boolean;
  requiresSameNumberContinuity: boolean;
  writeMode: ClientChannelWriteMode;
};

export async function getClientChannelProfileNormalized(
  clientAccountId: string,
  subaccountIdGhl?: string | null
): Promise<NormalizedClientChannelProfile> {
  let fields: ClientChannelProfileFields = { ...DEFAULT_CLIENT_CHANNEL_PROFILE };
  let exists = false;
  try {
    const row = await findClientChannelProfile(clientAccountId, subaccountIdGhl);
    if (row) {
      fields = rowToProfileFields(row);
      exists = true;
    }
  } catch {
    // Fall back to defaults; never throw into routing.
  }
  const { effective } = clampWriteModeToMax(fields.writeMode);
  return {
    clientAccountId: clientAccountId.trim(),
    subaccountIdGhl: subaccountIdGhl?.trim() || null,
    exists,
    defaultLeadChannel: fields.defaultLeadChannel,
    fallbackChannel: fields.fallbackChannel,
    enabledChannels: {
      blue: fields.blueEnabled,
      green: fields.greenEnabled,
      voice: fields.voiceEnabled,
    },
    aiProvider: fields.aiProvider,
    voiceEnabled: fields.voiceEnabled,
    requiresSameNumberContinuity: fields.requiresSameNumberContinuity,
    writeMode: effective,
  };
}
