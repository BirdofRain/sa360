/** Shared types for the client channel profile settings surface (mirrors @sa360/api DTOs). */

export const CHANNEL_AI_PROVIDERS = ["CLOSEBOT", "GHL_AI", "NONE"] as const;
export type ChannelAiProvider = (typeof CHANNEL_AI_PROVIDERS)[number];

export const CHANNEL_DEFAULT_LEAD_CHANNELS = ["AUTO", "BLUE", "GREEN"] as const;
export type ChannelDefaultLeadChannel = (typeof CHANNEL_DEFAULT_LEAD_CHANNELS)[number];

export const CHANNEL_FALLBACK_CHANNELS = ["GREEN", "NONE"] as const;
export type ChannelFallbackChannel = (typeof CHANNEL_FALLBACK_CHANNELS)[number];

export const CHANNEL_HEALTH_STATUSES = ["HEALTHY", "WARNING", "DEGRADED", "PAUSED"] as const;
export type ChannelHealthStatus = (typeof CHANNEL_HEALTH_STATUSES)[number];

export const CHANNEL_PREFERRED_CONTACT_WINDOWS = [
  "ANYTIME_ALLOWED",
  "AFTERNOON_3_6",
  "EVENING",
  "CUSTOM",
] as const;
export type ChannelPreferredContactWindow =
  (typeof CHANNEL_PREFERRED_CONTACT_WINDOWS)[number];

export const CHANNEL_APPLY_SCOPES = [
  "NEW_LEADS_ONLY",
  "ACTIVE_UNLOCKED_ONLY",
  "FORCE_MIGRATE_SELECTED",
] as const;
export type ChannelApplyScope = (typeof CHANNEL_APPLY_SCOPES)[number];

export const CHANNEL_WRITE_MODES = ["simulate", "shadow", "live"] as const;
export type ChannelWriteMode = (typeof CHANNEL_WRITE_MODES)[number];

