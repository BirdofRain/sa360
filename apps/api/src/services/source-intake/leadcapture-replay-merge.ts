/**
 * Capture-only → normalize replay merge.
 *
 * Latest resend payload may add optional questionnaire / proof / metadata.
 * Original persisted immutable source identity and generation time win.
 * If the original event had no authoritative submitted_at, a later resend
 * timestamp must not be substituted.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const ORIGINAL_IDENTITY_OVERRIDE_KEYS = [
  "sa360_route_key",
  "sa360_source_system",
  "sa360_source_platform",
  "sa360_source_type",
  "campaign_id",
] as const;

function readOriginalLeadId(
  original: Record<string, unknown>,
  originalSourceLeadId?: string | null
): string | undefined {
  const answers = asRecord(original.answers);
  return (
    trimOrUndefined(original.lead_id) ??
    trimOrUndefined(answers?.lead_id) ??
    trimOrUndefined(originalSourceLeadId)
  );
}

/** NextGen authoritative time is explicit submitted_at only — never date/time synthesis. */
export function readOriginalAuthoritativeSubmittedAt(
  originalRawPayload: unknown
): string | undefined {
  const original = asRecord(originalRawPayload);
  if (!original) return undefined;
  const answers = asRecord(original.answers);
  return trimOrUndefined(original.submitted_at) ?? trimOrUndefined(answers?.submitted_at);
}

function stripSubmittedAt(payload: Record<string, unknown>): Record<string, unknown> {
  const next = { ...payload };
  delete next.submitted_at;
  const answers = asRecord(next.answers);
  if (answers && "submitted_at" in answers) {
    const { submitted_at: _dropped, ...rest } = answers;
    next.answers = rest;
  }
  return next;
}

export function mergeLeadCaptureReplayNormalizationInput(input: {
  latestPayload: Record<string, unknown>;
  originalRawPayload: unknown;
  originalSourceLeadId?: string | null;
  originalSourceRouteKey?: string | null;
}): Record<string, unknown> {
  const original = asRecord(input.originalRawPayload);
  const originalSubmittedAt = readOriginalAuthoritativeSubmittedAt(input.originalRawPayload);

  if (!original || !originalSubmittedAt) {
    const failClosed = stripSubmittedAt({ ...input.latestPayload });
    if (original) {
      const originalLeadId = readOriginalLeadId(original, input.originalSourceLeadId);
      if (originalLeadId) failClosed.lead_id = originalLeadId;
      for (const key of ORIGINAL_IDENTITY_OVERRIDE_KEYS) {
        const value = trimOrUndefined(original[key]);
        if (value) failClosed[key] = value;
      }
      const originalRouteKey = trimOrUndefined(input.originalSourceRouteKey);
      if (originalRouteKey) failClosed.sa360_route_key = originalRouteKey;
    }
    return failClosed;
  }

  const merged: Record<string, unknown> = { ...input.latestPayload };
  const originalLeadId = readOriginalLeadId(original, input.originalSourceLeadId);
  if (originalLeadId) merged.lead_id = originalLeadId;

  merged.submitted_at = originalSubmittedAt;
  const latestAnswers = asRecord(merged.answers);
  if (latestAnswers && "submitted_at" in latestAnswers) {
    merged.answers = { ...latestAnswers, submitted_at: originalSubmittedAt };
  }

  for (const key of ORIGINAL_IDENTITY_OVERRIDE_KEYS) {
    const value = trimOrUndefined(original[key]);
    if (value) merged[key] = value;
  }
  const originalRouteKey =
    trimOrUndefined(original.sa360_route_key) ?? trimOrUndefined(input.originalSourceRouteKey);
  if (originalRouteKey) merged.sa360_route_key = originalRouteKey;

  return merged;
}
