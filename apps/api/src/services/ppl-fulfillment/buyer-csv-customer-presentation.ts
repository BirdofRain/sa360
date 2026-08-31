/**
 * Customer-facing presentation for newly generated PPL buyer CSV packages.
 *
 * Does not change v1/v2/v3 extractors or already-persisted package bytes.
 * Historical released artifacts remain downloadable as stored.
 *
 * Niche display names come from @sa360/shared NICHE_DISPLAY_NAMES — the same
 * map consumed by the customer portal formatter.
 */

import { lookupNicheDisplayName } from "@sa360/shared";

import {
  nicheSpecificV3ColumnsFor,
  normalizeBuyerNicheKey,
} from "./buyer-lead-fields.js";

/** Latest customer-presentable buyer CSV schema identity. */
export const BUYER_CSV_V4_FIELD_SCHEMA_VERSION = "buyer_csv_v4";

export const BUYER_CSV_CUSTOMER_HEADER_LABELS: Record<string, string> = {
  lead_date: "Date Generated",
  niche: "Lead Type",
  first_name: "First Name",
  last_name: "Last Name",
  phone: "Phone",
  email: "Email",
  state: "State",
  zip: "ZIP",
  age: "Age",
  beneficiary: "Beneficiary",
  coverage_amount: "Coverage Amount",
  branch_of_service: "Branch of Service",
  disability_rating: "Disability Rating",
  primary_concern: "Primary Concern",
  rig_type: "Rig Type",
  company_or_independent: "Company or Independent",
  healthcare_profession: "Healthcare Profession",
  homeowner: "Homeowner",
  house_type: "House Type",
};

/** Identity / date / type prefix. ZIP is inserted after State when the package has ZIP data. */
export const BUYER_CSV_CUSTOMER_PREFIX_COLUMNS = [
  "lead_date",
  "niche",
  "first_name",
  "last_name",
  "phone",
  "email",
  "state",
] as const;

/** Package-level optional columns — omitted only when every row is blank/null. */
export const BUYER_CSV_CUSTOMER_OPTIONAL_PACKAGE_COLUMNS = [
  "zip",
  "coverage_amount",
] as const;

export type BuyerCsvPresentationRow = Record<string, string>;

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function titleFirstWord(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Customer-facing Lead Type. Uses the shared niche display-name map when
 * present; otherwise formats the internal key without emitting a raw unmatched
 * token when a known token is nested (e.g. vet_fex → Veteran fex).
 */
export function buyerCsvNicheDisplayName(nicheKey: string): string {
  const key = normalizeBuyerNicheKey(nicheKey);
  if (!key) return "";
  const exact = lookupNicheDisplayName(key);
  if (exact) return exact;

  const words = key.split(/[_\s-]+/).filter(Boolean);
  if (words.length === 0) return nicheKey.trim();
  return words
    .map((word, index) => {
      const mapped = lookupNicheDisplayName(word);
      if (mapped) return mapped;
      return index === 0 ? titleFirstWord(word) : word.toLowerCase();
    })
    .join(" ");
}

export function buyerCsvCustomerHeaderLabel(columnKey: string): string {
  const mapped = BUYER_CSV_CUSTOMER_HEADER_LABELS[columnKey];
  if (mapped) return mapped;
  return columnKey
    .split("_")
    .filter(Boolean)
    .map((part, index) => (index === 0 ? titleFirstWord(part) : part.toLowerCase()))
    .join(" ");
}

export function packageHasMeaningfulColumn(
  rows: Array<Record<string, string>>,
  columnKey: string
): boolean {
  return rows.some((row) => (row[columnKey] ?? "").trim().length > 0);
}

/**
 * Internal column keys for a newly generated customer-facing package.
 * ZIP and Coverage Amount are omitted only when the entire package is blank.
 * Other customer-useful fields stay even when blank so populated data is
 * never silently dropped on a later row.
 */
export function buyerCsvCustomerColumnKeysForPackage(
  rows: Array<Record<string, string>>,
  nicheKey: string
): string[] {
  const includeZip = packageHasMeaningfulColumn(rows, "zip");
  const includeCoverage = packageHasMeaningfulColumn(rows, "coverage_amount");
  return [
    ...BUYER_CSV_CUSTOMER_PREFIX_COLUMNS,
    ...(includeZip ? (["zip"] as const) : []),
    "age",
    "beneficiary",
    ...(includeCoverage ? (["coverage_amount"] as const) : []),
    ...nicheSpecificV3ColumnsFor(nicheKey),
  ];
}

export function presentBuyerCsvCustomerCell(
  columnKey: string,
  row: Record<string, string>,
  nicheKey: string
): string {
  if (columnKey === "niche") {
    return buyerCsvNicheDisplayName(row.niche || nicheKey);
  }
  return row[columnKey] ?? "";
}

export function serializeBuyerCsvCustomerPresentation(
  rows: Array<Record<string, string>>,
  nicheKey: string,
  columnKeys: readonly string[] = buyerCsvCustomerColumnKeysForPackage(rows, nicheKey)
): string {
  const headers = columnKeys.map((key) => buyerCsvCustomerHeaderLabel(key));
  const allowed = new Set(Object.values(BUYER_CSV_CUSTOMER_HEADER_LABELS));
  for (const header of headers) {
    if (!allowed.has(header)) {
      throw new Error(`forbidden_column:${header}`);
    }
  }
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      columnKeys
        .map((key) => csvEscape(presentBuyerCsvCustomerCell(key, row, nicheKey)))
        .join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

export function presentBuyerCsvCustomerPackage(
  rows: Array<Record<string, string>>,
  nicheKey: string
): {
  columnKeys: string[];
  headers: string[];
  csv: string;
} {
  const columnKeys = buyerCsvCustomerColumnKeysForPackage(rows, nicheKey);
  const headers = columnKeys.map((key) => buyerCsvCustomerHeaderLabel(key));
  const csv = serializeBuyerCsvCustomerPresentation(rows, nicheKey, columnKeys);
  return { columnKeys, headers, csv };
}
