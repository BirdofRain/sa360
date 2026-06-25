import { findClientAccountById } from "../../repositories/client-account.repository.js";
import {
  findGhlLocationConnectionByLocationId,
  listGhlLocationConnections,
} from "../../repositories/ghl-location-connection.repository.js";
import { findLatestGhlLocationConfigSnapshot } from "../../repositories/ghl-location-config-snapshot.repository.js";
import type { GhlDiscoveredCustomField } from "../ghl-config-discovery/ghl-config-discovery.types.js";
import {
  CLIENT_CHANNEL_EXPECTED_CUSTOM_FIELDS,
  CLIENT_CHANNEL_EXPECTED_CUSTOM_VALUES,
  type ClientChannelReadinessStatus,
} from "./client-channel-profile.constants.js";

export type ChannelProfileReadinessReport = {
  status: ClientChannelReadinessStatus;
  locationId: string | null;
  snapshotFetchedAt: string | null;
  installedFields: string[];
  missingFields: string[];
  installedCustomValues: string[];
  missingCustomValues: string[];
  /** True when GHL custom values cannot be discovered by the app yet (read-only limitation). */
  customValuesDiscoverable: boolean;
  warnings: string[];
  notes: string[];
};

function discoveredFieldHaystack(field: GhlDiscoveredCustomField): string {
  return [field.fieldKey, field.key, field.name]
    .filter((v): v is string => Boolean(v))
    .join(" ")
    .toLowerCase();
}

function detectInstalledFields(
  expected: readonly string[],
  discovered: GhlDiscoveredCustomField[]
): { installed: string[]; missing: string[] } {
  const installed: string[] = [];
  const missing: string[] = [];
  const haystacks = discovered.map(discoveredFieldHaystack);
  for (const key of expected) {
    const lower = key.toLowerCase();
    const found = haystacks.some((h) => h.includes(lower));
    if (found) installed.push(key);
    else missing.push(key);
  }
  return { installed, missing };
}

async function resolveLocationIdForClient(
  clientAccountId: string,
  subaccountIdGhl?: string | null
): Promise<string | null> {
  const sub = subaccountIdGhl?.trim();
  if (sub) return sub;
  const client = await findClientAccountById(clientAccountId.trim());
  const destSub = client?.ghlDestination?.destinationSubaccountIdGhl?.trim();
  if (destSub) return destSub;
  const connections = await listGhlLocationConnections({
    clientAccountId: clientAccountId.trim(),
    limit: 5,
  });
  return connections.find((c) => c.locationId)?.locationId ?? null;
}

/**
 * Read-only GHL readiness check for the channel profile. Never performs writes or live API calls;
 * it inspects the most recent cached config snapshot. Returns UNKNOWN (not an error) when no
 * discovery data is available so the page never crashes.
 */
export async function validateClientChannelProfileReadiness(input: {
  clientAccountId: string;
  subaccountIdGhl?: string | null;
}): Promise<ChannelProfileReadinessReport> {
  const warnings: string[] = [];
  const notes: string[] = [];

  const locationId = await resolveLocationIdForClient(
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
      missingCustomValues: [...CLIENT_CHANNEL_EXPECTED_CUSTOM_VALUES],
      customValuesDiscoverable: false,
      warnings: ["No GHL location is linked to this client; readiness is unknown."],
      notes: [
        "Link a GHL location and run config discovery to evaluate channel profile readiness.",
      ],
    };
  }

  const connection = await findGhlLocationConnectionByLocationId(locationId);
  if (!connection || connection.connectionStatus === "revoked") {
    warnings.push("GHL location is not connected (or OAuth revoked); using cached data only.");
  }

  const snapshot = await findLatestGhlLocationConfigSnapshot(locationId);
  if (!snapshot) {
    return {
      status: "UNKNOWN",
      locationId,
      snapshotFetchedAt: null,
      installedFields: [],
      missingFields: [...CLIENT_CHANNEL_EXPECTED_CUSTOM_FIELDS],
      installedCustomValues: [],
      missingCustomValues: [...CLIENT_CHANNEL_EXPECTED_CUSTOM_VALUES],
      customValuesDiscoverable: false,
      warnings: [...warnings, "No GHL config discovery snapshot found for this location."],
      notes: ["Run GHL config discovery on the delivery-config page to populate readiness."],
    };
  }

  const discoveredFields =
    (snapshot.customFieldsJson as GhlDiscoveredCustomField[] | null) ?? [];
  const { installed, missing } = detectInstalledFields(
    CLIENT_CHANNEL_EXPECTED_CUSTOM_FIELDS,
    discoveredFields
  );

  // Custom values (message templates) are not part of the read-only discovery snapshot yet.
  notes.push(
    "GHL custom values are not discoverable in this version; treat missing custom values as unverified."
  );

  let status: ClientChannelReadinessStatus;
  if (installed.length === 0) status = "MISSING_CONFIG";
  else if (missing.length === 0) status = "READY";
  else status = "PARTIAL";

  return {
    status,
    locationId,
    snapshotFetchedAt: snapshot.fetchedAt?.toISOString() ?? null,
    installedFields: installed,
    missingFields: missing,
    installedCustomValues: [],
    missingCustomValues: [...CLIENT_CHANNEL_EXPECTED_CUSTOM_VALUES],
    customValuesDiscoverable: false,
    warnings,
    notes,
  };
}
