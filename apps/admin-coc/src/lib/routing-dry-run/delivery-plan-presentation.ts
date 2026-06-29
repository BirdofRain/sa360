import { getDeliveryPlanEligibility } from "./routing-dry-run-plan-eligibility.ts";
import type { LeadDeliveryPlanItem, RoutingDryRunDecisionItem } from "./types.ts";

export type DeliveryPlanPresentation = {
  /** A plan already exists (loaded full plan or list summary). */
  planExists: boolean;
  /** "View delivery plan" should be offered (summary exists, full plan not yet loaded). */
  canView: boolean;
  /** Generating/regenerating a plan is allowed (matched + config complete). */
  canGenerate: boolean;
  /** Show the "Delivery plan unavailable" banner — only when no plan exists AND it cannot be generated. */
  showUnavailable: boolean;
  /** Status label source: full plan, else summary, else null. */
  displayStatus: string | null;
  /** Effective delivery mode to display: full plan, else summary, else the decision's mode. */
  deliveryMode: string;
  /** Reason a plan cannot be generated (when not eligible). */
  eligibilityMessage: string | null;
};

/**
 * Single source of truth for delivery-plan rendering state so the drawer and the
 * delivery section stay consistent. An existing plan (`deliveryPlanSummary` from the
 * list, or a freshly loaded/generated `plan`) is always viewable and never reported as
 * "unavailable", regardless of generate-eligibility.
 */
export function getDeliveryPlanPresentation(input: {
  row: Pick<
    RoutingDryRunDecisionItem,
    | "matched"
    | "matchedRuleId"
    | "validationStatus"
    | "deliveryReadiness"
    | "deliveryMode"
    | "deliveryPlanSummary"
  >;
  plan: LeadDeliveryPlanItem | null;
}): DeliveryPlanPresentation {
  const { row, plan } = input;
  const summary = row.deliveryPlanSummary ?? null;
  const planExists = Boolean(plan ?? summary);
  const eligibility = getDeliveryPlanEligibility(row);

  return {
    planExists,
    canView: Boolean(summary) && !plan,
    canGenerate: eligibility.allowed,
    // Only warn that a plan is "unavailable" when none exists and one cannot be generated.
    showUnavailable: !planExists && !eligibility.allowed,
    displayStatus: plan?.status ?? summary?.status ?? null,
    deliveryMode: plan?.deliveryMode ?? summary?.deliveryMode ?? row.deliveryMode,
    eligibilityMessage: eligibility.message,
  };
}
