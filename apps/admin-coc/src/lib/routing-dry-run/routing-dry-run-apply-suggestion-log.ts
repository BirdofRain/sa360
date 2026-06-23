import "server-only";

export type ApplySuggestionActionLogPayload = {
  decisionId: string;
  matched: boolean;
  matchedRuleId: string | null;
  suggestedValidationStatus: string | null;
  routingEventNameInternal: string;
  destinationClientAccountId: string | null;
  destinationSubaccountIdGhl: string | null;
  resultCode: string;
  error?: string;
};

const LOG_PREFIX = "[routing-dry-run-apply-suggestion]";

/** Admin-safe diagnostics for apply-suggestion server action (no secrets). */
export function logApplySuggestionAction(payload: ApplySuggestionActionLogPayload): void {
  console.error(
    LOG_PREFIX,
    JSON.stringify({
      decisionId: payload.decisionId,
      matched: payload.matched,
      matchedRuleId: payload.matchedRuleId,
      suggestedValidationStatus: payload.suggestedValidationStatus,
      routingEventNameInternal: payload.routingEventNameInternal,
      destinationClientAccountId: payload.destinationClientAccountId,
      destinationSubaccountIdGhl: payload.destinationSubaccountIdGhl,
      resultCode: payload.resultCode,
      error: payload.error?.slice(0, 300),
    })
  );
}
