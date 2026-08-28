/**
 * Safe Content-Disposition for CSV downloads.
 * Never interpolates raw user/path input into the header.
 */

const UNSAFE = /[^\w.\-]+/g;
const MAX_FILENAME_LENGTH = 180;

export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

export function safeCsvDownloadFilename(filename: string, fallback = "delivery.csv"): string {
  const trimmed = filename.trim();
  const cleaned = trimmed
    .replace(UNSAFE, "_")
    .replace(/^\.+/, "")
    .replace(/_+/g, "_")
    .slice(0, MAX_FILENAME_LENGTH);
  const base = cleaned || fallback;
  return base.toLowerCase().endsWith(".csv") ? base : `${base}.csv`;
}

export function csvAttachmentContentDisposition(filename: string): string {
  const safe = safeCsvDownloadFilename(filename);
  return `attachment; filename="${safe}"`;
}
