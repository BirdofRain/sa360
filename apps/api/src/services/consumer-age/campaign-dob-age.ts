/**
 * Campaign DOB / age. This is not the aged-inventory commercial policy.
 *
 * Aged-inventory eligibility (18–120 plausible ages, Excel serials, and the
 * sellable maximum of 86) stays in `parseHistoricalConsumerAge` and
 * `resolveConsumerAgeForFulfillment`. Campaign intake and Sheets projection
 * do not call those gates. An age outside that window still delivers. A
 * numeric cell is never turned into a birthday.
 *
 * Age reference rule `submitted_at_utc_date_else_received_at_utc_date`:
 * completed whole years are measured against the UTC calendar date of the
 * lead's source `submitted_at`. When that instant is missing, the stored
 * event `receivedAt` is the reference. Wall-clock `new Date()` is not a
 * campaign age reference, so replaying the same payload and the same instant
 * yields the same age.
 *
 * A date-only birthday keeps the calendar date written by the source. An
 * ISO datetime keeps the `YYYY-MM-DD` token before `T` and is not shifted
 * into America/New_York. The sheet Date column still formats generation
 * time in New York; that transform is not applied to a date-only DOB.
 */

import { completedWholeYearsAsOf } from "../aged-inventory-bulk/aged-inventory-bulk-consumer-age.js";
import {
  DEFAULT_SOURCE_FIELD_ALIASES,
  normalizeSourceFieldKey,
} from "../source-intake/source-field-alias.registry.js";
import {
  EXPLICIT_CONSUMER_AGE_KEYS,
  EXPLICIT_DATE_OF_BIRTH_KEYS,
} from "./consumer-age-policy.js";

export const CAMPAIGN_AGE_REFERENCE_RULE =
  "submitted_at_utc_date_else_received_at_utc_date" as const;

/** Preview and custom-sheet warning. The Age and DOB cells stay readable. */
export const CAMPAIGN_DOB_AGE_CONFLICT_WARNING =
  "consumer_age_conflicts_with_date_of_birth" as const;

export type CampaignAgeProvenance = "supplied" | "derived_from_date_of_birth";

export type CampaignDobAgeFields = {
  consumer_age?: string;
  date_of_birth?: string;
  consumer_age_provenance?: CampaignAgeProvenance;
  date_of_birth_provenance?: "supplied";
  consumer_age_derived?: string;
  consumer_age_reference_date?: string;
  consumer_age_reference_rule?: typeof CAMPAIGN_AGE_REFERENCE_RULE;
  consumer_age_conflict?: true;
};

export type CampaignDobAgeOptions = {
  /** Explicit evaluation instant. Used by tests and by callers that already parsed one. */
  evaluatedAt?: Date | null;
  /** Source `submitted_at` or event `receivedAt`. */
  referenceAt?: string | null;
  /** Source-scoped custom-question aliases. Not added to the global registry. */
  routeAliasOverrides?: Record<string, readonly string[]>;
};

export type CampaignDobAgePreview = {
  age: string;
  dateOfBirth: string;
  dateOfBirthSheet: string;
  ageProvenance: CampaignAgeProvenance | "missing";
  dateOfBirthProvenance: "supplied" | "missing";
  derivedAge: string;
  referenceDate: string;
  referenceRule: typeof CAMPAIGN_AGE_REFERENCE_RULE;
  conflict: boolean;
};

export type CampaignDobAgeEvidence = {
  key: string | null;
  valueType: string | null;
  format: string | null;
  year: string | null;
};

export type CampaignDobAgeRecovery =
  | "already_projected"
  | "derived_at_delivery"
  | "needs_source_alias"
  | "invalid_evidence"
  | "age_only"
  | "conflict_visible"
  | "no_evidence";

