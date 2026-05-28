import type { RoutingValidationStatus } from "../lib/routing-validation-status.js";
import type { RoutingDryRunLeadIdentity } from "./routing-dry-run-admin.present.js";

export type SuggestionConfidence = "high" | "medium" | "low";

export type RoutingValidationSuggestion = {
  suggestedValidationStatus: RoutingValidationStatus;
  suggestedValidationReason: string;
  suggestionConfidence: SuggestionConfidence;
};

export type RoutingValidationSuggestInput = {
  matched: boolean;
  routingEventNameInternal: string;
  destinationClientAccountId: string | null;
  destinationSubaccountIdGhl: string | null;
  legacyDeliveredClientAccountId: string | null;
  legacyDeliveredSubaccountIdGhl: string | null;
  legacyDeliveryContactIdGhl: string | null;
  legacyDeliveryStatus: string | null;
  validationStatus: string | null;
  sourceLeadUid: string;
  leadIdentity: RoutingDryRunLeadIdentity | null;
};

export type LegacyPrefillSuggestInput = {
  legacyDeliveredClientAccountId: string | null;
  legacyDeliveredSubaccountIdGhl: string | null;
  legacyDeliveryContactIdGhl: string | null;
  legacyDeliveryStatus: string | null;
  destinationClientAccountId: string | null;
  matched: boolean;
  lifecycleClientAccountId: string | null;
  lifecycleSubaccountIdGhl: string | null;
  lifecycleContactIdGhl: string | null;
  lifecycleEventStatus: string | null;
};

export type LegacyPrefillSuggestion = {
  legacyDeliveredClientAccountId: string | null;
  legacyDeliveredSubaccountIdGhl: string | null;
  legacyDeliveryContactIdGhl: string | null;
  legacyDeliveryStatus: string | null;
  prefillReason: string | null;
  prefillConfidence: SuggestionConfidence | null;
};

