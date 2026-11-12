import { findGhlLocationConnectionByLocationId } from "../../repositories/ghl-location-connection.repository.js";
import type { GhlDiscoveredCustomField } from "../ghl-config-discovery/ghl-config-discovery.types.js";
import { readInformationalGhlLocationSnapshot } from "../ghl-config-discovery/ghl-operational-snapshot.js";
import { listGhlCustomValues } from "../ghl-custom-value/ghl-custom-value-adapter.js";
import {
  CLIENT_CHANNEL_EXPECTED_CUSTOM_FIELDS,
  type ClientChannelReadinessStatus,
} from "./client-channel-profile.constants.js";
import { resolveClientChannelLocationId } from "./client-channel-profile-location.js";
import { PROFILE_GHL_MIRROR_KEYS } from "./client-profile-ghl-mirror.mapping.js";

export type ChannelProfileReadinessReport = {
  status: ClientChannelReadinessStatus;
  locationId: string | null;
  snapshotFetchedAt: string | null;
  installedFields: string[];
  missingFields: string[];
  /** Mirror custom values (SA360_CLIENT_*) confirmed to exist in GHL. */
  installedCustomValues: string[];
  /** Mirror custom values confirmed absent in GHL (only when discovery succeeded). */
  missingCustomValues: string[];
  /** Mirror custom values whose existence could not be verified (no auth/discovery). */
  unverifiedCustomValues: string[];
  /** True when the app could read real GHL custom values for this location. */
  customValuesVerified: boolean;
  /** False when field evidence is historical, failed, or missing. READY requires true. */
  snapshotCurrent: boolean;
  /** Whether the profile can be mirrored to GHL at all (location resolvable). Live still gated. */
  canApplyProfileToGhl: boolean;
  warnings: string[];
  notes: string[];
};

function discoveredFieldHaystack(field: GhlDiscoveredCustomField): string {
  return [field.fieldKey, field.key, field.name]
    .filter((v): v is string => Boolean(v))
    .join(" ")
    .toLowerCase();
}

function detectInstalled(
  expected: readonly string[],
  haystacks: string[]
): { installed: string[]; missing: string[] } {
  const installed: string[] = [];
  const missing: string[] = [];
  for (const key of expected) {
    const lower = key.toLowerCase();
    if (haystacks.some((h) => h.includes(lower))) installed.push(key);
    else missing.push(key);
  }
  return { installed, missing };
}

/**
 * Read-only GHL readiness check for the channel profile + its custom-value mirror.
 *
 * - Custom FIELDS are detected from the cached config-discovery snapshot (offline-safe).
 * - Custom VALUES (the mirror keys) are detected via a best-effort live list; when that is not
 *   possible (no OAuth / network), they are returned as `unverifiedCustomValues` rather than failing.
 * Never throws; returns UNKNOWN when nothing can be evaluated.
 */
export async function validateClientChannelProfileReadiness(input: {
  clientAccountId: string;
  subaccountIdGhl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ChannelProfileReadinessReport> {
  const warnings: string[] = [];
  const notes: string[] = [];

  const locationId = await resolveClientChannelLocationId(
    input.clientAccountId,
    input.subaccountIdGhl
  );

  if (!locationId) {
    return {
      status: "UNKNOWN",
      locationId: null,
      snapshotFetchedAt: null,
      installedFields: [],
      missingFields: [...CLIENT_CHANNEL_EXPECTED_CUSTOM_FIELDS],
      installedCustomValues: [],
      missingCustomValues: [],
      unverifiedCustomValues: [...PROFILE_GHL_MIRROR_KEYS],
      customValuesVerified: false,
      snapshotCurrent: false,
      canApplyProfileToGhl: false,
      warnings: ["No GHL location is linked to this client; readiness is unknown."],
      notes: ["Link a GHL location and run config discovery to evaluate readiness."],
    };
  }

  const connection = await findGhlLocationConnectionByLocationId(locationId).catch(() => null);
  if (!connection || connection.connectionStatus === "revoked") {
    warnings.push("GHL location is not connected (or OAuth revoked); using cached data only.");
  }

  // Field evidence comes from a complete snapshot for this location.
  // A failed row is not a list of missing fields. An older complete snapshot
  // can be shown as historical, and it is not a READY claim.
  const snapshotView = await readInformationalGhlLocationSnapshot(locationId).catch(() => null);
  const currentSnapshot = snapshotView?.current === true ? snapshotView.snapshot : null;
  const historicalSnapshot =
    snapshotView?.evidence === "historical" ? snapshotView.snapshot : null;
  const fieldSource = currentSnapshot ?? historicalSnapshot;
  const discoveredFields = (fieldSource?.customFieldsJson as GhlDiscoveredCustomField[] | null) ?? [];
  const fieldHaystacks = discoveredFields.map(discoveredFieldHaystack);
  const fields = fieldSource
    ? detectInstalled(CLIENT_CHANNEL_EXPECTED_CUSTOM_FIELDS, fieldHaystacks)
    : { installed: [] as string[], missing: [] as string[] };
  if (snapshotView?.note) notes.push(snapshotView.note);
  if (snapshotView?.evidence === "historical") {
    notes.push("Listed custom fields are from an earlier discovery and are not verified.");
  }

  // --- Custom values (best-effort live list) ---
  let installedCustomValues: string[] = [];
  let missingCustomValues: string[] = [];
  let unverifiedCustomValues: string[] = [];
  let customValuesVerified = false;

  const listed = await listGhlCustomValues(locationId, input.fetchImpl ?? fetch).catch(() => ({
    ok: false as const,
    error: "discovery_failed",
    status: 0,
  }));

  if (listed.ok) {
    customValuesVerified = true;
    const cvHaystacks = listed.items.map((cv) =>
      [cv.name, cv.id].filter(Boolean).join(" ").toLowerCase()
    );
    const detected = detectInstalled(PROFILE_GHL_MIRROR_KEYS, cvHaystacks);
    installedCustomValues = detected.installed;
    missingCustomValues = detected.missing;
    notes.push("Custom value existence verified; current values not compared here.");
  } else {
    unverifiedCustomValues = [...PROFILE_GHL_MIRROR_KEYS];
    notes.push(
      "Custom value existence unverified (no live GHL read available); will be resolved at apply/preview time."
    );
  }

  // --- Overall status ---
  // READY is only a current complete discovery plus verified custom values.
  let status: ClientChannelReadinessStatus;
  if (!snapshotView || snapshotView.evidence === "unavailable") {
    status = snapshotView?.reconnect ? "BLOCKED" : "UNKNOWN";
  } else if (!snapshotView.current) {
    status = snapshotView.reconnect ? "BLOCKED" : "STALE";
  } else if (!customValuesVerified && fieldHaystacks.length === 0) {
    status = "UNKNOWN";
  } else if (customValuesVerified) {
    if (installedCustomValues.length === 0) status = "MISSING_CONFIG";
    else if (missingCustomValues.length === 0 && fields.missing.length === 0) status = "READY";
    else status = "PARTIAL";
  } else if (fields.installed.length === 0) {
    status = "MISSING_CONFIG";
  } else {
    status = "PARTIAL";
  }

  return {
    status,
    locationId,
    snapshotFetchedAt: fieldSource?.fetchedAt?.toISOString() ?? null,
    snapshotCurrent: snapshotView?.current === true,
    installedFields: fields.installed,
    missingFields: fields.missing,
    installedCustomValues,
    missingCustomValues,
    unverifiedCustomValues,
    customValuesVerified,
    canApplyProfileToGhl: Boolean(locationId),
    warnings,
    notes,
  };
}
