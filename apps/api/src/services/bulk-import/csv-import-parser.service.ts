import type { ParsedImportRow } from "./bulk-import.types.js";

export type CsvDelimiter = "," | ";" | "\t";

export type CsvParseResult = {
  headers: string[];
  rows: ParsedImportRow[];
  delimiter: CsvDelimiter;
  encoding: "utf-8";
};

const MAX_ROWS_DEFAULT = 10_000;
const MAX_FIELD_LENGTH = 16_384;

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Detect delimiter from the first non-empty line. */
export function detectCsvDelimiter(line: string): CsvDelimiter {
  const candidates: Array<{ delimiter: CsvDelimiter; count: number }> = [
    { delimiter: ",", count: 0 },
    { delimiter: ";", count: 0 },
    { delimiter: "\t", count: 0 },
  ];
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes) {
      for (const c of candidates) {
        if (ch === c.delimiter) c.count++;
      }
    }
  }
  candidates.sort((a, b) => b.count - a.count);
  return candidates[0]?.count ? candidates[0].delimiter : ",";
}

function parseCsvLine(line: string, delimiter: CsvDelimiter): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields.map((f) => {
    const trimmed = f.trim();
    if (trimmed.length > MAX_FIELD_LENGTH) {
      throw new Error("field_value_too_large");
    }
    return trimmed;
  });
}

function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (current.length > 0) lines.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

export function parseCsvText(
  text: string,
  opts?: { maxRows?: number; hasHeader?: boolean }
): CsvParseResult {
  const maxRows = opts?.maxRows ?? MAX_ROWS_DEFAULT;
  const normalized = stripBom(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  const lines = splitCsvLines(normalized).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [], delimiter: ",", encoding: "utf-8" };
  }

  const delimiter = detectCsvDelimiter(lines[0]!);
  const hasHeader = opts?.hasHeader ?? true;
  const headerFields = parseCsvLine(lines[0]!, delimiter);
  const headers = hasHeader
    ? headerFields.map((h, idx) => (h.length > 0 ? h : `column_${idx + 1}`))
    : headerFields.map((_, idx) => `column_${idx + 1}`);

  const dataLines = hasHeader ? lines.slice(1) : lines;
  if (dataLines.length > maxRows) {
    throw new Error("too_many_rows");
  }

  const rows: ParsedImportRow[] = [];
  for (let i = 0; i < dataLines.length; i++) {
    const values = parseCsvLine(dataLines[i]!, delimiter);
    const fields: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c]!;
      fields[header] = values[c] ?? "";
    }
    for (let c = headers.length; c < values.length; c++) {
      fields[`column_${c + 1}`] = values[c] ?? "";
    }
    rows.push({ rowNumber: i + 1, fields });
  }

  return { headers, rows, delimiter, encoding: "utf-8" };
}

export function sanitizeCsvPreviewRows(rows: ParsedImportRow[], limit = 20): ParsedImportRow[] {
  return rows.slice(0, limit).map((row) => ({
    rowNumber: row.rowNumber,
    fields: Object.fromEntries(
      Object.entries(row.fields).map(([key, value]) => [key, redactPreviewValue(value)])
    ),
  }));
}

function redactPreviewValue(value: string): string {
  if (!value) return value;
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  if (/^\d{7,}$/.test(value.replace(/\D/g, ""))) {
    const digits = value.replace(/\D/g, "");
    return `***${digits.slice(-4)}`;
  }
  return value;
}
