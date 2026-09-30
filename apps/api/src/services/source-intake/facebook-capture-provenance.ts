/**
 * Provenance for capture-only Zapier Facebook intake.
 *
 * Canonical lead identity stays (facebook, meta_lead_ads, leadgen_id), the same
 * key direct Meta uses. Intake method is stored separately so a Zapier delivery
 * and a later Meta webhook recognize one logical lead without rewriting history.
 */

const ZAPIER_FACEBOOK_INTAKE_METHOD = "zapier_facebook";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Capture-only rows are finished for Meta Graph and routing.
 * This includes a Zapier-created row and a raw Meta row that Zapier later
 * completed. The original intake method is not required, so a Meta-first
 * supplement can stay provenance-meta and still stop Graph from replacing it.
 */
export function isSettledCaptureOnlyFacebookEvent(
  event: { enrichmentMetadataJson?: unknown } | null | undefined
): boolean {
  const meta = asRecord(event?.enrichmentMetadataJson);
  return meta?.captureOnly === true && meta?.captureSettled === true;
}

/** Settled capture that was created by Zapier, not a later supplement of a Meta row. */
export function isSettledZapierFacebookCapture(
  event: { enrichmentMetadataJson?: unknown } | null | undefined
): boolean {
  const meta = asRecord(event?.enrichmentMetadataJson);
  return (
    isSettledCaptureOnlyFacebookEvent(event) &&
    meta?.intakeMethod === ZAPIER_FACEBOOK_INTAKE_METHOD
  );
}

export { ZAPIER_FACEBOOK_INTAKE_METHOD };
