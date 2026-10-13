/**
 * RFC4180 CSV parse + explicit header mapping for FOWB Stage 2f.
 * Header rows are never treated as deliveries. Quoted commas stay in-cell.
 */

export type ExternalReceiptCsvRow = {
  rowNumber: number;
  phone?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  rejectedBeforeDelivery?: boolean;
  malformed?: boolean;
};

const PHONE_HEADERS = new Set(["phone", "phone number", "mobile", "cell", "telephone"]);
const EMAIL_HEADERS = new Set(["email", "e-mail", "email address"]);
const FIRST_HEADERS = new Set(["first name", "firstname", "first", "fname"]);
const LAST_HEADERS = new Set(["last name", "lastname", "last", "lname"]);
const REJECTED_HEADERS = new Set([
  "rejected_before_delivery",
  "rejected before delivery",
  "rejected",
]);

function parseRfc4180(csvContent: string): string[][] {
  const records: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let started = false;

  const endRecord = () => {
    cells.push(cell);
    records.push(cells);
    cells = [];
    cell = "";
    started = false;
  };

  for (let i = 0; i < csvContent.length; i += 1) {
    const char = csvContent[i];
    if (quoted) {
      if (char === '"') {
        if (csvContent[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      started = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
      started = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && csvContent[i + 1] === "\n") i += 1;
      if (started || cell.length > 0) endRecord();
    } else {
      cell += char;
      started = true;
    }
  }
  if (started || cell.length > 0) endRecord();
  return records;
}

function headerKey(cell: string): string {
  return cell.trim().toLowerCase().replace(/[_-]+/g, " ");
}

export function mapExternalReceiptHeaders(header: readonly string[]): {
  phone: number;
  email: number;
  firstName: number;
  lastName: number;
  rejectedBeforeDelivery: number;
} {
  const mapped = {
    phone: -1,
    email: -1,
    firstName: -1,
    lastName: -1,
    rejectedBeforeDelivery: -1,
  };
  header.forEach((cell, index) => {
    const key = headerKey(cell);
    if (mapped.phone < 0 && PHONE_HEADERS.has(key)) mapped.phone = index;
    else if (mapped.email < 0 && EMAIL_HEADERS.has(key)) mapped.email = index;
    else if (mapped.firstName < 0 && FIRST_HEADERS.has(key)) mapped.firstName = index;
    else if (mapped.lastName < 0 && LAST_HEADERS.has(key)) mapped.lastName = index;
    else if (mapped.rejectedBeforeDelivery < 0 && REJECTED_HEADERS.has(key)) {
      mapped.rejectedBeforeDelivery = index;
    }
  });
  return mapped;
}

export function isExternalReceiptHeaderRow(cells: readonly string[]): boolean {
  const mapped = mapExternalReceiptHeaders(cells);
  return mapped.phone >= 0 || mapped.email >= 0;
}

function truthy(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

/**
 * Parse a receipt spreadsheet. The first row is a header when it maps to
 * phone/email columns — that extra occupied-looking row is not a delivery.
 */
export function parseExternalReceiptCsv(text: string): ExternalReceiptCsvRow[] {
  const records = parseRfc4180(text);
  if (records.length === 0) return [];
  const first = records[0]!;
  const hasHeader = isExternalReceiptHeaderRow(first);
  const mapping = hasHeader
    ? mapExternalReceiptHeaders(first)
    : { phone: 0, email: 1, firstName: 2, lastName: 3, rejectedBeforeDelivery: 4 };
  const data = hasHeader ? records.slice(1) : records;
  return data.map((record, index) => {
    const phone = (mapping.phone >= 0 ? record[mapping.phone] : "")?.trim() ?? "";
    const email = (mapping.email >= 0 ? record[mapping.email] : "")?.trim() ?? "";
    const firstName = (mapping.firstName >= 0 ? record[mapping.firstName] : "")?.trim() ?? "";
    const lastName = (mapping.lastName >= 0 ? record[mapping.lastName] : "")?.trim() ?? "";
    const rejected = mapping.rejectedBeforeDelivery >= 0
      ? truthy(record[mapping.rejectedBeforeDelivery])
      : false;
    const malformed = !phone && !email && Boolean(firstName || lastName);
    return {
      rowNumber: index + 1,
      phone: phone || undefined,
      email: email || undefined,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      rejectedBeforeDelivery: rejected || undefined,
      malformed: malformed || undefined,
    };
  });
}
