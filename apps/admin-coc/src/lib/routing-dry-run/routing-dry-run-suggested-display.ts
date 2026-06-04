import type { RoutingValidationSuggestion } from "./types.ts";
import { defaultRoutingValidationSuggestion } from "./routing-dry-run-suggestion-fixture.ts";
import { validationStatusBadgeClass, validationStatusLabel } from "./routing-dry-run-validation-display.ts";

function resolveSuggestion(
  suggestion: RoutingValidationSuggestion | undefined
): RoutingValidationSuggestion {
  return suggestion ?? defaultRoutingValidationSuggestion;
}

export function suggestedValidationLabel(suggestion: RoutingValidationSuggestion | undefined): string {
  const s = resolveSuggestion(suggestion);
  return `Suggested: ${validationStatusLabel(s.suggestedValidationStatus)}`;
}

export function suggestedValidationBadgeClass(
  suggestion: RoutingValidationSuggestion | undefined
): string {
  return validationStatusBadgeClass(resolveSuggestion(suggestion).suggestedValidationStatus);
}

export function suggestionConfidenceLabel(confidence: RoutingValidationSuggestion["suggestionConfidence"]): string {
  switch (confidence) {
    case "high":
      return "High confidence";
    case "medium":
      return "Medium confidence";
    case "low":
      return "Low confidence";
    default:
      return confidence;
  }
}

export function suggestionAlignsWithOperatorStatus(
  operatorStatus: string | null | undefined,
  suggestion: RoutingValidationSuggestion | undefined
): boolean {
  const op = operatorStatus?.trim() || "unreviewed";
  return op === resolveSuggestion(suggestion).suggestedValidationStatus;
}
