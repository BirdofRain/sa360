import { tryNormalizeToVerifiedE164 } from "../phone-e164.service.js";
import { normalizeAgedInventoryEmail } from "../aged-inventory-import/aged-inventory-import-mapping.service.js";
import { parseHistoricalConsumerAge } from "./aged-inventory-bulk-consumer-age.js";
import { parseMasterGeneratedAt } from "./aged-inventory-bulk-date.js";
import { extractUsStateCode, extractUsZipCode } from "./aged-inventory-bulk-state.js";
import {
  buildAgedBulkSourceLeadId,
  maskAgedBulkSourceLeadId,
} from "./aged-inventory-bulk-source-id.js";
import type { MasterRawRow } from "./aged-inventory-bulk-adapters.js";
import { adaptMasterRow, assertMasterHeaders } from "./aged-inventory-bulk-adapters.js";
import {
  adaptNextGenExportRow,
  assertNextGenExportHeaders,
  canonicalizeNextGenLeadNumber,
  nextGenExportToMasterRaw,
  type NextGenExportRawRow,
} from "./aged-inventory-bulk-nextgen-adapter.js";
import type {
  AgedBulkInternalSource,
  AgedBulkLeadDetailsNiche,
  AgedBulkLeadDetailsPayload,
  AgedBulkNormalizedRow,
  AgedBulkRowDisposition,
  AgedBulkSourceFormat,
} from "./aged-inventory-bulk.types.js";
import { AGED_BULK_NEXTGEN_SOURCE_FORMAT } from "./aged-inventory-bulk.types.js";

function splitName(full: string): { first: string; last: string } | null {
  const parts = full.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export type IdentityConflictIndex = {
  phoneToEmail: Map<string, string>;
  emailToPhone: Map<string, string>;
  seenSourceIds: Set<string>;
};

export function createIdentityConflictIndex(): IdentityConflictIndex {
  return {
    phoneToEmail: new Map(),
    emailToPhone: new Map(),
    seenSourceIds: new Set(),
  };
}

function nonempty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function buildNicheDetails(
  nicheKey: string,
  raw: MasterRawRow
): AgedBulkLeadDetailsNiche {
  const niche: AgedBulkLeadDetailsNiche = {};
  if (nicheKey === "vet") {
    const branch = nonempty(raw.branchOfServiceRaw);
    const rating = nonempty(raw.disabilityRatingRaw);
    const concern = nonempty(raw.primaryConcernRaw);
    if (branch) niche.branch_of_service = branch;
    if (rating) niche.disability_rating = rating;
    if (concern) niche.primary_concern = concern;
  } else if (nicheKey === "trucker") {
    const company = nonempty(raw.companyOrIndependentRaw);
    const rig = nonempty(raw.rigTypeRaw);
    if (company) niche.company_or_independent = company;
    if (rig) niche.rig_type = rig;
  }
  return niche;
}

function inferSourceFormat(nicheKey: string): AgedBulkSourceFormat {
  return nicheKey === "vet" ? "vet_master_v1" : "trucker_master_v1";
}

function nonemptyAttribute(value: string | null | undefined): string | undefined {
  return nonempty(value) ?? undefined;
}

function nextGenSourceAttributes(raw: NextGenExportRawRow): Record<string, string> {
  const attributes: Record<string, string> = {};
  const assign = (key: string, value: string) => {
    const trimmed = nonempty(value);
    if (trimmed) attributes[key] = trimmed;
  };
  assign("military_status", raw.militaryStatusRaw);
  assign("branch_of_service", raw.branchOfServiceRaw);
  assign("marital_status", raw.maritalStatusRaw);
  assign("desired_coverage", raw.desiredCoverageRaw);
  assign("beneficiary", raw.beneficiaryRaw);
  assign("date_of_birth", raw.dateOfBirthRaw);
  assign("best_time_to_call", raw.bestTimeToCallRaw);
  assign("primary_reason", raw.primaryReasonRaw);
  assign("primary_concern", raw.primaryReasonRaw);
  assign("sex", raw.sexRaw);
  assign("ip_address", raw.ipAddressRaw);
  assign("funnel_name", raw.funnelNameRaw);
  return attributes;
}

export function buildAgedBulkLeadDetails(
  raw: MasterRawRow,
  nicheKey: string,
  consumerAge: number | null,
  dateOfBirth: string | null
): AgedBulkLeadDetailsPayload {
  return {
    consumer_age: consumerAge,
    date_of_birth: dateOfBirth,
    beneficiary: nonempty(raw.beneficiaryRaw),
    niche: buildNicheDetails(nicheKey, raw),
  };
}

export function buildAgedBulkInternalSource(
  raw: MasterRawRow,
  nicheKey: string,
  sourceFormat?: AgedBulkSourceFormat
): AgedBulkInternalSource {
  return {
    leadTypeRaw: raw.leadTypeRaw,
    dobAgeRaw: raw.dobAgeRaw || raw.ageRaw,
    dateUsedLastRaw: raw.dateUsedLastRaw ?? "",
    usedByRaw: raw.usedByRaw,
    statusRaw: raw.statusRaw,
    syncedRaw: raw.syncedRaw ?? "",
    rowNumber: raw.rowNumber,
    sourceFormat: sourceFormat ?? inferSourceFormat(nicheKey),
  };
}

/**
 * Additive historical payload: existing flat identity keys PLUS contact + lead_details.
 * Identity keys stay compatible; Lead Type never becomes niche.
 */
export function buildAgedBulkNormalizedPayload(row: AgedBulkNormalizedRow): Record<string, unknown> {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone_e164: row.phoneE164,
    state: row.state,
    generated_at: row.generatedAt.toISOString(),
    niche_key: row.nicheKey,
    campaign_name: row.campaignName,
    source_lead_id: row.sourceLeadId,
    source_funnel_name: row.sourceFunnelName,
    source_attributes: row.sourceAttributes,
    status_raw: row.statusRaw,
    used_by_present: row.usedByPresent,
    email_issue: row.emailIssue,
    contact: row.contact,
    lead_details: row.leadDetails,
  };
}

