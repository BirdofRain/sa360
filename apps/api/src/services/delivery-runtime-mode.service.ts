import type { DeliveryRuntimeModeSetting, Prisma } from "@prisma/client";
import {
  clearEffectiveAdapterModeOverride,
  getGhlDeliveryAdapterMaxMode,
  setEffectiveAdapterModeFromResolved,
  type GhlAdapterMaxMode,
  type GhlAdapterMode,
  isMaxModeLiveCanaryCapable,
} from "../lib/ghl-delivery-adapter-mode.js";
import {
  createDeliveryRuntimeModeAuditEvent,
  findDeliveryRuntimeModeSetting,
  upsertDeliveryRuntimeModeSetting,
} from "../repositories/delivery-runtime-mode.repository.js";

export const RUNTIME_ADAPTER_MODES = ["simulate", "live_canary"] as const;
export type RuntimeAdapterMode = (typeof RUNTIME_ADAPTER_MODES)[number];

export const ENABLE_LIVE_CANARY_CONFIRMATION_TEXT = "ENABLE LIVE CANARY";
export const RETURN_TO_SIMULATE_CONFIRMATION_TEXT = "RETURN TO SIMULATE";

export const MAX_LIVE_CANARY_DURATION_MINUTES = 30;
export const DEFAULT_LIVE_CANARY_DURATION_MINUTES = 15;

export type DeliveryRuntimeModeAuditEventType =
  | "delivery_runtime_mode_enabled"
  | "delivery_runtime_mode_disabled"
  | "delivery_runtime_mode_expired"
  | "live_canary_attempted"
  | "live_canary_succeeded"
  | "live_canary_partial_success"
  | "live_canary_failed";

export type ResolvedDeliveryRuntimeMode = {
  effectiveMode: GhlAdapterMode;
  configuredRuntimeMode: RuntimeAdapterMode;
  maxAllowedMode: GhlAdapterMaxMode;
  liveCanaryEnabledUntil: string | null;
  canRunLiveCanary: boolean;
  reason: string;
  enabledBy: string | null;
  enabledAt: string | null;
  lastChangedAt: string | null;
  expired: boolean;
};

type TestRuntimeOverride = Partial<
  Pick<
    DeliveryRuntimeModeSetting,
    "configuredRuntimeMode" | "liveCanaryEnabledUntil" | "enabledBy" | "enabledAt" | "reason"
  >
>;

let cached: { value: ResolvedDeliveryRuntimeMode; fetchedAt: number } | null = null;
let testOverride: TestRuntimeOverride | null = null;
const CACHE_MS = 5_000;

export function invalidateDeliveryRuntimeModeCache(): void {
  cached = null;
  clearEffectiveAdapterModeOverride();
}

/** Load DB runtime mode and sync sync getters used by adapter/live transport. */
export async function warmEffectiveDeliveryAdapterMode(): Promise<ResolvedDeliveryRuntimeMode> {
  const resolved = await resolveDeliveryRuntimeMode(true);
  setEffectiveAdapterModeFromResolved(resolved.effectiveMode);
  return resolved;
}

/** Test-only: override DB runtime mode without migrations. */
export function setDeliveryRuntimeModeForTests(override: TestRuntimeOverride | null): void {
  testOverride = override;
  invalidateDeliveryRuntimeModeCache();
}

function clampEffectiveToMax(
  configured: RuntimeAdapterMode,
  max: GhlAdapterMaxMode,
  expired: boolean
): GhlAdapterMode {
  if (max === "disabled" || max === "live_blocked") return max;
  if (expired || configured !== "live_canary") {
    if (max === "readonly_probe") return "readonly_probe";
    return "simulate";
  }
  if (!isMaxModeLiveCanaryCapable(max)) {
    if (max === "readonly_probe") return "readonly_probe";
    return "simulate";
  }
  return "live_canary";
}

