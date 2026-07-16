/** RFC 4122 UUID shape (versions 1–5, variant 10xx). */
const LEADCAPTURE_UUID_LEAD_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Legacy LeadCapture lead IDs are positive integer strings. */
const LEADCAPTURE_NUMERIC_LEAD_ID_RE = /^\d+$/;

export function isLeadCaptureUuidLeadId(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && LEADCAPTURE_UUID_LEAD_ID_RE.test(trimmed);
}

export function isLeadCaptureNumericLeadId(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && LEADCAPTURE_NUMERIC_LEAD_ID_RE.test(trimmed);
}

/**
 * NextGen Data API trust may attach only when webhook sourceLeadId and
 * Data API `_meta.lead_id` are the identical UUID string.
 */
export function isLeadCaptureNextGenExactJoin(
  sourceLeadId: string | null | undefined,
  providerLeadId: string | null | undefined
): boolean {
  const source = typeof sourceLeadId === "string" ? sourceLeadId.trim() : "";
  const provider = typeof providerLeadId === "string" ? providerLeadId.trim() : "";
  if (!source || !provider) return false;
  if (!isLeadCaptureUuidLeadId(source) || !isLeadCaptureUuidLeadId(provider)) return false;
  return source === provider;
}
