/**
 * Locale-aware master-sheet date parsing for Vet/Trucker CSV exports.
 * Prefer ISO date output (UTC noon) for canonical inventory generatedAt.
 */

export type ParsedMasterDate =
  | { ok: true; value: Date; format: string; isoDate: string }
  | { ok: false; code: "generated_at_missing" | "generated_at_invalid" | "future_generated_at" };

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
  if (year < 1990 || year > 2100) return null;
  return d;
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