function settingToResolved(
  setting: DeliveryRuntimeModeSetting | null,
  max: GhlAdapterMaxMode,
  now = new Date()
): ResolvedDeliveryRuntimeMode {
  const configured = (
    RUNTIME_ADAPTER_MODES.includes(setting?.configuredRuntimeMode as RuntimeAdapterMode)
      ? setting!.configuredRuntimeMode
      : "simulate"
  ) as RuntimeAdapterMode;

  const expired =
    configured === "live_canary" &&
    setting?.liveCanaryEnabledUntil != null &&
    setting.liveCanaryEnabledUntil.getTime() <= now.getTime();

  const effectiveMode = clampEffectiveToMax(configured, max, expired);

  let reason = "Runtime mode simulate (default).";
  if (max === "disabled") {
    reason = "Environment maximum is disabled — adapter blocked.";
  } else if (max === "live_blocked") {
    reason = "Environment maximum is live_blocked.";
  } else if (expired) {
    reason = "Live canary window expired — effective mode reverted to simulate.";
  } else if (effectiveMode === "live_canary") {
    reason = setting?.reason?.trim() || "Live canary enabled via admin runtime toggle.";
  } else if (!isMaxModeLiveCanaryCapable(max) && configured === "live_canary") {
    reason = "Environment maximum does not allow live_canary — effective mode is simulate.";
  }

  const canRunLiveCanary =
    effectiveMode === "live_canary" && isMaxModeLiveCanaryCapable(max) && !expired;

  return {
    effectiveMode,
    configuredRuntimeMode: expired ? "simulate" : configured,
    maxAllowedMode: max,
    liveCanaryEnabledUntil: setting?.liveCanaryEnabledUntil?.toISOString() ?? null,
    canRunLiveCanary,
    reason,
    enabledBy: setting?.enabledBy ?? null,
    enabledAt: setting?.enabledAt?.toISOString() ?? null,
    lastChangedAt: setting?.lastChangedAt?.toISOString() ?? null,
    expired,
  };
}

async function loadSetting(): Promise<DeliveryRuntimeModeSetting | null> {
  if (testOverride) {
    return {
      id: "default",
      configuredRuntimeMode: testOverride.configuredRuntimeMode ?? "simulate",
      liveCanaryEnabledUntil: testOverride.liveCanaryEnabledUntil ?? null,
      enabledBy: testOverride.enabledBy ?? null,
      enabledAt: testOverride.enabledAt ?? null,
      reason: testOverride.reason ?? null,
      lastChangedAt: new Date(),
      createdAt: new Date(),
    };
  }
  return findDeliveryRuntimeModeSetting();
}

export async function resolveDeliveryRuntimeMode(
  force = false
): Promise<ResolvedDeliveryRuntimeMode> {
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.value;
  }

  const max = getGhlDeliveryAdapterMaxMode();
  const setting = await loadSetting();
  const resolved = settingToResolved(setting, max);

  if (resolved.expired && setting?.configuredRuntimeMode === "live_canary" && !testOverride) {
    await upsertDeliveryRuntimeModeSetting({
      configuredRuntimeMode: "simulate",
      liveCanaryEnabledUntil: null,
      reason: "Live canary window expired (auto-reverted).",
    });
    await createDeliveryRuntimeModeAuditEvent({
      eventType: "delivery_runtime_mode_expired",
      previousMode: "live_canary",
      newMode: "simulate",
      effectiveMode: "simulate",
      maxAllowedMode: max,
      reason: "Live canary window expired (auto-reverted).",
      enabledBy: setting?.enabledBy ?? null,
      liveCanaryEnabledUntil: setting?.liveCanaryEnabledUntil ?? null,
    });
    invalidateDeliveryRuntimeModeCache();
    const refreshed = settingToResolved(
      {
        ...setting!,
        configuredRuntimeMode: "simulate",
        liveCanaryEnabledUntil: null,
      },
      max
    );
    cached = { value: refreshed, fetchedAt: Date.now() };
    return refreshed;
  }

  cached = { value: resolved, fetchedAt: Date.now() };
  return resolved;
}

export async function getDeliveryRuntimeModeStatus(): Promise<ResolvedDeliveryRuntimeMode> {
  return resolveDeliveryRuntimeMode(true);
}

export type SetDeliveryRuntimeModeInput = {
  mode: RuntimeAdapterMode;
  durationMinutes?: number;
  operatorConfirmationText: string;
  reason?: string;
  enabledBy?: string | null;
};

export type SetDeliveryRuntimeModeResult =
  | { ok: true; status: ResolvedDeliveryRuntimeMode }
  | { ok: false; error: string; code: "CONFIRMATION" | "MAX_MODE" | "VALIDATION" };

