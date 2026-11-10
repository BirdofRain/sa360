import type { AgedBulkSourceFormat } from "./aged-inventory-bulk.types.js";

export type MasterRawRow = {
  rowNumber: number;
  dateRaw: string;
  leadTypeRaw: string;
  clientNameRaw: string;
  phoneRaw: string;
  emailRaw: string;
  stateZipRaw: string;
  /** Spreadsheet AGE / DOB/AGE cell. Alias of dobAgeRaw for existing callers. */
  ageRaw: string;
  dobAgeRaw: string;
  branchOfServiceRaw: string;
  disabilityRatingRaw: string;
  primaryConcernRaw: string;
  companyOrIndependentRaw: string;
  rigTypeRaw: string;
  beneficiaryRaw: string;
  syncedRaw: string;
  dateUsedLastRaw: string;
  statusRaw: string;
  usedByRaw: string;
  /** Campaign label from Lead Type — internal only, never buyer-visible. */
  campaignName: string | null;
};

export function normalizeAgedBulkHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildHeaderIndex(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((h, i) => map.set(normalizeAgedBulkHeader(h), i));
  return map;
}

export function getHeaderValue(
  cols: string[],
  index: Map<string, number>,
  ...names: string[]
): string {
  for (const name of names) {
    const i = index.get(normalizeAgedBulkHeader(name));
    if (i != null && cols[i] != null) return cols[i]!.trim();
  }
  return "";
}

export function assertMasterHeaders(
  headers: string[],
  sourceFormat: AgedBulkSourceFormat
): { ok: true; index: Map<string, number> } | { ok: false; error: string } {
  const index = buildHeaderIndex(headers);
  const required =
    sourceFormat === "vet_master_v1"
      ? ["date", "lead type", "client name", "phone", "email", "state / zip"]
      : ["date", "lead type", "client name", "phone", "email", "state/zip"];

  // Trucker uses STATE/ZIP; allow either
  const hasState =
    index.has("state / zip") || index.has("state/zip") || index.has("state");
  if (!hasState) return { ok: false, error: "missing_state_zip_header" };

  for (const key of ["date", "client name", "phone", "email"]) {
    const aliases =
      key === "client name"
        ? ["client name"]
        : key === "date"
          ? ["date"]
          : [key];
    const found = aliases.some((a) => index.has(a));
    if (!found) return { ok: false, error: `missing_header:${key}` };
  }

  const hasLeadType = index.has("lead type");
  if (!hasLeadType) return { ok: false, error: "missing_header:lead_type" };

  void required;
  return { ok: true, index };
}

export function adaptMasterRow(input: {
  rowNumber: number;
  cols: string[];
  index: Map<string, number>;
  sourceFormat: AgedBulkSourceFormat;
}): MasterRawRow {
  const { cols, index, rowNumber } = input;
  const leadType = getHeaderValue(cols, index, "Lead Type", "LEAD TYPE");
  const dobAge = getHeaderValue(cols, index, "DOB/ AGE", "DOB/AGE", "DOB / AGE", "AGE");
  return {
    rowNumber,
    dateRaw: getHeaderValue(cols, index, "Date"),
    leadTypeRaw: leadType,
    clientNameRaw: getHeaderValue(cols, index, "Client Name", "CLIENT NAME"),
    phoneRaw: getHeaderValue(cols, index, "Phone", "PHONE"),
    emailRaw: getHeaderValue(cols, index, "Email", "EMAIL"),
    stateZipRaw: getHeaderValue(cols, index, "State / Zip", "STATE/ZIP", "State/Zip"),
    ageRaw: dobAge,
    dobAgeRaw: dobAge,
    branchOfServiceRaw: getHeaderValue(cols, index, "Branch of Service", "BRANCH OF SERVICE"),
    disabilityRatingRaw: getHeaderValue(cols, index, "Disability Rating", "DISABILITY RATING"),
    primaryConcernRaw: getHeaderValue(cols, index, "Primary Concern", "PRIMARY CONCERN"),
    companyOrIndependentRaw: getHeaderValue(
      cols,
      index,
      "COMPANY OR INDY?",
      "Company or Indy?",
      "COMPANY OR INDY",
      "Company or Independent"
    ),
    rigTypeRaw: getHeaderValue(cols, index, "RIG TYPE?", "Rig Type?", "RIG TYPE", "Rig Type"),
    beneficiaryRaw: getHeaderValue(cols, index, "Beneficiary", "BENEFICIARY"),
    syncedRaw: getHeaderValue(cols, index, "Synced", "SYNCED"),
    dateUsedLastRaw: getHeaderValue(cols, index, "Date Used Last", "DATE USED LAST"),
    statusRaw: getHeaderValue(cols, index, "STATUS", "Status"),
    usedByRaw: getHeaderValue(cols, index, "Used By:", "Used By", "USED BY:"),
    campaignName: leadType.trim() ? leadType.trim() : null,
  };
}

/**
 * Niche comes only from CLI --default-niche, never from Lead Type.
 */
export function resolveDefaultNiche(
  sourceFormat: AgedBulkSourceFormat,
  defaultNiche: string
): string {
  const niche = defaultNiche.trim().toLowerCase();
  if (sourceFormat === "vet_master_v1" && niche !== "vet") {
    throw new Error("niche_mismatch:vet_master_v1_requires_vet");
  }
  if (sourceFormat === "trucker_master_v1" && niche !== "trucker") {
    throw new Error("niche_mismatch:trucker_master_v1_requires_trucker");
  }
  if (sourceFormat === "leadcapture_nextgen_export_v1" && niche !== "vet") {
    throw new Error("niche_mismatch:leadcapture_nextgen_export_v1_requires_vet");
  }
  return niche;
}
