import {
  clampWriteModeToMax,
  getAdminConfigMaxWriteMode,
  type ClientChannelWriteMode,
} from "../../lib/client-channel-profile-env.js";
import type { ClientChannelProfileFields } from "./client-channel-profile.constants.js";

export type SimulatedConfigWrite = {
  fieldName: string;
  intendedValue: string;
  targetLocation: string | null;
  writeMode: ClientChannelWriteMode;
  skippedReason: string | null;
};

export type ChannelProfileSimulation = {
  writeMode: ClientChannelWriteMode;
  maxWriteMode: ClientChannelWriteMode;
  liveWritesPerformed: false;
  configWrites: SimulatedConfigWrite[];
  notes: string[];
};

function boolStr(value: boolean): string {
  return value ? "true" : "false";
}

/**
 * Produce a simulation of the GHL custom-value / client-config writes that WOULD be performed for a
 * channel profile. This patch never performs live writes; every entry is annotated with a skip reason
 * unless the effective write mode is `live` (in which case `liveWritesPerformed` is still false here
 * because no live transport is wired yet).
 */
export function simulateChannelProfileConfigWrites(input: {
  profile: ClientChannelProfileFields;
  targetLocation: string | null;
}): ChannelProfileSimulation {
  const max = getAdminConfigMaxWriteMode();
  const { effective, clamped } = clampWriteModeToMax(input.profile.writeMode, max);
  const target = input.targetLocation;

  const skipReason =
    effective === "live"
      ? "Live config writes are not wired in this version (simulation only)."
      : `Write mode is ${effective}; no GHL write is performed.`;

  const p = input.profile;
  const mappings: Array<[string, string]> = [
    ["sa360_client_blue_enabled", boolStr(p.blueEnabled)],
    ["sa360_client_green_enabled", boolStr(p.greenEnabled)],
    ["sa360_client_voice_enabled", boolStr(p.voiceEnabled)],
    ["sa360_client_ai_provider", p.aiProvider],
    ["sa360_client_closebot_enabled", boolStr(p.closebotEnabled)],
    ["sa360_client_ghl_ai_enabled", boolStr(p.ghlAiEnabled)],
    ["sa360_client_default_lead_channel", p.defaultLeadChannel],
    ["sa360_client_fallback_channel", p.fallbackChannel],
    ["sa360_client_requires_same_number_continuity", boolStr(p.requiresSameNumberContinuity)],
    ["sa360_ai_provider_selected", p.aiProvider],
    ["sa360_voice_enabled", boolStr(p.voiceEnabled)],
  ];

  const configWrites: SimulatedConfigWrite[] = mappings.map(([fieldName, intendedValue]) => ({
    fieldName,
    intendedValue,
    targetLocation: target,
    writeMode: effective,
    skippedReason: skipReason,
  }));

  const notes: string[] = [
    "No live GHL writes are performed in this version.",
  ];
  if (clamped) {
    notes.push(
      `Requested write mode "${input.profile.writeMode}" was clamped to environment max "${max}".`
    );
  }
  if (!target) {
    notes.push("No target GHL location resolved; writes would have no destination.");
  }

  return {
    writeMode: effective,
    maxWriteMode: max,
    liveWritesPerformed: false,
    configWrites,
    notes,
  };
}
