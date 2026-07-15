import type { AgedInventoryDateFormat } from "./aged-inventory-import.types.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;
const MDY_SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

export type ParsedGeneratedAt =
  | { ok: true; value: Date; format: string }
  | { ok: false; code: "generated_at_missing" | "generated_at_invalid" | "generated_at_ambiguous" };

export function parseGeneratedAt(
  raw: string | null | undefined,
  dateFormat?: AgedInventoryDateFormat
): ParsedGeneratedAt {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: false, code: "generated_at_missing" };

  if (ISO_DATE.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map(Number);
    const utc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0, 0));
    if (Number.isNaN(utc.getTime())) return { ok: false, code: "generated_at_invalid" };
    return { ok: true, value: utc, format: "iso_date" };
  }

  if (ISO_DATETIME.test(trimmed)) {
    const parsed = new Date(trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T"));
    if (Number.isNaN(parsed.getTime())) return { ok: false, code: "generated_at_invalid" };
    return { ok: true, value: new Date(parsed.toISOString()), format: "iso_datetime" };
  }

  if (dateFormat === "mdy_slash") {
    const match = MDY_SLASH.exec(trimmed);
    if (!match) return { ok: false, code: "generated_at_invalid" };
    const month = Number(match[1]);
    const day = Number(match[2]);
    const year = Number(match[3]);
    const utc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
    if (Number.isNaN(utc.getTime()) || utc.getUTCFullYear() !== year) {
      return { ok: false, code: "generated_at_invalid" };
    }
    return { ok: true, value: utc, format: "mdy_slash" };
  }

  if (MDY_SLASH.test(trimmed)) {
    return { ok: false, code: "generated_at_ambiguous" };
  }

  return { ok: false, code: "generated_at_invalid" };
}

export function isFutureGeneratedAt(generatedAt: Date, evaluatedAt: Date): boolean {
  return generatedAt.getTime() > evaluatedAt.getTime() + 5 * 60 * 1000;
}
