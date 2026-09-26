import {
  buildHeaderIndex,
  getHeaderValue,
  normalizeAgedBulkHeader,
} from "./aged-inventory-bulk-adapters.js";
import { AGED_BULK_NEXTGEN_SOURCE_FORMAT } from "./aged-inventory-bulk.types.js";
import type { MasterRawRow } from "./aged-inventory-bulk-adapters.js";

export const NEXTGEN_EXPORT_REQUIRED_HEADERS = [
  "lead #",
  "created",
  "first name",
  "last name",
  "email",
  "phone",
  "funnel name",
  "state",
] as const;

const HEADER_ALIASES: Record<(typeof NEXTGEN_EXPORT_REQUIRED_HEADERS)[number], string[]> = {
  "lead #": ["Lead #", "Lead#", "Lead Number", "lead_number", "lead_id"],
  created: ["Created", "Created Date", "created_at", "Created At"],
  "first name": ["First Name", "first_name"],
  "last name": ["Last Name", "last_name"],
  email: ["Email"],
  phone: ["Phone", "Phone Number"],
  "funnel name": ["Funnel Name", "Funnel", "funnel_name"],
  state: ["State"],
};

export type NextGenExportRawRow = {
  kind: typeof AGED_BULK_NEXTGEN_SOURCE_FORMAT;
  rowNumber: number;
  leadNumberRaw: string;
  createdRaw: string;
  firstNameRaw: string;
  lastNameRaw: string;
  emailRaw: string;
  phoneRaw: string;
  funnelNameRaw: string;
  ipAddressRaw: string;
  militaryStatusRaw: string;
  stateRaw: string;
  branchOfServiceRaw: string;
  maritalStatusRaw: string;
  desiredCoverageRaw: string;
  beneficiaryRaw: string;
  dateOfBirthRaw: string;
  bestTimeToCallRaw: string;
  primaryReasonRaw: string;
  sexRaw: string;
  /** Original header → cell for every CSV column, including unmapped extras. */
  sourceColumns: Record<string, string>;
};

/**
 * Preserve the vendor Lead # as a string. Strip Excel integer `.0` only;
 * never generate a replacement identifier.
 */
export function canonicalizeNextGenLeadNumber(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return null;
  if (/^\d+\.0+$/.test(trimmed)) {
    return trimmed.replace(/\.0+$/, "");
  }
  return trimmed;
}

export function assertNextGenExportHeaders(
  headers: string[]
): { ok: true; index: Map<string, number> } | { ok: false; error: string } {
  const index = buildHeaderIndex(headers);
  for (const required of NEXTGEN_EXPORT_REQUIRED_HEADERS) {
    const aliases = HEADER_ALIASES[required];
    const found = aliases.some((alias) => index.has(normalizeAgedBulkHeader(alias)));
    if (!found) {
      return { ok: false, error: `missing_header:${required.replace(/\s+/g, "_")}` };
    }
  }
  return { ok: true, index };
}

export function adaptNextGenExportRow(input: {
  rowNumber: number;
  cols: string[];
  index: Map<string, number>;
  headers: string[];
}): NextGenExportRawRow {
  const { cols, index, rowNumber, headers } = input;
  const sourceColumns: Record<string, string> = {};
  headers.forEach((header, i) => {
    const key = header.trim() || `column_${i}`;
    sourceColumns[key] = cols[i] != null ? String(cols[i]).trim() : "";
  });

  return {
    kind: AGED_BULK_NEXTGEN_SOURCE_FORMAT,
    rowNumber,
    leadNumberRaw: getHeaderValue(cols, index, ...HEADER_ALIASES["lead #"]),
    createdRaw: getHeaderValue(cols, index, ...HEADER_ALIASES.created),
    firstNameRaw: getHeaderValue(cols, index, ...HEADER_ALIASES["first name"]),
    lastNameRaw: getHeaderValue(cols, index, ...HEADER_ALIASES["last name"]),
    emailRaw: getHeaderValue(cols, index, ...HEADER_ALIASES.email),
    phoneRaw: getHeaderValue(cols, index, ...HEADER_ALIASES.phone),
    funnelNameRaw: getHeaderValue(cols, index, ...HEADER_ALIASES["funnel name"]),
    ipAddressRaw: getHeaderValue(cols, index, "IP Address", "IP", "ip_address"),
    militaryStatusRaw: getHeaderValue(cols, index, "Military Status", "military_status"),
    stateRaw: getHeaderValue(cols, index, ...HEADER_ALIASES.state),
    branchOfServiceRaw: getHeaderValue(cols, index, "Branch of Service", "BRANCH OF SERVICE"),
    maritalStatusRaw: getHeaderValue(cols, index, "Marital Status", "marital_status"),
    desiredCoverageRaw: getHeaderValue(cols, index, "Desired Coverage", "desired_coverage"),
    beneficiaryRaw: getHeaderValue(cols, index, "Beneficiary", "BENEFICIARY"),
    dateOfBirthRaw: getHeaderValue(cols, index, "Date of Birth", "DOB", "date_of_birth"),
    bestTimeToCallRaw: getHeaderValue(cols, index, "Best Time to Call", "best_time_to_call"),
    primaryReasonRaw: getHeaderValue(
      cols,
      index,
      "Primary Reason",
      "Primary Concern",
      "primary_reason"
    ),
    sexRaw: getHeaderValue(cols, index, "Sex", "Gender"),
    sourceColumns,
  };
}

/** Project NextGen cells onto the Master raw shape so identity/date rules stay shared. */
export function nextGenExportToMasterRaw(raw: NextGenExportRawRow): MasterRawRow {
  const first = raw.firstNameRaw.trim();
  const last = raw.lastNameRaw.trim();
  const funnel = raw.funnelNameRaw.trim();
  return {
    rowNumber: raw.rowNumber,
    dateRaw: raw.createdRaw,
    leadTypeRaw: raw.funnelNameRaw,
    clientNameRaw: [first, last].filter(Boolean).join(" "),
    phoneRaw: raw.phoneRaw,
    emailRaw: raw.emailRaw,
    stateZipRaw: raw.stateRaw,
    ageRaw: raw.dateOfBirthRaw,
    dobAgeRaw: raw.dateOfBirthRaw,
    branchOfServiceRaw: raw.branchOfServiceRaw,
    disabilityRatingRaw: "",
    primaryConcernRaw: raw.primaryReasonRaw,
    companyOrIndependentRaw: "",
    rigTypeRaw: "",
    beneficiaryRaw: raw.beneficiaryRaw,
    syncedRaw: "",
    dateUsedLastRaw: "",
    statusRaw: "",
    usedByRaw: "",
    campaignName: funnel ? funnel : null,
  };
}
