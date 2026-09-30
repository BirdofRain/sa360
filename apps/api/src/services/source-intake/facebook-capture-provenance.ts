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

/** Settled Zapier captures are complete. Direct Meta must not overwrite them or queue Graph fetch. */
export function isSettledZapierFacebookCapture(
  event: { enrichmentMetadataJson?: unknown } | null | undefined
): boolean {
  const meta = asRecord(event?.enrichmentMetadataJson);
  return (
    meta?.intakeMethod === ZAPIER_FACEBOOK_INTAKE_METHOD &&
    meta?.captureOnly === true &&
    meta?.captureSettled === true
  );
}

export { ZAPIER_FACEBOOK_INTAKE_METHOD };