export type CampaignDobAgeRecoveryAssessment = {
  recovery: CampaignDobAgeRecovery;
  storedAgeBlank: boolean;
  storedDobBlank: boolean;
  projectedAge: string;
  projectedDateOfBirth: string;
  recoverableWithoutBackfill: boolean;
  evidence: CampaignDobAgeEvidence;
  unmappedNotAliased: Array<{
    key: string;
    valueType: string;
    parsesAsDate: boolean;
    parsesAsAge: boolean;
    year: string | null;
  }>;
};

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const MAX_SUPPLIED_CAMPAIGN_AGE = 130;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function cellText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** UTC calendar date `YYYY-MM-DD` for a parseable instant, or null. */
export function campaignAgeReferenceDate(instant: string | Date | null | undefined): string | null {
  if (instant == null) return null;
  const parsed = instant instanceof Date ? instant : new Date(instant.trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return isoDateOnly(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
}

export function referenceDateFromOptions(
  options?: Date | CampaignDobAgeOptions | null
): string | null {
  if (options instanceof Date) return campaignAgeReferenceDate(options);
  if (!options) return null;
  if (options.referenceAt) return campaignAgeReferenceDate(options.referenceAt);
  if (options.evaluatedAt) return campaignAgeReferenceDate(options.evaluatedAt);
  return null;
}

function isoDateOnly(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const stamp = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(stamp.getTime()) ||
    stamp.getUTCFullYear() !== year ||
    stamp.getUTCMonth() !== month - 1 ||
    stamp.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Calendar date written by the source. Datetime suffixes are ignored so a
 * date-only value serialized as midnight UTC is not moved to the previous
 * America/New_York day.
 */
export function parseCampaignDateOfBirth(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(trimmed);
  if (iso) return isoDateOnly(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (us) return isoDateOnly(Number(us[3]), Number(us[1]), Number(us[2]));

  const monthFirst = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(trimmed);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1]!.toLowerCase()];
    if (!month) return null;
    return isoDateOnly(Number(monthFirst[3]), month, Number(monthFirst[2]));
  }

  const dayFirst = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(trimmed);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2]!.toLowerCase()];
    if (!month) return null;
    return isoDateOnly(Number(dayFirst[3]), month, Number(dayFirst[1]));
  }

  return null;
}

/** Explicit age. Never invents a birthday. Does not apply the 18–86 sellable window. */
export function parseCampaignSuppliedAge(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  const match = /^(0|[1-9]\d{0,2})(?:\.0+)?$/.exec(trimmed);
  if (!match) return null;
  const age = Number(match[1]);
  if (!Number.isInteger(age) || age > MAX_SUPPLIED_CAMPAIGN_AGE) return null;
  return String(age);
}

export function formatCampaignDobSheet(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return "";
  return `${match[2]}/${match[3]}/${match[1]}`;
}

export function deriveCampaignAge(isoDate: string, referenceDate: string | null): string | null {
  if (!referenceDate) return null;
  const [year, month, day] = referenceDate.split("-").map(Number);
  if (!year || !month || !day) return null;
  const age = completedWholeYearsAsOf(isoDate, new Date(Date.UTC(year, month - 1, day)));
  if (age == null) return null;
  return String(age);
}

function aliasSet(
  canonical: "date_of_birth" | "age",
  overrides?: Record<string, readonly string[]>
): Set<string> {
  const explicit = canonical === "date_of_birth" ? EXPLICIT_DATE_OF_BIRTH_KEYS : EXPLICIT_CONSUMER_AGE_KEYS;
  const scoped = overrides?.[canonical] ?? [];
  const keys = [...DEFAULT_SOURCE_FIELD_ALIASES[canonical], ...explicit, ...scoped];
  return new Set(keys.map((key) => normalizeSourceFieldKey(key)).filter(Boolean));
}

type FlatCell = {
  key: string;
  normalizedKey: string;
  text: string;
  valueType: string;
  origin: "field" | "unmapped";
};

function pushCell(cells: FlatCell[], key: string, value: unknown, origin: FlatCell["origin"]): void {
  const text = cellText(value);
  if (!text) return;
  const normalizedKey = normalizeSourceFieldKey(key);
  if (!normalizedKey) return;
  cells.push({ key, normalizedKey, text, valueType: valueType(value), origin });
}

function cellsFromBag(bag: unknown, cells: FlatCell[]): void {
  const record = asRecord(bag);
  if (!record) return;
  for (const [key, value] of Object.entries(record)) {
    if (key === "unmappedSourceFieldsJson" && Array.isArray(value)) {
      for (const item of value) {
        const row = asRecord(item);
        if (!row || typeof row.key !== "string") continue;
        pushCell(cells, row.key, row.value, "unmapped");
      }
      continue;
    }
    pushCell(cells, key, value, "field");
  }
}

function firstMatch(cells: FlatCell[], aliases: Set<string>, parse: (text: string) => string | null): FlatCell | null {
  for (const cell of cells) {
    if (!aliases.has(cell.normalizedKey)) continue;
    if (parse(cell.text)) return cell;
  }
  return null;
}

