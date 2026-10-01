/**
 * Capture and association writes are off unless this is exactly "true".
 *
 * Production rollout is blocked until the client-lifecycle follow-up lands.
 * #152 is merged and still does not migrate the SourceFunnel references or
 * the current association snapshots below. This slice leaves that follow-up
 * explicit. Enabling the flag before it lands can leave a Facebook form
 * association pointing at a rekeyed or deleted client.
 *
 * Relational references the follow-up must migrate on rekey:
 * - SourceFunnel.originClientAccountId
 * - SourceFunnel.suggestedClientAccountId
 * - SourceLeadEvent.clientAccountIdResolved is already in CLIENT_IDENTITY_REFERENCE_UPDATES
 *
 * Current JSON snapshots the follow-up must migrate, without rewriting history:
 * - enrichmentMetadataJson.association.clientAccountId
 * - normalizedPayloadJson.association.client_account_id
 *
 * Historical audit identities that must stay as originally recorded:
 * - enrichmentMetadataJson.associationAudit[].previous.clientAccountIdResolved
 * - enrichmentMetadataJson.associationAudit[].next.clientAccountId
 * - enrichmentMetadataJson.associationAudit[].previous.associationOutcome
 *
 * Deletion impact must count SourceFunnel rows for originClientAccountId and
 * suggestedClientAccountId before a client delete. A row that references the
 * same client in both fields is one dual reference: count it in both tallies
 * and surface it once, so it is neither dropped nor treated as two blockers.
 * The schema uses onDelete SetNull, so a delete that is not counted first
 * clears the live association.
 */

export const FACEBOOK_CAPTURE_INTAKE_ENABLED_ENV = "SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED";

export class FacebookCaptureIntakeDisabledError extends Error {
  readonly code = "capture_intake_disabled" as const;
  readonly httpStatus = 503;

  constructor() {
    super(
      `${FACEBOOK_CAPTURE_INTAKE_ENABLED_ENV} is not true. Facebook capture and association writes are off until client rekey and deletion count SourceFunnel ownership and current association snapshots.`
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
