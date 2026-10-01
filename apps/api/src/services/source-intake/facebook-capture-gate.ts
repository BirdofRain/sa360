/**
 * Capture and association writes are off unless this is exactly "true".
 *
 * Client rekey migrates SourceFunnel.originClientAccountId,
 * SourceFunnel.suggestedClientAccountId, and the current association snapshots
 * on events whose clientAccountIdResolved is the source client:
 * - enrichmentMetadataJson.association.clientAccountId
 * - normalizedPayloadJson.association.client_account_id
 *
 * Historical associationAudit client ids stay as recorded. Deletion impact
 * counts both SourceFunnel fields, lists a dual-reference row once, and blocks
 * the delete. onDelete SetNull would otherwise clear an uncounted association.
 * A current snapshot that names a client whose clientAccountIdResolved is
 * different also blocks deletion and rekey, so removing the client cannot leave
 * that snapshot behind.
 *
 * The flag stays off until an explicit activation after this code is deployed.
 * Do not set SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED as part of lifecycle work.
 */

export const FACEBOOK_CAPTURE_INTAKE_ENABLED_ENV = "SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED";

export class FacebookCaptureIntakeDisabledError extends Error {
  readonly code = "capture_intake_disabled" as const;
  readonly httpStatus = 503;

  constructor() {
    super(
      `${FACEBOOK_CAPTURE_INTAKE_ENABLED_ENV} is not true. Facebook capture and association writes are off.`
    );
    this.name = "FacebookCaptureIntakeDisabledError";
  }
}

export function isFacebookCaptureIntakeEnabled(): boolean {
  return (process.env[FACEBOOK_CAPTURE_INTAKE_ENABLED_ENV] ?? "").trim().toLowerCase() === "true";
}

export function assertFacebookCaptureIntakeEnabled(): void {
  if (!isFacebookCaptureIntakeEnabled()) {
    throw new FacebookCaptureIntakeDisabledError();
  }
}