function norm(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function normKey(value: string | null | undefined): string | null {
  const t = norm(value);
  return t ? t.toLowerCase() : null;
}

function hasAnyLegacyField(input: RoutingValidationSuggestInput): boolean {
  return Boolean(
    norm(input.legacyDeliveredClientAccountId) ||
      norm(input.legacyDeliveredSubaccountIdGhl) ||
      norm(input.legacyDeliveryContactIdGhl) ||
      norm(input.legacyDeliveryStatus)
  );
}

const TEST_LEAD_UID = /(?:^|[_-])(test|sandbox|fixture|sample)(?:[_-]|$)/i;
const TEST_EMAIL = /@(example\.com|test\.com|localhost)$/i;
const TEST_NAME = /^(test|qa|sandbox)\b/i;

/** Obvious test leads only — avoid false positives on real names. */
export function isObviousTestLead(input: RoutingValidationSuggestInput): boolean {
  const uid = norm(input.sourceLeadUid) ?? "";
  if (TEST_LEAD_UID.test(uid)) return true;

  const lead = input.leadIdentity;
  const email = norm(lead?.email);
  if (email && TEST_EMAIL.test(email)) return true;

  const first = norm(lead?.firstName);
  const last = norm(lead?.lastName);
  if (first && TEST_NAME.test(first)) return true;
  if (last && TEST_NAME.test(last)) return true;

  const display = norm(lead?.displayName);
  if (display && TEST_NAME.test(display)) return true;

  return false;
}

export function suggestRoutingValidation(
  input: RoutingValidationSuggestInput
): RoutingValidationSuggestion {
  if (isObviousTestLead(input)) {
    return {
      suggestedValidationStatus: "ignored_test",
      suggestedValidationReason:
        "Lead UID, email, or name looks like obvious test/sandbox data.",
      suggestionConfidence: "high",
    };
  }

  const reviewRequired =
    !input.matched ||
    input.routingEventNameInternal === "routing_review_required";

  if (reviewRequired) {
    return {
      suggestedValidationStatus: "needs_mapping",
      suggestedValidationReason:
        "SA360 did not match an active routing rule; legacy comparison requires rule mapping first.",
      suggestionConfidence: "high",
    };
  }

  const destSub = normKey(input.destinationSubaccountIdGhl);
  const legacySub = normKey(input.legacyDeliveredSubaccountIdGhl);
  const destClient = normKey(input.destinationClientAccountId);
  const legacyClient = normKey(input.legacyDeliveredClientAccountId);

  if (destSub && legacySub) {
    if (destSub === legacySub) {
      return {
        suggestedValidationStatus: "matched_legacy",
        suggestedValidationReason:
          "Legacy delivered subaccount matches SA360 predicted destination subaccount.",
        suggestionConfidence: "high",
      };
    }
    return {
      suggestedValidationStatus: "mismatch",
      suggestedValidationReason:
        "Legacy delivered subaccount differs from SA360 predicted destination subaccount.",
      suggestionConfidence: "high",
    };
  }

  if (destClient && legacyClient) {
    if (destClient === legacyClient) {
      return {
        suggestedValidationStatus: "matched_legacy",
        suggestedValidationReason:
          "Legacy delivered client account matches SA360 predicted destination client.",
        suggestionConfidence: "medium",
      };
    }
    return {
      suggestedValidationStatus: "mismatch",
      suggestedValidationReason:
        "Legacy delivered client account differs from SA360 predicted destination client.",
      suggestionConfidence: "medium",
    };
  }

  if (!hasAnyLegacyField(input)) {
    return {
      suggestedValidationStatus: "legacy_unknown",
      suggestedValidationReason:
        "No legacy delivery fields recorded yet; enter Zapier/GHL outcome or use prefill hints.",
      suggestionConfidence: "medium",
    };
  }

  if (legacySub && !destSub) {
    return {
      suggestedValidationStatus: "legacy_unknown",
      suggestedValidationReason:
        "Legacy subaccount recorded but SA360 has no predicted destination subaccount to compare.",
      suggestionConfidence: "low",
    };
  }

  return {
    suggestedValidationStatus: "legacy_unknown",
    suggestedValidationReason:
      "Partial legacy delivery data; add subaccount or client account for a stronger comparison.",
    suggestionConfidence: "low",
  };
}

/** Best-effort legacy field hints from source lifecycle event (never auto-saved). */
export function suggestLegacyPrefill(input: LegacyPrefillSuggestInput): LegacyPrefillSuggestion {
  const empty: LegacyPrefillSuggestion = {
    legacyDeliveredClientAccountId: null,
    legacyDeliveredSubaccountIdGhl: null,
    legacyDeliveryContactIdGhl: null,
    legacyDeliveryStatus: null,
    prefillReason: null,
    prefillConfidence: null,
  };

  if (
    norm(input.legacyDeliveredClientAccountId) &&
    norm(input.legacyDeliveredSubaccountIdGhl) &&
    norm(input.legacyDeliveryContactIdGhl)
  ) {
    return empty;
  }

  const contact = norm(input.lifecycleContactIdGhl);
  const subaccount = norm(input.lifecycleSubaccountIdGhl);
  const eventClient = norm(input.lifecycleClientAccountId);
  const destClient = norm(input.destinationClientAccountId);

  const out: LegacyPrefillSuggestion = { ...empty };
  const reasons: string[] = [];
  let confidence: SuggestionConfidence = "low";

  if (!norm(input.legacyDeliveryContactIdGhl) && contact) {
    out.legacyDeliveryContactIdGhl = contact;
    reasons.push("contact from source lifecycle event");
    confidence = "high";
  }

  if (!norm(input.legacyDeliveredSubaccountIdGhl) && subaccount) {
    out.legacyDeliveredSubaccountIdGhl = subaccount;
    reasons.push("subaccount from source lifecycle event");
    confidence = confidence === "high" ? "high" : "medium";
  }

  if (
    !norm(input.legacyDeliveredClientAccountId) &&
    eventClient &&
    input.matched &&
    destClient &&
    normKey(eventClient) === normKey(destClient)
  ) {
    out.legacyDeliveredClientAccountId = eventClient;
    reasons.push("client account matches SA360 predicted destination");
    confidence = "high";
  }

  const status = norm(input.lifecycleEventStatus);
  if (!norm(input.legacyDeliveryStatus) && status && /^(processed|delivered|completed)$/i.test(status)) {
    out.legacyDeliveryStatus = status;
    reasons.push("lifecycle event status");
    confidence = confidence === "high" ? "high" : "medium";
  }

  if (reasons.length === 0) return empty;

  out.prefillReason = `Suggested from ${reasons.join("; ")}.`;
  out.prefillConfidence = confidence;
  return out;
}

/** Operator has already set a non-unreviewed status — suggestions are advisory only. */
export function isOperatorValidated(validationStatus: string | null | undefined): boolean {
  const s = norm(validationStatus);
  return Boolean(s && s !== "unreviewed");
}