/**
 * Merge richer Master source representation with existing provenance.
 * Never destructively replace importRequestId / rowNumber.
 */
export function mergeAgedBulkRawPayload(
  existing: unknown,
  input: {
    importRequestId: string;
    rowNumber: number;
    internalSource: AgedBulkInternalSource;
  }
): Record<string, unknown> {
  const prior =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const existingRequestId =
    typeof prior.importRequestId === "string" && prior.importRequestId.trim()
      ? prior.importRequestId
      : input.importRequestId;
  const existingRowNumber =
    typeof prior.rowNumber === "number" ? prior.rowNumber : input.rowNumber;
  const base = {
    ...prior,
    importRequestId: existingRequestId,
    rowNumber: existingRowNumber,
  };
  if (input.internalSource.sourceFormat === AGED_BULK_NEXTGEN_SOURCE_FORMAT) {
    return {
      ...base,
      nextgen: {
        source_format: input.internalSource.sourceFormat,
        lead_number: input.internalSource.originalSourceLeadId ?? "",
        source_row_number: input.internalSource.rowNumber,
        source_row: input.internalSource.sourceColumns ?? {},
      },
    };
  }
  return {
    ...base,
    master: {
      lead_type: input.internalSource.leadTypeRaw,
      dob_age_raw: input.internalSource.dobAgeRaw,
      date_used_last: input.internalSource.dateUsedLastRaw,
      used_by: input.internalSource.usedByRaw,
      status: input.internalSource.statusRaw,
      synced: input.internalSource.syncedRaw,
      source_row_number: input.internalSource.rowNumber,
      source_format: input.internalSource.sourceFormat,
    },
  };
}

/**
 * Normalize one master row under bulk identity policy:
 * - STATUS=PULLED retained (not excluded)
 * - Used By retained as presence flag only (not ownership)
 * - Lead Type never sets niche
 * - Spreadsheet DOB/AGE is consumer age only; generatedAt comes from lead Date
 * - exact source ID duplicate → skip
 * - phone/email conflict → quarantine
 * - no usable identity → reject
 * - valid phone + bad email → retain with emailIssue
 * - email-only (no usable phone) → accept (canonical policy supports email identity)
 */
