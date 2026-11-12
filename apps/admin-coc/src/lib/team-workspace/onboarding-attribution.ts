const RECORD_TYPES = [
  "setup_audit",
  "source_campaign_request",
  "ghl_destination_configuration_request",
  "company_sheets_destination_configuration_request",
] as const;

export type OnboardingAttributionView = {
  recordType: (typeof RECORD_TYPES)[number];
  recordId: string;
  requestId: string;
  actor: string | null;
};

/**
 * Accept only the stored attribution fields. A save banner or a payload
 * without these fields is not attribution.
 */
export function parseOnboardingAttribution(
  value: unknown,
  expectedRequestId: string
): OnboardingAttributionView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.ok !== true) return null;
  if (typeof record.recordType !== "string" || !RECORD_TYPES.includes(record.recordType as (typeof RECORD_TYPES)[number])) {
    return null;
  }
  if (!isId(record.recordId) || record.requestId !== expectedRequestId) return null;
  if (record.actor !== null && typeof record.actor !== "string") return null;
  if (typeof record.actor === "string" && (record.actor.trim() !== record.actor || record.actor.length === 0)) {
    return null;
  }
  return {
    recordType: record.recordType as OnboardingAttributionView["recordType"],
    recordId: record.recordId,
    requestId: expectedRequestId,
    actor: record.actor,
  };
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 && !/\s/.test(value);
}