export function resolveCampaignDobAgeFromBags(
  bags: unknown[],
  reference: Date | CampaignDobAgeOptions | string | null = null,
  routeAliasOverrides?: Record<string, readonly string[]>
): CampaignDobAgeFields {
  const options: CampaignDobAgeOptions =
    reference instanceof Date
      ? { evaluatedAt: reference, routeAliasOverrides }
      : typeof reference === "string"
        ? { referenceAt: reference, routeAliasOverrides }
        : { ...(reference ?? {}), routeAliasOverrides: routeAliasOverrides ?? reference?.routeAliasOverrides };
  const cells: FlatCell[] = [];
  for (const bag of bags) cellsFromBag(bag, cells);
  return fieldsFromCells(cells, options);
}

function fieldsFromCells(cells: FlatCell[], options: CampaignDobAgeOptions): CampaignDobAgeFields {
  const dobAliases = aliasSet("date_of_birth", options.routeAliasOverrides);
  const ageAliases = aliasSet("age", options.routeAliasOverrides);
  const dob = firstMatch(cells, dobAliases, parseCampaignDateOfBirth);
  const age = firstMatch(cells, ageAliases, parseCampaignSuppliedAge);
  const iso = dob ? parseCampaignDateOfBirth(dob.text) : null;
  const supplied = age ? parseCampaignSuppliedAge(age.text) : null;
  const referenceDate = referenceDateFromOptions(options);
  const derived = iso ? deriveCampaignAge(iso, referenceDate) : null;

  const fields: CampaignDobAgeFields = {};
  if (iso) {
    fields.date_of_birth = iso;
    fields.date_of_birth_provenance = "supplied";
  }
  if (derived) {
    fields.consumer_age_derived = derived;
    if (referenceDate) {
      fields.consumer_age_reference_date = referenceDate;
      fields.consumer_age_reference_rule = CAMPAIGN_AGE_REFERENCE_RULE;
    }
  }
  if (supplied) {
    fields.consumer_age = supplied;
    fields.consumer_age_provenance = "supplied";
    if (derived && supplied !== derived) fields.consumer_age_conflict = true;
  } else if (derived) {
    fields.consumer_age = derived;
    fields.consumer_age_provenance = "derived_from_date_of_birth";
  }
  return fields;
}

function normalizedPayloadCells(payload: unknown): FlatCell[] {
  const root = asRecord(payload);
  if (!root) return [];
  const intake = asRecord(asRecord(root.routing)?.source_intake);
  const details = asRecord(root.lead_details);
  const cells: FlatCell[] = [];
  const derivedStored = cellText(details?.consumer_age_provenance) === "derived_from_date_of_birth";
  if (details) {
    for (const [key, value] of Object.entries(details)) {
      if (derivedStored && normalizeSourceFieldKey(key) === "consumer_age") continue;
      pushCell(cells, key, value, "field");
    }
  }
  for (const bag of [asRecord(intake?.sourceAttributes), asRecord(root.sourceAttributes), asRecord(root.contact)]) {
    cellsFromBag(bag, cells);
  }
  cellsFromBag({ unmappedSourceFieldsJson: intake?.unmappedSourceFieldsJson }, cells);
  return cells;
}

function storedText(payload: unknown, key: "consumer_age" | "date_of_birth"): string {
  const details = asRecord(asRecord(payload)?.lead_details);
  return cellText(details?.[key]);
}

/**
 * Age and date-only DOB for one campaign sheet row.
 * Stored age wins. A blank age is derived from a recognized DOB. A supplied
 * age that disagrees with that DOB stays on the Age cell and `conflict` is set.
 */
export function projectCampaignDobAge(input: {
  normalizedPayload: unknown;
  receivedAt?: string | null;
  routeAliasOverrides?: Record<string, readonly string[]>;
}): CampaignDobAgePreview {
  const root = asRecord(input.normalizedPayload);
  const intake = asRecord(asRecord(root?.routing)?.source_intake);
  const referenceAt = cellText(intake?.submitted_at) || input.receivedAt || null;
  const fields = fieldsFromCells(normalizedPayloadCells(input.normalizedPayload), {
    referenceAt,
    routeAliasOverrides: input.routeAliasOverrides,
  });
  const iso = fields.date_of_birth ?? "";
  return {
    age: fields.consumer_age ?? "",
    dateOfBirth: iso,
    dateOfBirthSheet: iso ? formatCampaignDobSheet(iso) : "",
    ageProvenance: fields.consumer_age_provenance ?? "missing",
    dateOfBirthProvenance: fields.date_of_birth_provenance ?? "missing",
    derivedAge: fields.consumer_age_derived ?? "",
    referenceDate: fields.consumer_age_reference_date ?? "",
    referenceRule: CAMPAIGN_AGE_REFERENCE_RULE,
    conflict: fields.consumer_age_conflict === true,
  };
}

