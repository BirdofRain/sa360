import type {
  LegacyPrefillSuggestion,
  RoutingDryRunDecisionItem,
  RoutingValidationSuggestion,
} from "./types";

export const defaultRoutingValidationSuggestion: RoutingValidationSuggestion = {
  suggestedValidationStatus: "legacy_unknown",
  suggestedValidationReason: "No legacy delivery fields recorded yet.",
  suggestionConfidence: "medium",
};

export const emptyLegacyPrefillSuggestion: LegacyPrefillSuggestion = {
  legacyDeliveredClientAccountId: null,
  legacyDeliveredSubaccountIdGhl: null,
  legacyDeliveryContactIdGhl: null,
  legacyDeliveryStatus: null,
  prefillReason: null,
  prefillConfidence: null,
};

export function routingDryRunDecisionFixture(
  partial: Partial<RoutingDryRunDecisionItem>
): RoutingDryRunDecisionItem {
  return {
    id: "d1",
    createdAt: "2026-05-19T12:00:00.000Z",
    sourceEventUuid: null,
    sourceLeadUid: "lead_1",
    matched: true,
    confidence: "high",
    matchType: null,
    matchedRuleId: null,
    matchedRuleSummary: null,
    destinationClientAccountId: null,
    destinationSubaccountIdGhl: null,
    reason: "",
    deliveryMode: "dry_run",
    routingEventNameInternal: "lead_matched",
    attributionSnapshot: null,
    lifecycleEventsEmitted: [],
    leadIdentity: null,
    masterClientAccountId: "master_1",
    deliveryPlanSummary: null,
    legacyDeliveredClientAccountId: null,
    legacyDeliveredSubaccountIdGhl: null,
    legacyDeliveryContactIdGhl: null,
    legacyDeliveryStatus: null,
    validationStatus: null,
    validationNotes: null,
    validatedAt: null,
    validatedBy: null,
    suggestedValidation: defaultRoutingValidationSuggestion,
    suggestedLegacyPrefill: emptyLegacyPrefillSuggestion,
    deliveryReadiness: null,
    duplicateRisk: null,
    ...partial,
  };
}