export async function setDeliveryRuntimeMode(
  input: SetDeliveryRuntimeModeInput
): Promise<SetDeliveryRuntimeModeResult> {
  const max = getGhlDeliveryAdapterMaxMode();
  const previous = await resolveDeliveryRuntimeMode(true);

  if (input.mode === "live_canary") {
    if (input.operatorConfirmationText.trim() !== ENABLE_LIVE_CANARY_CONFIRMATION_TEXT) {
      return {
        ok: false,
        error: `operatorConfirmationText must be exactly "${ENABLE_LIVE_CANARY_CONFIRMATION_TEXT}".`,
        code: "CONFIRMATION",
      };
    }
    if (!isMaxModeLiveCanaryCapable(max)) {
      return {
        ok: false,
        error: "Environment maximum mode does not allow live_canary.",
        code: "MAX_MODE",
      };
    }
    const duration = input.durationMinutes ?? DEFAULT_LIVE_CANARY_DURATION_MINUTES;
    if (duration < 1 || duration > MAX_LIVE_CANARY_DURATION_MINUTES) {
      return {
        ok: false,
        error: `durationMinutes must be between 1 and ${MAX_LIVE_CANARY_DURATION_MINUTES}.`,
        code: "VALIDATION",
      };
    }
    const reason = input.reason?.trim();
    if (!reason) {
      return {
        ok: false,
        error: "reason is required when enabling live_canary.",
        code: "VALIDATION",
      };
    }
    const enabledAt = new Date();
    const until = new Date(enabledAt.getTime() + duration * 60_000);
    await upsertDeliveryRuntimeModeSetting({
      configuredRuntimeMode: "live_canary",
      liveCanaryEnabledUntil: until,
      enabledBy: input.enabledBy?.trim() || "admin_api",
      enabledAt,
      reason,
    });
    await createDeliveryRuntimeModeAuditEvent({
      eventType: "delivery_runtime_mode_enabled",
      previousMode: previous.configuredRuntimeMode,
      newMode: "live_canary",
      effectiveMode: "live_canary",
      maxAllowedMode: max,
      reason,
      enabledBy: input.enabledBy?.trim() || "admin_api",
      liveCanaryEnabledUntil: until,
    });
  } else {
    if (input.operatorConfirmationText.trim() !== RETURN_TO_SIMULATE_CONFIRMATION_TEXT) {
      return {
        ok: false,
        error: `operatorConfirmationText must be exactly "${RETURN_TO_SIMULATE_CONFIRMATION_TEXT}".`,
        code: "CONFIRMATION",
      };
    }
    await upsertDeliveryRuntimeModeSetting({
      configuredRuntimeMode: "simulate",
      liveCanaryEnabledUntil: null,
      enabledBy: input.enabledBy?.trim() || "admin_api",
      enabledAt: new Date(),
      reason: input.reason?.trim() || "Returned to simulate via admin.",
    });
    await createDeliveryRuntimeModeAuditEvent({
      eventType: "delivery_runtime_mode_disabled",
      previousMode: previous.configuredRuntimeMode,
      newMode: "simulate",
      effectiveMode: "simulate",
      maxAllowedMode: max,
      reason: input.reason?.trim() || "Returned to simulate via admin.",
      enabledBy: input.enabledBy?.trim() || "admin_api",
    });
  }

  invalidateDeliveryRuntimeModeCache();
  const status = await resolveDeliveryRuntimeMode(true);
  return { ok: true, status };
}

export async function recordLiveCanaryOutcomeAudit(input: {
  eventType: Extract<
    DeliveryRuntimeModeAuditEventType,
    | "live_canary_attempted"
    | "live_canary_succeeded"
    | "live_canary_partial_success"
    | "live_canary_failed"
  >;
  enabledBy?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const status = await resolveDeliveryRuntimeMode();
  await createDeliveryRuntimeModeAuditEvent({
    eventType: input.eventType,
    effectiveMode: status.effectiveMode,
    maxAllowedMode: status.maxAllowedMode,
    reason: input.reason ?? null,
    enabledBy: input.enabledBy ?? null,
    metadataJson: input.metadata
      ? (input.metadata as Prisma.InputJsonValue)
      : undefined,
  });
}

export function isEffectiveSimulationAllowed(mode: GhlAdapterMode): boolean {
  return mode === "simulate" || mode === "readonly_probe" || mode === "live_canary";
}
