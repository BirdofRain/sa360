import { COMPANY_SHEETS_GENERATION_TIMEZONE, COMPANY_SHEETS_V3_COLUMNS } from "@sa360/shared";

import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2,
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
  COMPANY_SHEETS_LEAD_HEADER_V2,
  companySheetsCampaignHeader,
} from "../../lib/company-google-sheets-env.js";

/**
 * Campaign sheet cells from the canonical normalized payload.
 *
 * Precedence is first non-blank only. A missing value stays blank. This mapper
 * does not read raw payload JSON, date of birth, disability rating, IP address,
 * user agent, or fbclid, and it does not derive age from a birthday.
 *
 * `completion_minutes` and `trustedform_status` are read only from
 * `routing.source_intake.unmappedSourceFieldsJson`. The entry `key` must be
 * exactly `time_to_completion_minutes` or `trustedformCaptureStatus`.
 * `xxTrustedFormCertUrl` in that array is not copied. A top-level copy or a
 * `compliance` copy of those keys is not read.
 */
export type CampaignSheetLeadInput = {
  stableRowId: string;
  clientAccountId: string;
  sourceLeadEventId: string;
  receivedAt: string;
  sourceLeadId: string | null;
  normalizedPayload: unknown;
};

export function campaignLeadIdentityFromPayload(normalizedPayload: unknown): {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
} {
  const normalized = asRecord(normalizedPayload) ?? {};
  const contact = asRecord(normalized.contact);
  const firstName = readString(normalized.first_name ?? normalized.firstName ?? contact?.first_name);
  const lastName = readString(normalized.last_name ?? normalized.lastName ?? contact?.last_name);
  const fullName =
    [firstName, lastName].filter(Boolean).join(" ") ||
    readString(normalized.full_name ?? normalized.fullName ?? normalized.name ?? contact?.full_name);
  return {
    firstName,
    lastName,
    fullName,
    email: readString(normalized.email ?? contact?.email),
    phone: readString(
      normalized.phone ??
        normalized.phone_number ??
        normalized.phoneNumber ??
        contact?.phone_e164 ??
        contact?.phone ??
        contact?.phone_number
    ),
  };
}

export function companySheetsCampaignRowValues(input: CampaignSheetLeadInput & { schemaVersion: string }): string[] | null {
  const header = companySheetsCampaignHeader(input.schemaVersion);
  if (!header) return null;
  const extended = v2RowValues(input);
  if (!extended) return null;
  if (header.length === 7) return extended.slice(0, 7);
  if (input.schemaVersion === COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3) {
    const byKey = Object.fromEntries(COMPANY_SHEETS_LEAD_HEADER_V2.map((key, index) => [key, extended[index] ?? ""]));
    const values = COMPANY_SHEETS_V3_COLUMNS.map((column) => byKey[column.sourceField] ?? "");
    const dateIndex = COMPANY_SHEETS_V3_COLUMNS.findIndex((column) => column.sourceField === "submitted_at");
    if (dateIndex >= 0) values[dateIndex] = formatGenerationTimestamp(values[dateIndex] ?? "");
    return values.length === header.length ? values : null;
  }
  return extended.length === header.length ? extended : null;
}

function v2RowValues(input: CampaignSheetLeadInput): string[] | null {
  const header = companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2);
  if (!header) return null;
  const identity = campaignLeadIdentityFromPayload(input.normalizedPayload);
  const base = [
    input.stableRowId,
    input.clientAccountId,
    input.sourceLeadEventId,
    input.receivedAt,
    identity.fullName,
    identity.email,
    identity.phone,
  ];
  const payload = asRecord(input.normalizedPayload) ?? {};
  const contact = asRecord(payload.contact);
  const details = asRecord(payload.lead_details);
  const niche = asRecord(details?.niche);
  const extended = [
    ...base,
    identity.firstName,
    identity.lastName,
    readString(contact?.state ?? payload.state),
    providerLeadId(payload, input.sourceLeadId),
    firstText(details?.consumer_age, attribute(payload, "age")),
    attribute(payload, "best_time_to_call"),
    firstText(niche?.branch_of_service, attribute(payload, "branch_of_service")),
    attribute(payload, "military_status"),
    firstText(details?.coverage_amount, attribute(payload, "desired_coverage"), attribute(payload, "coverage_amount")),
    attribute(payload, "primary_reason"),
    attribute(payload, "marital_status"),
    attribute(payload, "sex"),
    firstText(details?.beneficiary, attribute(payload, "beneficiary")),
    readString(sourceIntake(payload)?.submitted_at),
    unmappedValue(payload, "time_to_completion_minutes"),
    attribute(payload, "phone_verified"),
    attribute(payload, "email_verified"),
    unmappedValue(payload, "trustedformCaptureStatus"),
  ];
  return extended.length === header.length ? extended : null;
}

/** Generation time in America/New_York. A missing or unparseable source value is not replaced. */
export function formatGenerationTimestamp(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return raw;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: COMPANY_SHEETS_GENERATION_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(parsed);
  return `${formatted} ${COMPANY_SHEETS_GENERATION_TIMEZONE}`;
}

function providerLeadId(payload: Record<string, unknown>, sourceLeadId: string | null): string {
  const intake = sourceIntake(payload);
  if (intake?.source_lead_id_generated === true) return "";
  const leadId = readString(intake?.lead_id);
  if (leadId) return leadId;
  return readString(sourceLeadId);
}

function attribute(payload: Record<string, unknown>, key: string): string {
  const intake = sourceIntake(payload);
  const fromIntake = asRecord(intake?.sourceAttributes)?.[key];
  const fromRoot = asRecord(payload.sourceAttributes)?.[key];
  return readString(fromIntake ?? fromRoot);
}

function unmappedValue(payload: Record<string, unknown>, key: string): string {
  const list = sourceIntake(payload)?.unmappedSourceFieldsJson;
  if (!Array.isArray(list)) return "";
  for (const item of list) {
    const record = asRecord(item);
    if (record?.key !== key) continue;
    const value = readString(record.value);
    if (value) return value;
  }
  return "";
}

function sourceIntake(payload: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(asRecord(payload.routing)?.source_intake);
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = readString(value);
    if (text) return text;
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