function evidenceYear(text: string): { format: string | null; year: string | null } {
  const iso = parseCampaignDateOfBirth(text);
  if (!iso) return { format: null, year: null };
  const format = /^\d{4}-\d{2}-\d{2}$/.test(text.trim())
    ? "iso_date"
    : /^\d{4}-\d{2}-\d{2}T/.test(text.trim())
      ? "iso_datetime_date_prefix"
      : /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text.trim())
        ? "us_numeric"
        : "month_name";
  return { format, year: iso.slice(0, 4) };
}

/**
 * Read-only classification of one stored payload. It does not write, replay,
 * or call a sheet. Production rows are not loaded here.
 */
export function assessCampaignDobAgeRecovery(input: {
  normalizedPayload: unknown;
  receivedAt?: string | null;
  routeAliasOverrides?: Record<string, readonly string[]>;
}): CampaignDobAgeRecoveryAssessment {
  const projected = projectCampaignDobAge(input);
  const storedAgeBlank = !storedText(input.normalizedPayload, "consumer_age");
  const storedDobBlank = !parseCampaignDateOfBirth(storedText(input.normalizedPayload, "date_of_birth"));
  const cells = normalizedPayloadCells(input.normalizedPayload);
  const dobAliases = aliasSet("date_of_birth", input.routeAliasOverrides);
  const ageAliases = aliasSet("age", input.routeAliasOverrides);
  const dobCell =
    firstMatch(cells, dobAliases, parseCampaignDateOfBirth) ??
    firstMatch(cells, dobAliases, (text) => text);
  const parsedDob = dobCell ? parseCampaignDateOfBirth(dobCell.text) : null;
  const evidenceBase = dobCell ? evidenceYear(dobCell.text) : { format: null, year: null };

  const unmapped = cells.filter(
    (cell) =>
      cell.origin === "unmapped" &&
      !dobAliases.has(cell.normalizedKey) &&
      !ageAliases.has(cell.normalizedKey)
  );
  const seen = new Set<string>();
  const unmappedNotAliased = [];
  for (const cell of unmapped) {
    if (seen.has(cell.normalizedKey)) continue;
    seen.add(cell.normalizedKey);
    const parsed = parseCampaignDateOfBirth(cell.text);
    unmappedNotAliased.push({
      key: cell.key,
      valueType: cell.valueType,
      parsesAsDate: Boolean(parsed),
      parsesAsAge: Boolean(parseCampaignSuppliedAge(cell.text)),
      year: parsed ? parsed.slice(0, 4) : null,
    });
  }

  let recovery: CampaignDobAgeRecovery = "no_evidence";
  if (projected.conflict) recovery = "conflict_visible";
  else if (!storedAgeBlank && !storedDobBlank) recovery = "already_projected";
  else if (!storedAgeBlank && storedDobBlank && projected.dateOfBirthProvenance === "missing") recovery = "age_only";
  else if (storedAgeBlank && projected.age && projected.ageProvenance === "derived_from_date_of_birth") {
    recovery = "derived_at_delivery";
  } else if (dobCell && !parsedDob) recovery = "invalid_evidence";
  else if (unmappedNotAliased.some((row) => row.parsesAsDate)) recovery = "needs_source_alias";
  else if (projected.age || projected.dateOfBirth) recovery = "already_projected";

  const recoverableWithoutBackfill =
    recovery === "derived_at_delivery" ||
    recovery === "already_projected" ||
    recovery === "conflict_visible" ||
    recovery === "age_only";

  return {
    recovery,
    storedAgeBlank,
    storedDobBlank,
    projectedAge: projected.age,
    projectedDateOfBirth: projected.dateOfBirth,
    recoverableWithoutBackfill,
    evidence: {
      key: dobCell?.key ?? null,
      valueType: dobCell?.valueType ?? null,
      format: evidenceBase.format,
      year: evidenceBase.year,
    },
    unmappedNotAliased,
  };
}
