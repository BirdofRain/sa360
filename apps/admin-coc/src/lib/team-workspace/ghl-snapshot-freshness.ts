/**
 * Age of a GoHighLevel location snapshot.
 * A saved field id is current only while this returns "fresh".
 */

export const GHL_CONFIG_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const GHL_CONFIG_SNAPSHOT_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type GhlSnapshotFreshness = "fresh" | "expired" | "future" | "malformed";

export function assessGhlConfigSnapshotFreshness(fetchedAt: unknown, now: Date): GhlSnapshotFreshness {
  const parsed = parseTimestamp(fetchedAt);
  if (!parsed) return "malformed";
  if (now.getTime() - parsed.getTime() > GHL_CONFIG_SNAPSHOT_MAX_AGE_MS) return "expired";
  if (parsed.getTime() - now.getTime() > GHL_CONFIG_SNAPSHOT_FUTURE_SKEW_MS) return "future";
  return "fresh";
}

function parseTimestamp(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}
