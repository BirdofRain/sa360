import { COMPANY_SHEETS_GENERATION_TIMEZONE, COMPANY_SHEETS_V3_COLUMNS } from "@sa360/shared";

import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2,
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
  COMPANY_SHEETS_LEAD_HEADER_V2,
  companySheetsCampaignHeader,
  companySheetsHeaderMatchesCampaign,
} from "../../lib/company-google-sheets-env.js";
import { formatSheetsPhoneDisplay } from "../phone-e164.service.js";
import {
  deriveCampaignAge,
  formatCampaignDobSheet,
  parseCampaignDateOfBirth,
  projectCampaignDobAge,
  selectCampaignAgeReference,
  type CampaignDobAgePreview,
} from "../consumer-age/campaign-dob-age.js";
import { inspectCampaignLeadTypeSnapshot } from "../source-intake/campaign-lead-type.js";
import { normalizeSourceFieldKey } from "../source-intake/source-field-alias.registry.js";

export const CAMPAIGN_LEAD_TYPE_CONFLICT_DIAGNOSTIC = "campaign_lead_type_conflict";
export const CAMPAIGN_LEAD_TYPE_UNRESOLVED_DIAGNOSTIC = "campaign_lead_type_unresolved";
export const CAMPAIGN_LEAD_TYPE_MALFORMED_DIAGNOSTIC = "campaign_lead_type_malformed";

/**
 * Campaign sheet cells from the canonical normalized payload.
 *
 * Precedence is first non-blank only. A missing value stays blank. v1 and v2
 * rows do not gain columns. v3 reads the same v2 values plus stored lead type,
 * date of birth, notes, and niche answers. This mapper does not read raw
 * payload JSON, IP address, user agent, fbclid, or a TrustedForm certificate.
 *
 * Age is the stored consumer age when one is present. A blank age is the
 * completed whole-year age of a recognized date of birth. The reference is
 * the first valid documented timestamp among `submitted_at` and this lead's
 * persisted `receivedAt`. An invalid `submitted_at` does not block that
 * receipt time. Aged-inventory eligibility limits are not applied. An age
 * never creates a birthday. DOB is written as a date-only `YYYY-MM-DD`
 * value; a documented datetime keeps the calendar date before `T`.
 *
 * `completion_minutes` and `trustedform_status` are read only from
 * `routing.source_intake.unmappedSourceFieldsJson`. The entry `key` must be
 * exactly `time_to_completion_minutes` or `trustedformCaptureStatus`.
 * Notes are read only when that array's key normalizes to `notes`.
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
  /**
   * Sheets writer and preview only. Other adapters omit this and keep the
   * legacy lead type and the stored phone text.
   */
  sheetsPresentation?: boolean;
  /** The source event's routingResultJson. Not the live SourceFunnel row. */
  routingResultJson?: unknown;
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
    const payload = asRecord(input.normalizedPayload) ?? {};
    const byKey: Record<string, string> = Object.fromEntries(
      COMPANY_SHEETS_LEAD_HEADER_V2.map((key, index) => [key, extended[index] ?? ""])
    );
    byKey.lead_type = projectSheetsLeadType(input).value;
    byKey.date_of_birth = sheetsCampaignDobAge(input).dateOfBirth;
    byKey.notes = unmappedNormalized(payload, "notes");
    for (const key of [
      "disability_rating",
      "healthcare_profession",
      "primary_concern",
      "primary_reason",
      "rig_type",
      "company_or_independent",
      "homeowner",
      "house_type",
      "branch_of_service",
    ]) {
      if (!byKey[key]) byKey[key] = nicheAnswer(payload, key);
    }
    const generatedAt = readString(sourceIntake(payload)?.generated_at);
    const generationSource = byKey.submitted_at || generatedAt;
    const values = COMPANY_SHEETS_V3_COLUMNS.map((column) => byKey[column.sourceField] ?? "");
    const dateIndex = COMPANY_SHEETS_V3_COLUMNS.findIndex((column) => column.sourceField === "submitted_at");
    if (dateIndex >= 0) values[dateIndex] = formatGenerationTimestamp(generationSource);
    return values.length === header.length ? values : null;
  }
  return extended.length === header.length ? extended : null;
}

/**
 * Aligns a campaign row to the live header. A v3 sheet that omitted Lead Type
 * keeps every other column and does not gain a Lead Type cell. A header that
 * is not the schema, with or without that one omission, is not written.
 */
