/** Operator validation statuses for dry-run vs legacy delivery comparison. */
export const ROUTING_VALIDATION_STATUSES = [
  "unreviewed",
  "matched_legacy",
  "mismatch",
  "needs_mapping",
  "ignored_test",
  "legacy_unknown",
] as const;

export type RoutingValidationStatus = (typeof ROUTING_VALIDATION_STATUSES)[number];

export function isRoutingValidationStatus(value: string): value is RoutingValidationStatus {
  return (ROUTING_VALIDATION_STATUSES as readonly string[]).includes(value);
}
