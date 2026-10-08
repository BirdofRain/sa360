type SourceLeadRoutingPresentationInput = {
  routingResultJson: unknown;
  routingRuleIdResolved: string | null;
  clientAccountIdResolved: string | null;
};

export type SourceLeadRoutingPresentation = {
  matched: boolean;
  routingAuthority: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * Present persisted routing without assuming every match came from a campaign rule.
 *
 * Explicit routing output is authoritative, but a match is only usable when its
 * persisted destination is present. Historical rows without an explicit routing
 * result retain the rule + destination compatibility fallback.
 */
export function presentSourceLeadRouting(
  input: SourceLeadRoutingPresentationInput
): SourceLeadRoutingPresentation {
  const routingResult = asRecord(input.routingResultJson);
  const explicitMatched = routingResult?.matched;
  const hasDestination = Boolean(nonEmptyString(input.clientAccountIdResolved));

  const matched =
    explicitMatched === true
      ? hasDestination
      : explicitMatched === false
        ? false
        : Boolean(nonEmptyString(input.routingRuleIdResolved) && hasDestination);

  return {
    matched,
    routingAuthority: nonEmptyString(routingResult?.routingAuthority),
  };
}
