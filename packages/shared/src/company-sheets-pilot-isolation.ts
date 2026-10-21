/** Server-controlled classification for the internal company Sheets campaign pilot. */

export const COMPANY_SHEETS_PILOT_ROUTE_KEY = "company_sheets_internal_pilot";
export const COMPANY_SHEETS_PILOT_RECORD_CLASS = "company_sheets_internal_pilot";
export const COMPANY_SHEETS_PILOT_MATCH_TYPE = "internal_sheets_pilot";
export const COMPANY_SHEETS_OPERATOR_ROUTING_AUTHORITY = "operator_selected_destination";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * True when either durable marker is present. Clearing one column does not
 * make the lead eligible for inventory, fulfillment, allocation, or CRM delivery.
 */
export function isCompanySheetsInternalPilotLead(
  lead:
    | {
        sourceRouteKey?: string | null;
        enrichmentMetadataJson?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!lead) return false;
  if (lead.sourceRouteKey === COMPANY_SHEETS_PILOT_ROUTE_KEY) return true;
  const enrichment = asRecord(lead.enrichmentMetadataJson);
  if (!enrichment) return false;
  return (
    enrichment.recordClass === COMPANY_SHEETS_PILOT_RECORD_CLASS ||
    enrichment.intake === COMPANY_SHEETS_PILOT_ROUTE_KEY
  );
}

/** True for a dry-run decision written by the synthetic pilot, including the operator fallback. */
export function isCompanySheetsInternalPilotDecision(
  decision: { attributionSnapshot?: unknown } | null | undefined
): boolean {
  const snapshot = asRecord(decision?.attributionSnapshot);
  if (!snapshot) return false;
  if (snapshot.syntheticPilot === true) return true;
  if (snapshot.sourceRouteKey === COMPANY_SHEETS_PILOT_ROUTE_KEY) return true;
  return (
    snapshot.routingAuthority === COMPANY_SHEETS_OPERATOR_ROUTING_AUTHORITY &&
    snapshot.matchType === COMPANY_SHEETS_PILOT_MATCH_TYPE
  );
}

/** True when a lifecycle payload carries the pilot platform or intake provider. */
export function isCompanySheetsInternalPilotLifecycle(payload: unknown): boolean {
  const record = asRecord(payload);
  if (!record) return false;
  const attribution = asRecord(record.attribution);
  if (attribution?.source_platform === COMPANY_SHEETS_PILOT_ROUTE_KEY) return true;
  const routing = asRecord(record.routing);
  const intake = asRecord(routing?.source_intake);
  return intake?.provider === COMPANY_SHEETS_PILOT_ROUTE_KEY;
}
