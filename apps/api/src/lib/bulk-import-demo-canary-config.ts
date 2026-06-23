import {
  BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID,
  BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID,
} from "@sa360/shared";
import {
  getDirectDeliveryAllowedClientIds,
  getDirectDeliveryAllowedLocationIds,
} from "./direct-demo-delivery-config.js";

/**
 * Resolves the demo client id used for initial bulk-import live canary guards.
 * Prefers explicit env, then a single-entry allowlist (staging rekeys), then constant.
 */
export function resolveBulkImportInitialCanaryDemoClientId(): string {
  const explicit = process.env.SA360_BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID?.trim();
  if (explicit) return explicit;

  const allowed = getDirectDeliveryAllowedClientIds();
  if (allowed.size === 1) {
    return [...allowed][0]!;
  }

  return BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID;
}

export function resolveBulkImportInitialCanaryDemoLocationId(): string {
  const explicit = process.env.SA360_BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID?.trim();
  if (explicit) return explicit;

  const allowed = getDirectDeliveryAllowedLocationIds();
  if (allowed.size === 1) {
    return [...allowed][0]!;
  }

  return BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID;
}

export function isBulkImportInitialCanaryDestination(
  clientAccountId: string | null | undefined,
  locationIdGhl: string | null | undefined
): boolean {
  return (
    clientAccountId?.trim() === resolveBulkImportInitialCanaryDemoClientId() &&
    locationIdGhl?.trim() === resolveBulkImportInitialCanaryDemoLocationId()
  );
}
