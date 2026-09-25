const UTC_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

/** Explicit UTC display plus the authoritative ISO-8601 instant. */
export function formatDiagnosticTimestamp(iso: string | null | undefined): {
  display: string;
  utc: string;
} {
  if (!iso) return { display: "—", utc: "" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { display: iso, utc: iso };
  return {
    display: UTC_FORMAT.format(date),
    utc: date.toISOString(),
  };
}