export function normalizeMasterRow(input: {
  raw: MasterRawRow;
  nicheKey: string;
  identityIndex: IdentityConflictIndex;
  evaluatedAt?: Date;
  sourceFormat?: AgedBulkSourceFormat;
  /** When set (including empty), preserve this vendor ID instead of hashing aged-v1. */
  sourceLeadIdOverride?: string | null;
  nameParts?: { first: string; last: string } | null;
}): AgedBulkNormalizedRow {
  const evaluatedAt = input.evaluatedAt ?? new Date();
  const blockerCodes: string[] = [];
  let disposition: AgedBulkRowDisposition = "accept";

  const name = input.nameParts
    ? input.nameParts.first.trim() && input.nameParts.last.trim()
      ? { first: input.nameParts.first.trim(), last: input.nameParts.last.trim() }
      : null
    : splitName(input.raw.clientNameRaw);
  const dateParsed = parseMasterGeneratedAt(input.raw.dateRaw, evaluatedAt);
  const state = extractUsStateCode(input.raw.stateZipRaw);
  const zip = extractUsZipCode(input.raw.stateZipRaw);
  const nicheKey = input.nicheKey.trim().toLowerCase();
  const consumerParsed = parseHistoricalConsumerAge(
    input.raw.dobAgeRaw || input.raw.ageRaw,
    evaluatedAt
  );

  const phoneResult = input.raw.phoneRaw
    ? tryNormalizeToVerifiedE164(input.raw.phoneRaw)
    : null;
  const phoneE164 = phoneResult && "e164" in phoneResult ? phoneResult.e164 : null;
  const emailLooksValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  let email = normalizeAgedInventoryEmail(input.raw.emailRaw);
  let emailIssue: string | null = null;
  if (input.raw.emailRaw.trim()) {
    if (!email || !emailLooksValid(email)) {
      emailIssue = "invalid_email_format";
      email = null;
    }
  }

  if (!nicheKey) {
    disposition = "reject_niche";
    blockerCodes.push("niche_missing");
  } else if (input.sourceLeadIdOverride !== undefined && !(input.sourceLeadIdOverride ?? "").trim()) {
    disposition = "reject_missing_source_lead_id";
    blockerCodes.push("missing_source_lead_id");
  } else if (!name) {
    disposition = "reject_invalid_name";
    blockerCodes.push("invalid_name");
  } else if (!dateParsed.ok) {
    disposition =
      dateParsed.code === "future_generated_at" ? "reject_future_date" : "reject_invalid_date";
    blockerCodes.push(dateParsed.code);
  } else if (!state) {
    disposition = "reject_invalid_state";
    blockerCodes.push("invalid_state");
  } else if (!phoneE164 && !email) {
    disposition = "reject_no_identity";
    blockerCodes.push("invalid_identity");
  }

  const generatedAt = dateParsed.ok ? dateParsed.value : new Date(0);
  const isoDate = dateParsed.ok ? dateParsed.isoDate : "1970-01-01";
  const firstName = name?.first ?? "";
  const lastName = name?.last ?? "";
  const sourceLeadId =
    input.sourceLeadIdOverride !== undefined
      ? (input.sourceLeadIdOverride ?? "").trim()
      : buildAgedBulkSourceLeadId({
          nicheKey: nicheKey || "unknown",
          phoneE164,
          email,
          generatedDateIso: isoDate,
          firstName,
          lastName,
        });

  if (disposition === "accept") {
    if (input.identityIndex.seenSourceIds.has(sourceLeadId)) {
      disposition = "exact_source_duplicate";
      blockerCodes.push("exact_source_duplicate");
    } else {
      // Identity conflict: same phone previously mapped to a different email (or vice versa)
      if (phoneE164 && email) {
        const prevEmail = input.identityIndex.phoneToEmail.get(phoneE164);
        const prevPhone = input.identityIndex.emailToPhone.get(email);
        if ((prevEmail && prevEmail !== email) || (prevPhone && prevPhone !== phoneE164)) {
          disposition = "quarantine_identity_conflict";
          blockerCodes.push("identity_conflict");
        }
      } else if (phoneE164) {
        const prevEmail = input.identityIndex.phoneToEmail.get(phoneE164);
        // phone-only row after phone+email seen with email — not necessarily conflict; allow
        void prevEmail;
      }

      if (disposition === "accept") {
        input.identityIndex.seenSourceIds.add(sourceLeadId);
        if (phoneE164 && email) {
          input.identityIndex.phoneToEmail.set(phoneE164, email);
          input.identityIndex.emailToPhone.set(email, phoneE164);
        }
        if (emailIssue) {
          disposition = "email_issue_retained";
          blockerCodes.push("email_issue_retained");
        }
      }
    }
  }

  const resolvedState = state ?? "";
  const beneficiary = nonempty(input.raw.beneficiaryRaw);
  const contact = {
    first_name: firstName,
    last_name: lastName,
    phone_e164: phoneE164,
    email,
    state: resolvedState,
    zip,
  };
  const leadDetails = buildAgedBulkLeadDetails(
    input.raw,
    nicheKey,
    consumerParsed.consumerAge,
    consumerParsed.dateOfBirth
  );

  return {
    rowNumber: input.raw.rowNumber,
    sourceLeadId,
    maskedSourceLeadId: maskAgedBulkSourceLeadId(sourceLeadId),
    firstName,
    lastName,
    phoneE164,
    email,
    emailIssue,
    state: resolvedState,
    zip,
    generatedAt,
    nicheKey,
    campaignName: input.raw.campaignName,
    sourceFunnelName: null,
    sourceAttributes: {},
    statusRaw: input.raw.statusRaw || null,
    usedByPresent: Boolean(input.raw.usedByRaw.trim()),
    consumerAge: consumerParsed.consumerAge,
    dateOfBirth: consumerParsed.dateOfBirth,
    consumerAgeParseStatus: consumerParsed.status,
    beneficiary,
    contact,
    leadDetails,
    internalSource: buildAgedBulkInternalSource(input.raw, nicheKey, input.sourceFormat),
    disposition,
    blockerCodes,
  };
}