export function companySheetsValuesForSheetHeader(
  input: CampaignSheetLeadInput & { schemaVersion: string },
  header: readonly string[]
): string[] | null {
  if (!companySheetsHeaderMatchesCampaign(input.schemaVersion, header)) return null;
  const full = companySheetsCampaignRowValues(input);
  const expected = companySheetsCampaignHeader(input.schemaVersion);
  if (!full || !expected || full.length !== expected.length) return null;
  if (header.length === expected.length && expected.every((cell, index) => header[index] === cell)) return [...full];
  const byHeader = new Map(expected.map((name, index) => [name, full[index] ?? ""]));
  return header.map((name) => byHeader.get(name) ?? "");
}

function v2RowValues(input: CampaignSheetLeadInput): string[] | null {
  const header = companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2);
  if (!header) return null;
  const identity = campaignLeadIdentityFromPayload(input.normalizedPayload);
  const phone = input.sheetsPresentation ? formatSheetsPhoneDisplay(identity.phone) : identity.phone;
  const base = [
    input.stableRowId,
    input.clientAccountId,
    input.sourceLeadEventId,
    input.receivedAt,
    identity.fullName,
    identity.email,
    phone,
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
    sheetsCampaignDobAge(input).age,
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

/** Confirmed parent URL for the Life Insurance for Vets web form copied onto Alex's sheet. */
const VET_WEB_FORM_PARENT_URL_KEY = "go.lifeinsuranceforvets.com/learn-alex-gross";
const VET_WEB_FORM_LEAD_TYPE = "Vet Web Form";

/**
 * Sheets Lead Type from the event snapshot when the writer or preview asks.
 * A missing snapshot keeps the legacy cell. A present conflict, unresolved,
 * or malformed snapshot is blank and named in `diagnostics`.
 */
export function projectSheetsLeadType(input: CampaignSheetLeadInput): { value: string; diagnostics: string[] } {
  const payload = asRecord(input.normalizedPayload) ?? {};
  if (!input.sheetsPresentation) return { value: readLegacyLeadType(payload), diagnostics: [] };
  const inspected = inspectCampaignLeadTypeSnapshot(input.routingResultJson);
  if (inspected.presence === "absent") return { value: readLegacyLeadType(payload), diagnostics: [] };
  if (inspected.presence === "malformed") {
    return { value: "", diagnostics: [CAMPAIGN_LEAD_TYPE_MALFORMED_DIAGNOSTIC] };
  }
  if (inspected.decision.status === "resolved" || inspected.decision.status === "agreement") {
    return { value: inspected.decision.leadTypeLabel ?? "", diagnostics: [] };
  }
  if (inspected.decision.status === "conflict") {
    return { value: "", diagnostics: [CAMPAIGN_LEAD_TYPE_CONFLICT_DIAGNOSTIC] };
  }
  return { value: "", diagnostics: [CAMPAIGN_LEAD_TYPE_UNRESOLVED_DIAGNOSTIC] };
}

/**
 * Legacy cell used only when the event has no campaignLeadType snapshot.
 * An explicit stored lead type wins. The Alex webform otherwise has no niche
 * stamp, so that parent URL fills Vet Web Form. A different route stays blank
 * or uses the stored product/niche fallback.
 */
function readLegacyLeadType(payload: Record<string, unknown>): string {
  const state = asRecord(payload.state);
  const explicit = readString(state?.lead_type);
  if (explicit) return explicit;
  const intake = sourceIntake(payload);
  if (readString(intake?.parent_url_key) === VET_WEB_FORM_PARENT_URL_KEY) return VET_WEB_FORM_LEAD_TYPE;
  const routing = asRecord(payload.routing);
  return firstText(routing?.product_type, routing?.niche_key);
}

/**
 * Sheets-only birthday. Canonical DOB aliases stay on `projectCampaignDobAge`.
 * The historical custom-question key `DATE` is read only for a sheets row.
 * A field whose key is `date` is a different answer and is not used.
 */
export function sheetsCampaignDobAge(input: CampaignSheetLeadInput): CampaignDobAgePreview {
  const projected = projectCampaignDobAge({
    normalizedPayload: input.normalizedPayload,
    receivedAt: input.receivedAt,
  });
  if (!input.sheetsPresentation || projected.dateOfBirth) return projected;
  const payload = asRecord(input.normalizedPayload);
  const iso = historicalCustomQuestionDob(payload);
  if (!iso) return projected;
  const intake = payload ? sourceIntake(payload) : null;
  const selected = selectCampaignAgeReference({
    submittedAt: readString(intake?.submitted_at) || null,
    receivedAt: input.receivedAt,
  });
  const referenceDate = projected.referenceDate || selected?.referenceDate || "";
  const derived = referenceDate ? deriveCampaignAge(iso, referenceDate) : null;
  const supplied = projected.ageProvenance === "supplied" ? projected.age : "";
  const conflict = Boolean(supplied && derived && supplied !== derived);
  const unavailable =
    !supplied && !derived
      ? !referenceDate
        ? "no_valid_reference"
        : iso > referenceDate
          ? "future_date_of_birth"
          : null
      : null;
  return {
    ...projected,
    age: supplied || derived || "",
    dateOfBirth: iso,
    dateOfBirthSheet: formatCampaignDobSheet(iso),
    ageProvenance: supplied ? "supplied" : derived ? "derived_from_date_of_birth" : "missing",
    dateOfBirthProvenance: "supplied",
    derivedAge: derived ?? "",
    referenceDate,
    conflict,
    ageUnavailableReason: unavailable,
  };
}

/** Exact historical custom-question key. Normalization would collapse this into `date`. */
const HISTORICAL_CUSTOM_QUESTION_DOB_KEY = "DATE";

function historicalCustomQuestionDob(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  const intake = sourceIntake(payload);
  const texts: string[] = [];
  if (Object.prototype.hasOwnProperty.call(payload, HISTORICAL_CUSTOM_QUESTION_DOB_KEY)) {
    pushText(texts, payload[HISTORICAL_CUSTOM_QUESTION_DOB_KEY]);
  }
  collectExactKey(texts, intake?.unmappedSourceFieldsJson);
  collectExactKey(texts, payload.unmappedSourceFields);
  collectExactKey(texts, payload.unmappedSourceFieldsJson);
  for (const bag of [payload.custom_fields, intake?.custom_fields, asRecord(payload.contact)?.custom_fields, intake?.sourceAttributes, payload.sourceAttributes]) {
    const record = asRecord(bag);
    if (!record || !Object.prototype.hasOwnProperty.call(record, HISTORICAL_CUSTOM_QUESTION_DOB_KEY)) continue;
    pushText(texts, record[HISTORICAL_CUSTOM_QUESTION_DOB_KEY]);
  }
  for (const list of [
    payload.custom_questions,
    payload.customQuestions,
    payload.questions,
    intake?.custom_questions,
    intake?.customQuestions,
    intake?.questions,
  ]) {
    collectQuestionList(texts, list);
  }
  for (const text of texts) {
    const iso = parseCampaignDateOfBirth(text);
    if (iso) return iso;
  }
  return "";
}

function collectExactKey(texts: string[], value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    const record = asRecord(item);
    if (record?.key !== HISTORICAL_CUSTOM_QUESTION_DOB_KEY) continue;
    pushText(texts, record.value);
  }
}

function collectQuestionList(texts: string[], value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const key = record.key ?? record.name ?? record.question ?? record.field ?? record.field_key;
    if (key !== HISTORICAL_CUSTOM_QUESTION_DOB_KEY) continue;
    pushText(texts, record.value ?? record.answer ?? record.response);
  }
}

function pushText(texts: string[], value: unknown): void {
  const text = readString(value);
  if (text) texts.push(text);
}

function nicheAnswer(payload: Record<string, unknown>, key: string): string {
  const niche = asRecord(asRecord(payload.lead_details)?.niche);
  return firstText(attribute(payload, key), niche?.[key]);
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
  return unmappedMatch(payload, (recordKey) => recordKey === key);
}

function unmappedNormalized(payload: Record<string, unknown>, normalizedKey: string): string {
  return unmappedMatch(payload, (recordKey) => normalizeSourceFieldKey(recordKey) === normalizedKey);
}

function unmappedMatch(payload: Record<string, unknown>, matches: (key: string) => boolean): string {
  const list = sourceIntake(payload)?.unmappedSourceFieldsJson;
  if (!Array.isArray(list)) return "";
  for (const item of list) {
    const record = asRecord(item);
    if (typeof record?.key !== "string" || !matches(record.key)) continue;
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
