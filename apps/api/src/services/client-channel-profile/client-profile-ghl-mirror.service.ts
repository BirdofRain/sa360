import type { Prisma } from "@prisma/client";
import {
  clampWriteModeToMax,
  evaluateMirrorLiveGuardrails,
  getAdminConfigMaxWriteMode,
  type ClientChannelWriteMode,
  type MirrorLiveGuardrailResult,
} from "../../lib/client-channel-profile-env.js";
import { createClientProfileGhlMirrorLog } from "../../repositories/client-profile-ghl-mirror-log.repository.js";
import { touchClientChannelProfileLastApplied } from "../../repositories/client-channel-profile.repository.js";
import {
  createGhlCustomValue,
  listGhlCustomValues,
  updateGhlCustomValue,
  type GhlCustomValue,
} from "../ghl-custom-value/ghl-custom-value-adapter.js";
import type { ClientChannelProfileFields } from "./client-channel-profile.constants.js";
import { resolveClientChannelLocationId } from "./client-channel-profile-location.js";
import {
  buildProfileMirrorValues,
  isRestrictedCustomValueKey,
} from "./client-profile-ghl-mirror.mapping.js";

export type MirrorAction = "CREATE" | "UPDATE" | "NOOP" | "SKIP" | "UNKNOWN";

export type MirrorPlanEntry = {
  key: string;
  intendedValue: string;
  currentValue: string | null;
  action: MirrorAction;
  customValueId: string | null;
  skipReason: string | null;
};

export type GhlMirrorPlan = {
  clientAccountId: string;
  subaccountIdGhl: string | null;
  targetLocation: string | null;
  writeMode: ClientChannelWriteMode;
  maxWriteMode: ClientChannelWriteMode;
  discoveryAvailable: boolean;
  entries: MirrorPlanEntry[];
  liveWritesPerformed: false;
  notes: string[];
};

export type MirrorApplyEntryResult = MirrorPlanEntry & {
  status: "written" | "would_write" | "skipped" | "failed" | "simulated";
  error?: string;
};

export type MirrorApplyResult = {
  clientAccountId: string;
  subaccountIdGhl: string | null;
  targetLocation: string | null;
  writeMode: ClientChannelWriteMode;
  maxWriteMode: ClientChannelWriteMode;
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
  results: MirrorApplyEntryResult[];
  errorSummary: string | null;
  notes: string[];
};

/**
 * Pure: compute the per-key mirror actions given the profile, effective mode, and (optionally)
 * discovered GHL custom values. `discovered === null` means existence is unknown → UNKNOWN actions.
 * Exported for unit testing without a DB/network.
 */
export function computeMirrorEntries(
  profile: ClientChannelProfileFields,
  effectiveMode: ClientChannelWriteMode,
  discovered: GhlCustomValue[] | null
): MirrorPlanEntry[] {
  const byName = new Map<string, GhlCustomValue>();
  if (discovered) {
    for (const cv of discovered) {
      if (cv.name) byName.set(cv.name.toUpperCase(), cv);
    }
  }
  const intended = buildProfileMirrorValues(profile, effectiveMode);
  return intended.map(({ key, value }) => {
    if (isRestrictedCustomValueKey(key)) {
      return {
        key,
        intendedValue: value,
        currentValue: null,
        action: "SKIP" as const,
        customValueId: null,
        skipReason: "Restricted key name (token/secret pattern); never written.",
      };
    }
    if (discovered === null) {
      return {
        key,
        intendedValue: value,
        currentValue: null,
        action: "UNKNOWN" as const,
        customValueId: null,
        skipReason: "Existing GHL custom value could not be read.",
      };
    }
    const existing = byName.get(key.toUpperCase());
    if (!existing) {
      return { key, intendedValue: value, currentValue: null, action: "CREATE" as const, customValueId: null, skipReason: null };
    }
    if (existing.value === value) {
      return {
        key,
        intendedValue: value,
        currentValue: existing.value,
        action: "NOOP" as const,
        customValueId: existing.id || null,
        skipReason: null,
      };
    }
    return {
      key,
      intendedValue: value,
      currentValue: existing.value,
      action: "UPDATE" as const,
      customValueId: existing.id || null,
      skipReason: null,
    };
  });
}

async function discover(
  locationId: string | null,
  fetchImpl: typeof fetch
): Promise<GhlCustomValue[] | null> {
  if (!locationId) return null;
  try {
    const listed = await listGhlCustomValues(locationId, fetchImpl);
    return listed.ok ? listed.items : null;
  } catch {
    return null;
  }
}

/** Build a GHL custom-value write plan. Always available; never writes. */
export async function buildGhlMirrorPlan(input: {
  clientAccountId: string;
  subaccountIdGhl?: string | null;
  profile: ClientChannelProfileFields;
  fetchImpl?: typeof fetch;
}): Promise<GhlMirrorPlan> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const targetLocation = await resolveClientChannelLocationId(
    input.clientAccountId,
    input.subaccountIdGhl
  );
  const { effective } = clampWriteModeToMax(input.profile.writeMode);
  const discovered = await discover(targetLocation, fetchImpl);
  const entries = computeMirrorEntries(input.profile, effective, discovered);

  const notes: string[] = ["SA360 Admin remains the source of truth; no existing leads are updated."];
  if (!targetLocation) notes.push("No target GHL location resolved; nothing can be mirrored.");
  if (targetLocation && discovered === null) {
    notes.push("Could not read existing GHL custom values; actions shown as UNKNOWN.");
  }

  return {
    clientAccountId: input.clientAccountId.trim(),
    subaccountIdGhl: input.subaccountIdGhl?.trim() || null,
    targetLocation,
    writeMode: effective,
    maxWriteMode: getAdminConfigMaxWriteMode(),
    discoveryAvailable: discovered !== null,
    entries,
    liveWritesPerformed: false,
    notes,
  };
}

