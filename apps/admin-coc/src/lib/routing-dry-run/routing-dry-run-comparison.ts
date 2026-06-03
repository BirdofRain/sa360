import type { RoutingDryRunDecisionItem } from "./types.ts";
import { displayLeadLabel, parseAttributionSnapshot } from "./routing-dry-run-display.ts";
import { deliveryPlanSummaryLabel } from "./delivery-plan-display.ts";
import {
  effectiveValidationStatus,
  sa360PredictedClientLabel,
  sa360PredictedSubaccount,
  validationStatusLabel,
} from "./routing-dry-run-validation-display.ts";

function line(label: string, value: string): string {
  return `${label}: ${value}`;
}

function dash(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return value;
}

/** Plain-text summary for operator clipboard / Slack. */
export function buildRoutingComparisonSummary(row: RoutingDryRunDecisionItem): string {
  const attr = parseAttributionSnapshot(row.attributionSnapshot);
  const status = effectiveValidationStatus(row.validationStatus);

  return [
    line("Lead", `${displayLeadLabel(row)} (${row.sourceLeadUid})`),
    line("Campaign", `${dash(attr?.campaignName)} (${dash(attr?.campaignId)})`),
    line("SA360 predicted client", sa360PredictedClientLabel(row)),
    line("SA360 predicted subaccount", sa360PredictedSubaccount(row)),
    line("SA360 shadow delivery plan", deliveryPlanSummaryLabel(row.deliveryPlanSummary)),
    line(
      "Suggested validation",
      `${validationStatusLabel(row.suggestedValidation?.suggestedValidationStatus)} (${row.suggestedValidation?.suggestionConfidence ?? "—"})`
    ),
    line("Suggestion reason", dash(row.suggestedValidation?.suggestedValidationReason)),
    line("Legacy delivered client", dash(row.legacyDeliveredClientAccountId)),
    line("Legacy delivered subaccount", dash(row.legacyDeliveredSubaccountIdGhl)),
    line("Legacy delivery contact (GHL)", dash(row.legacyDeliveryContactIdGhl)),
    line("Legacy delivery status", dash(row.legacyDeliveryStatus)),
    line("Validation status", validationStatusLabel(status)),
    line("Notes", dash(row.validationNotes)),
  ].join("\n");
}
