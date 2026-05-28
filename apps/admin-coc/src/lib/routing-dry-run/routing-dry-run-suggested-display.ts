import type { RoutingValidationSuggestion } from "./types.ts";
import { validationStatusBadgeClass, validationStatusLabel } from "./routing-dry-run-validation-display.ts";

export function suggestedValidationLabel(suggestion: RoutingValidationSuggestion): string {
  return `Suggested: ${validationStatusLabel(suggestion.suggestedValidationStatus)}`;
}

export function suggestedValidationBadgeClass(suggestion: RoutingValidationSuggestion): string {
  return validationStatusBadgeClass(suggestion.suggestedValidationStatus);
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
  suggestion: RoutingValidationSuggestion
): boolean {
  const op = operatorStatus?.trim() || "unreviewed";
  return op === suggestion.suggestedValidationStatus;
}