/**
 * Apply the profile to GHL according to the effective write mode + guardrails.
 * - simulate: plan only, no writes
 * - shadow: validate target + log intended writes, no writes
 * - live: write only mapped, non-restricted CREATE/UPDATE values, and only when guardrails pass
 * Always writes an audit log. Never writes secrets.
 */
export async function applyGhlMirror(input: {
  clientAccountId: string;
  subaccountIdGhl?: string | null;
  profile: ClientChannelProfileFields;
  requestedBy?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<MirrorApplyResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const plan = await buildGhlMirrorPlan({
    clientAccountId: input.clientAccountId,
    subaccountIdGhl: input.subaccountIdGhl,
    profile: input.profile,
    fetchImpl,
  });
  const effective = plan.writeMode;
  const guardrails = evaluateMirrorLiveGuardrails({
    clientAccountId: input.clientAccountId,
    locationId: plan.targetLocation,
    effectiveMode: effective,
  });

  const notes = [...plan.notes];
  let results: MirrorApplyEntryResult[] = [];
  let resultStatus: MirrorApplyResult["resultStatus"] = "simulated";
  let liveWritesPerformed = false;
  let valuesWritten = 0;
  let errorSummary: string | null = null;

  const intendedWriteActions = (e: MirrorPlanEntry) => e.action === "CREATE" || e.action === "UPDATE";

  if (effective === "simulate") {
    resultStatus = "simulated";
    results = plan.entries.map((e) => ({ ...e, status: "simulated" }));
  } else if (effective === "shadow") {
    resultStatus = "shadow_logged";
    results = plan.entries.map((e) => ({
      ...e,
      status: intendedWriteActions(e) ? "would_write" : "skipped",
    }));
    notes.push("Shadow mode: validated target and logged intended writes; nothing was written.");
  } else {
    // live
    if (!guardrails.liveAllowed) {
      resultStatus = "blocked";
      results = plan.entries.map((e) => ({ ...e, status: "skipped" }));
      errorSummary = guardrails.blockers.join(" ");
      notes.push("Live write blocked by guardrails; see blockers.");
    } else if (!plan.targetLocation) {
      resultStatus = "blocked";
      results = plan.entries.map((e) => ({ ...e, status: "skipped" }));
      errorSummary = "No target GHL location.";
    } else {
      const failures: string[] = [];
      for (const e of plan.entries) {
        if (isRestrictedCustomValueKey(e.key)) {
          results.push({ ...e, action: "SKIP", status: "skipped", skipReason: "Restricted key." });
          continue;
        }
        if (e.action === "CREATE") {
          const res = await createGhlCustomValue(plan.targetLocation, { name: e.key, value: e.intendedValue }, fetchImpl);
          if (res.ok) {
            valuesWritten += 1;
            liveWritesPerformed = true;
            results.push({ ...e, status: "written", customValueId: res.item.id || e.customValueId });
          } else {
            failures.push(`${e.key}: ${res.error}`);
            results.push({ ...e, status: "failed", error: res.error });
          }
        } else if (e.action === "UPDATE" && e.customValueId) {
          const res = await updateGhlCustomValue(plan.targetLocation, e.customValueId, { name: e.key, value: e.intendedValue }, fetchImpl);
          if (res.ok) {
            valuesWritten += 1;
            liveWritesPerformed = true;
            results.push({ ...e, status: "written" });
          } else {
            failures.push(`${e.key}: ${res.error}`);
            results.push({ ...e, status: "failed", error: res.error });
          }
        } else {
          // NOOP / UNKNOWN / UPDATE-without-id
          results.push({ ...e, status: "skipped" });
        }
      }
      if (failures.length > 0) {
        resultStatus = valuesWritten > 0 ? "live_partial" : "error";
        errorSummary = failures.join(" | ").slice(0, 500);
      } else {
        resultStatus = "live_applied";
      }
      if (liveWritesPerformed) {
        await touchClientChannelProfileLastApplied(
          input.clientAccountId,
          input.subaccountIdGhl,
          new Date()
        ).catch(() => {});
      }
    }
  }

  const valuesAttempted = plan.entries.filter(intendedWriteActions).length;
  const valuesSkipped = results.filter(
    (r) => r.status === "skipped" || r.status === "would_write" || r.status === "simulated"
  ).length;

  // Audit log (redacted plan; no tokens/secrets).
  await createClientProfileGhlMirrorLog({
    clientAccountId: plan.clientAccountId,
    subaccountIdGhl: plan.subaccountIdGhl,
    locationId: plan.targetLocation,
    requestedBy: input.requestedBy?.trim() || null,
    writeMode: effective,
    resultStatus,
    valuesAttempted,
    valuesWritten,
    valuesSkipped,
    errorSummary,
    planJson: {
      targetLocation: plan.targetLocation,
      entries: results.map((r) => ({
        key: r.key,
        intendedValue: r.intendedValue,
        action: r.action,
        status: r.status,
      })),
    } as Prisma.InputJsonValue,
  }).catch(() => {});

  return {
    clientAccountId: plan.clientAccountId,
    subaccountIdGhl: plan.subaccountIdGhl,
    targetLocation: plan.targetLocation,
    writeMode: effective,
    maxWriteMode: plan.maxWriteMode,
    resultStatus,
    liveWritesPerformed,
    guardrails,
    valuesAttempted,
    valuesWritten,
    valuesSkipped,
    results,
    errorSummary,
    notes,
  };
}
