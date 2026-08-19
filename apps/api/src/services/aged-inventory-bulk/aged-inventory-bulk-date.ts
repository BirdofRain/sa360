/**
 * Locale-aware master-sheet date parsing for Vet/Trucker CSV exports.
 * Prefer ISO date output (UTC noon) for canonical inventory generatedAt.
 *
 * Excel 1900 serials are parsed locally here (not source-intake). Integer
 * serials use the same UTC-noon date-only contract as ISO/MDY strings.
 * Fractional serials keep the time-of-day. Epoch 1899-12-30.
 */

export type ParsedMasterDate =
  | { ok: true; value: Date; format: string; isoDate: string }
  | { ok: false; code: "generated_at_missing" | "generated_at_invalid" | "future_generated_at" };

const MIN_GENERATED_YEAR = 1990;
const MAX_GENERATED_YEAR = 2100;
/** Excel 1900 date system: serial 0 ≡ 1899-12-30. Serial 46224 ≡ 2026-07-21. */
const EXCEL_1900_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;
const FUTURE_SLACK_MS = 5 * 60 * 1000;

function utcNoon(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  if (year < MIN_GENERATED_YEAR || year > MAX_GENERATED_YEAR) return null;
  return d;
}

function rejectIfFuture(result: ParsedMasterDate, evaluatedAt: Date): ParsedMasterDate {
  if (!result.ok) return result;
  if (result.value.getTime() > evaluatedAt.getTime() + FUTURE_SLACK_MS) {
    return { ok: false, code: "future_generated_at" };
  }
  return result;
}

function fromExcelSerial(serial: number, evaluatedAt: Date): ParsedMasterDate {
  if (!Number.isFinite(serial) || serial < 0) {
    return { ok: false, code: "generated_at_invalid" };
  }
  const wholeDays = Math.floor(serial);
  const fractionMs = Math.round((serial - wholeDays) * MS_PER_DAY);
  const instant = new Date(EXCEL_1900_EPOCH_UTC_MS + wholeDays * MS_PER_DAY + fractionMs);
  if (Number.isNaN(instant.getTime())) return { ok: false, code: "generated_at_invalid" };

  const year = instant.getUTCFullYear();
  const month = instant.getUTCMonth() + 1;
  const day = instant.getUTCDate();
  if (year < MIN_GENERATED_YEAR || year > MAX_GENERATED_YEAR) {
    return { ok: false, code: "generated_at_invalid" };
  }

  const hasFraction = !Number.isInteger(serial);
  if (!hasFraction) {
    const noon = utcNoon(year, month, day);
    if (!noon) return { ok: false, code: "generated_at_invalid" };
    return rejectIfFuture(
      { ok: true, value: noon, format: "excel_serial", isoDate: noon.toISOString().slice(0, 10) },
      evaluatedAt
    );
  }

  return rejectIfFuture(
    {
      ok: true,
      value: instant,
      format: "excel_serial_fractional",
      isoDate: instant.toISOString().slice(0, 10),
    },
    evaluatedAt
  );
}

function fromDate(d: Date, format: string): ParsedMasterDate {
  if (Number.isNaN(d.getTime())) return { ok: false, code: "generated_at_invalid" };
  const isoDate = d.toISOString().slice(0, 10);
  const [y, m, day] = isoDate.split("-").map(Number);
  const noon = utcNoon(y!, m!, day!);
  if (!noon) return { ok: false, code: "generated_at_invalid" };
  return { ok: true, value: noon, format, isoDate };
}

export function parseMasterGeneratedAt(
  raw: string | null | undefined,
  evaluatedAt: Date = new Date()
): ParsedMasterDate {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: false, code: "generated_at_missing" };

  // ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map(Number);
    const noon = utcNoon(y!, m!, d!);
    if (!noon) return { ok: false, code: "generated_at_invalid" };
    if (noon.getTime() > evaluatedAt.getTime() + 5 * 60 * 1000) {
      return { ok: false, code: "future_generated_at" };
    }
    return { ok: true, value: noon, format: "iso_date", isoDate: trimmed };
  }

  // ISO datetime
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(trimmed)) {
    const parsed = new Date(trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T"));
    const result = fromDate(parsed, "iso_datetime");
    if (!result.ok) return result;
    if (result.value.getTime() > evaluatedAt.getTime() + 5 * 60 * 1000) {
      return { ok: false, code: "future_generated_at" };
    }
    return result;
  }

  // M/D/YYYY with optional time + AM/PM (Vet master dominant shape)
  const mdyTime = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i
  );
  if (mdyTime) {
    const month = Number(mdyTime[1]);
    const day = Number(mdyTime[2]);
    const year = Number(mdyTime[3]);
    const noon = utcNoon(year, month, day);
    if (!noon) return { ok: false, code: "generated_at_invalid" };
    if (noon.getTime() > evaluatedAt.getTime() + 5 * 60 * 1000) {
      return { ok: false, code: "future_generated_at" };
    }
    return { ok: true, value: noon, format: "mdy_datetime_ampm", isoDate: noon.toISOString().slice(0, 10) };
  }

  // Mon D, YYYY [time]
  const mon = trimmed.match(
    /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/i
  );
  if (mon) {
    const parsed = new Date(trimmed);
    const result = fromDate(parsed, "mon_d_yyyy");
    if (!result.ok) return result;
    if (result.value.getTime() > evaluatedAt.getTime() + 5 * 60 * 1000) {
      return { ok: false, code: "future_generated_at" };
    }
    return result;
  }

  // Excel 1900-system serial (integer or fractional day). Must not run through
  // Date() locale parsing — numeric strings are serials, not JS timestamps.
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return fromExcelSerial(Number(trimmed), evaluatedAt);
  }

  // Locale datetime fallback (trucker sheets often export this)
  const loose = new Date(trimmed);
  if (!Number.isNaN(loose.getTime())) {
    const result = fromDate(loose, "locale_datetime");
    if (!result.ok) return result;
    if (result.value.getTime() > evaluatedAt.getTime() + 5 * 60 * 1000) {
      return { ok: false, code: "future_generated_at" };
    }
    return result;
  }

  return { ok: false, code: "generated_at_invalid" };
}