export function applyNextGenExportOverlay(
  row: AgedBulkNormalizedRow,
  raw: NextGenExportRawRow
): AgedBulkNormalizedRow {
  const sourceAttributes = nextGenSourceAttributes(raw);
  const niche: AgedBulkLeadDetailsNiche = { ...row.leadDetails.niche };
  const military = nonemptyAttribute(raw.militaryStatusRaw);
  const marital = nonemptyAttribute(raw.maritalStatusRaw);
  const sex = nonemptyAttribute(raw.sexRaw);
  const coverage = nonemptyAttribute(raw.desiredCoverageRaw);
  if (military) niche.military_status = military;
  if (marital) niche.marital_status = marital;
  if (sex) niche.sex = sex;
  if (coverage) niche.desired_coverage = coverage;
  const funnel = nonempty(raw.funnelNameRaw);
  return {
    ...row,
    sourceFunnelName: funnel,
    sourceAttributes,
    leadDetails: {
      ...row.leadDetails,
      niche,
    },
    internalSource: {
      ...row.internalSource,
      sourceFormat: AGED_BULK_NEXTGEN_SOURCE_FORMAT,
      originalSourceLeadId: canonicalizeNextGenLeadNumber(raw.leadNumberRaw) ?? "",
      sourceColumns: raw.sourceColumns,
    },
  };
}

export function normalizeNextGenExportRow(input: {
  raw: NextGenExportRawRow;
  nicheKey: string;
  identityIndex: IdentityConflictIndex;
  evaluatedAt?: Date;
}): AgedBulkNormalizedRow {
  const leadNumber = canonicalizeNextGenLeadNumber(input.raw.leadNumberRaw);
  const row = normalizeMasterRow({
    raw: nextGenExportToMasterRaw(input.raw),
    nicheKey: input.nicheKey,
    identityIndex: input.identityIndex,
    evaluatedAt: input.evaluatedAt,
    sourceFormat: AGED_BULK_NEXTGEN_SOURCE_FORMAT,
    sourceLeadIdOverride: leadNumber ?? "",
    nameParts: { first: input.raw.firstNameRaw, last: input.raw.lastNameRaw },
  });
  return applyNextGenExportOverlay(row, input.raw);
}

export function assertAgedBulkHeaders(
  headers: string[],
  sourceFormat: AgedBulkSourceFormat
): { ok: true; index: Map<string, number> } | { ok: false; error: string } {
  if (sourceFormat === AGED_BULK_NEXTGEN_SOURCE_FORMAT) {
    return assertNextGenExportHeaders(headers);
  }
  return assertMasterHeaders(headers, sourceFormat);
}

export function parseAgedBulkNormalizedRow(input: {
  rowNumber: number;
  cols: string[];
  headers: string[];
  index: Map<string, number>;
  sourceFormat: AgedBulkSourceFormat;
  nicheKey: string;
  identityIndex: IdentityConflictIndex;
  evaluatedAt?: Date;
}): AgedBulkNormalizedRow {
  if (input.sourceFormat === AGED_BULK_NEXTGEN_SOURCE_FORMAT) {
    const raw = adaptNextGenExportRow({
      rowNumber: input.rowNumber,
      cols: input.cols,
      index: input.index,
      headers: input.headers,
    });
    return normalizeNextGenExportRow({
      raw,
      nicheKey: input.nicheKey,
      identityIndex: input.identityIndex,
      evaluatedAt: input.evaluatedAt,
    });
  }
  const raw = adaptMasterRow({
    rowNumber: input.rowNumber,
    cols: input.cols,
    index: input.index,
    sourceFormat: input.sourceFormat,
  });
  return normalizeMasterRow({
    raw,
    nicheKey: input.nicheKey,
    identityIndex: input.identityIndex,
    evaluatedAt: input.evaluatedAt,
    sourceFormat: input.sourceFormat,
  });
}

export function isAcceptDisposition(d: AgedBulkRowDisposition): boolean {
  return d === "accept" || d === "email_issue_retained";
}