export type ChannelProfile = {
  clientAccountId: string;
  subaccountIdGhl: string | null;
  exists: boolean;
  blueEnabled: boolean;
  greenEnabled: boolean;
  voiceEnabled: boolean;
  closebotEnabled: boolean;
  ghlAiEnabled: boolean;
  aiProvider: ChannelAiProvider;
  defaultLeadChannel: ChannelDefaultLeadChannel;
  fallbackChannel: ChannelFallbackChannel;
  requiresSameNumberContinuity: boolean;
  blueNumber: string | null;
  greenNumber: string | null;
  voiceNumber: string | null;
  blueHealthStatus: ChannelHealthStatus | null;
  greenHealthStatus: ChannelHealthStatus | null;
  sendblueMaxNoReplyAttempts: number;
  sendblueWindowDays: number;
  textStartHour: number;
  textEndHour: number;
  preferredContactWindow: ChannelPreferredContactWindow;
  applyDefaultScope: ChannelApplyScope;
  writeMode: ChannelWriteMode;
  lastValidatedAt: string | null;
  lastAppliedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ChannelWriteModeInfo = {
  effectiveWriteMode: ChannelWriteMode;
  maxWriteMode: ChannelWriteMode;
  requestedWriteMode: ChannelWriteMode;
  clamped: boolean;
  liveWritesEnabled: boolean;
};

export type ChannelReadinessStatus = "READY" | "PARTIAL" | "MISSING_CONFIG" | "UNKNOWN";

export type ChannelReadinessReport = {
  status: ChannelReadinessStatus;
  locationId: string | null;
  snapshotFetchedAt: string | null;
  installedFields: string[];
  missingFields: string[];
  installedCustomValues: string[];
  missingCustomValues: string[];
  unverifiedCustomValues: string[];
  customValuesVerified: boolean;
  canApplyProfileToGhl: boolean;
  warnings: string[];
  notes: string[];
};

export type MirrorLiveGuardrailChecks = {
  featureEnabled: boolean;
  maxModeIsLive: boolean;
  effectiveModeIsLive: boolean;
  hasClientAllowlist: boolean;
  hasLocationAllowlist: boolean;
  clientAllowlisted: boolean;
  locationPresent: boolean;
  locationAllowlisted: boolean;
};

export type MirrorLiveGuardrailResult = {
  liveAllowed: boolean;
  checks: MirrorLiveGuardrailChecks;
  blockers: string[];
};

export type ChannelMirrorSummary = {
  targetLocation: string | null;
  liveAllowed: boolean;
  guardrails: MirrorLiveGuardrailResult;
};

export type MirrorAction = "CREATE" | "UPDATE" | "NOOP" | "SKIP" | "UNKNOWN";

export type ChannelMirrorPlanEntry = {
  key: string;
  intendedValue: string;
  currentValue: string | null;
  action: MirrorAction;
  customValueId: string | null;
  skipReason: string | null;
};

export type ChannelMirrorPlan = {
  clientAccountId: string;
  subaccountIdGhl: string | null;
  targetLocation: string | null;
  writeMode: ChannelWriteMode;
  maxWriteMode: ChannelWriteMode;
  discoveryAvailable: boolean;
  entries: ChannelMirrorPlanEntry[];
  liveWritesPerformed: false;
  notes: string[];
};

export type ChannelMirrorApplyEntryResult = ChannelMirrorPlanEntry & {
  status: "written" | "would_write" | "skipped" | "failed" | "simulated";
  error?: string;
};

export type ChannelMirrorApplyResult = {
  clientAccountId: string;
  subaccountIdGhl: string | null;
  targetLocation: string | null;
  writeMode: ChannelWriteMode;
  maxWriteMode: ChannelWriteMode;
  resultStatus:
    | "simulated"
    | "shadow_logged"
    | "live_applied"
    | "live_partial"
    | "blocked"
    | "error";
  liveWritesPerformed: boolean;
  guardrails: MirrorLiveGuardrailResult;
  valuesAttempted: number;
  valuesWritten: number;
  valuesSkipped: number;
  results: ChannelMirrorApplyEntryResult[];
  errorSummary: string | null;
  notes: string[];
};

export type ChannelImpactBucket = { count: number | null; note?: string };

export type ChannelImpactPreview = {
  available: boolean;
  message: string;
  applyScope: ChannelApplyScope | null;
  dataSource: "inbound_contact_index" | null;
  totalIndexedContacts: number;
  buckets: {
    newLeadsAffected: ChannelImpactBucket;
    activeLockedLeadsAffected: ChannelImpactBucket;
    activeUnlockedLeadsAffected: ChannelImpactBucket;
    eligibleForRecalculation: ChannelImpactBucket;
    requiresReview: ChannelImpactBucket;
    skippedChannelLocked: ChannelImpactBucket;
    skippedDncDeadOrBadNumber: ChannelImpactBucket;
  };
  notes: string[];
};

export type ChannelSimulatedConfigWrite = {
  fieldName: string;
  intendedValue: string;
  targetLocation: string | null;
  writeMode: ChannelWriteMode;
  skippedReason: string | null;
};

export type ChannelProfileSimulation = {
  writeMode: ChannelWriteMode;
  maxWriteMode: ChannelWriteMode;
  liveWritesPerformed: false;
  configWrites: ChannelSimulatedConfigWrite[];
  notes: string[];
};

export type GetChannelProfileResponse = {
  ok: boolean;
  data: {
    profile: ChannelProfile;
    defaultsApplied: boolean;
    writeMode: ChannelWriteModeInfo;
    readiness: ChannelReadinessReport;
    mirror: ChannelMirrorSummary;
  };
};

export type SaveChannelProfileResponse = {
  ok: boolean;
  data: {
    profile: ChannelProfile;
    writeMode: ChannelWriteModeInfo;
    simulation: ChannelProfileSimulation;
  };
};

export type ChannelProfileValidationDetail = { field: string; message: string };

/** Editable subset of profile fields submitted from the form. */
export type ChannelProfileSaveInput = Partial<
  Pick<
    ChannelProfile,
    | "subaccountIdGhl"
    | "blueEnabled"
    | "greenEnabled"
    | "voiceEnabled"
    | "closebotEnabled"
    | "ghlAiEnabled"
    | "aiProvider"
    | "defaultLeadChannel"
    | "fallbackChannel"
    | "requiresSameNumberContinuity"
    | "blueNumber"
    | "greenNumber"
    | "voiceNumber"
    | "blueHealthStatus"
    | "greenHealthStatus"
    | "sendblueMaxNoReplyAttempts"
    | "sendblueWindowDays"
    | "textStartHour"
    | "textEndHour"
    | "preferredContactWindow"
    | "applyDefaultScope"
    | "writeMode"
  >
>;
