/**
 * Historical Master DOB/AGE parser — local to aged-bulk only.
 * Do not reuse parseMasterGeneratedAt (lead-date rules are unrelated).
 * Do not place this in source-intake.
 *
 * LeadInventoryItem.generatedAt = AGE OF THE LEAD (untouched here).
 * lead_details.consumer_age = AGE OF THE PERSON.
 */

export type ConsumerAgeParseStatus =
  | "empty"
  | "age_integer"
  | "dob_recognized"
  | "excel_serial"
  | "invalid"
  | "ambiguous";

export type ParsedConsumerAge = {
  consumerAge: number | null;
  dateOfBirth: string | null;
  status: ConsumerAgeParseStatus;
  raw: string;
};

const MIN_PLAUSIBLE_AGE = 18;
const MAX_PLAUSIBLE_AGE = 120;

/** Excel 1900 date system: serial 0 ≡ 1899-12-30. Serial 28988 ≡ 1979-05-13. */
const EXCEL_1900_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;
const MIN_EXCEL_SERIAL = 2000;
const MAX_EXCEL_SERIAL = 80_000;

function emptyResult(raw: string, status: ConsumerAgeParseStatus = "empty"): ParsedConsumerAge {
  return { consumerAge: null, dateOfBirth: null, status, raw };
}

function utcYmd(date: Date): { year: number; month: number; day: number } {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function isoDateUtc(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Completed whole years as of evaluatedAt: the last birthday actually reached.
 * Uses UTC calendar date of evaluatedAt.
 */
export function completedWholeYearsAsOf(dateOfBirthIso: string, evaluatedAt: Date): number | null {
  const parts = dateOfBirthIso.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (!year || !month || !day) return null;
  const now = utcYmd(evaluatedAt);
  let age = now.year - year;
  const birthdayReached = now.month > month || (now.month === month && now.day >= day);
  if (!birthdayReached) age -= 1;
  if (age < 0 || age > 150) return null;
  return age;
}

function fromRecognizedDob(
  iso: string,
  evaluatedAt: Date,
  status: ConsumerAgeParseStatus,
  raw: string
): ParsedConsumerAge {
  const consumerAge = completedWholeYearsAsOf(iso, evaluatedAt);
  if (consumerAge == null) {
    return { consumerAge: null, dateOfBirth: null, status: "invalid", raw };
  }
  return { consumerAge, dateOfBirth: iso, status, raw };
}

function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isInteger(serial) || serial < MIN_EXCEL_SERIAL || serial > MAX_EXCEL_SERIAL) {
    return null;
  }
  const d = new Date(EXCEL_1900_EPOCH_UTC_MS + serial * MS_PER_DAY);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseWholeNumber(trimmed: string): number | null {
  if (/^\d{1,5}$/.test(trimmed)) return Number(trimmed);
  if (/^\d{1,5}\.0+$/.test(trimmed)) return Number(trimmed.slice(0, trimmed.indexOf(".")));
  return null;
}

/**
 * Parse Master DOB/AGE / AGE cells.
 * - Plausible integer age 18–120 → consumer_age only (never invent birthday).
 * - Recognized DOB → ISO date_of_birth + completed whole-year age.
 * - Excel 1900 serial (e.g. 28988) → 1979-05-13 then completed years.
 * - Invalid/ambiguous → retain raw + status; invent nothing.
 */
export function parseHistoricalConsumerAge(
  raw: string | null | undefined,
  evaluatedAt: Date
): ParsedConsumerAge {
  const original = raw ?? "";
  const trimmed = original.trim();
  if (!trimmed) return emptyResult(original, "empty");

  const whole = parseWholeNumber(trimmed);
  if (whole != null && whole >= MIN_PLAUSIBLE_AGE && whole <= MAX_PLAUSIBLE_AGE) {
    return {
      consumerAge: whole,
      dateOfBirth: null,
      status: "age_integer",
      raw: original,
    };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map(Number);
    const iso = isoDateUtc(y!, m!, d!);
    if (!iso) return emptyResult(original, "invalid");
    return fromRecognizedDob(iso, evaluatedAt, "dob_recognized", original);
  }

  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    const year = Number(mdy[3]);
    const iso = isoDateUtc(year, month, day);
    if (!iso) return emptyResult(original, "invalid");
    return fromRecognizedDob(iso, evaluatedAt, "dob_recognized", original);
  }

  if (whole != null) {
    const iso = excelSerialToIsoDate(whole);
    if (iso) {
      const parsed = fromRecognizedDob(iso, evaluatedAt, "excel_serial", original);
      if (parsed.status === "excel_serial") return parsed;
    }
    return emptyResult(original, "ambiguous");
  }

  return emptyResult(original, "invalid");
}

export function isInvalidConsumerAgeStatus(status: ConsumerAgeParseStatus): boolean {
  return status === "invalid" || status === "ambiguous";
}
