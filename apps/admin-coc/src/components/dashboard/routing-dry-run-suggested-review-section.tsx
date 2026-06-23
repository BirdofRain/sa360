"use client";

import { useState, useTransition } from "react";

import { applyRoutingSuggestionAction } from "@/app/actions/routing-dry-run";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRoutingDryRunActionError } from "@/lib/routing-dry-run/routing-dry-run-action.util";
import { evaluateApplySuggestionEligibility } from "@/lib/routing-dry-run/routing-dry-run-apply-suggestion";
import { emptyLegacyPrefillSuggestion } from "@/lib/routing-dry-run/routing-dry-run-suggestion-fixture";
import type { RoutingDryRunDecisionItem } from "@/lib/routing-dry-run/types";
import {
  suggestedValidationBadgeClass,
  suggestedValidationLabel,
  suggestionAlignsWithOperatorStatus,
  suggestionConfidenceLabel,
} from "@/lib/routing-dry-run/routing-dry-run-suggested-display";
import {
  effectiveValidationStatus,
  validationStatusBadgeClass,
  validationStatusLabel,
} from "@/lib/routing-dry-run/routing-dry-run-validation-display";
import { cn } from "@/lib/utils";

export function RoutingDryRunSuggestedReviewSection({
  row,
  onUpdated,
}: {
  row: RoutingDryRunDecisionItem;
  onUpdated: (item: RoutingDryRunDecisionItem) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const suggestion = row.suggestedValidation;
  const prefill = row.suggestedLegacyPrefill ?? emptyLegacyPrefillSuggestion;
  const aligns = suggestionAlignsWithOperatorStatus(row.validationStatus, suggestion);
  const operatorStatus = effectiveValidationStatus(row.validationStatus);
  const eligibility = evaluateApplySuggestionEligibility(row);

  function applySuggestion() {
    setError(null);
    setErrorCode(null);
    setSuccessMessage(null);
    startTransition(async () => {
      const res = await applyRoutingSuggestionAction(row.id, row);
      if (!res.ok) {
        setError(formatRoutingDryRunActionError(res.error));
        setErrorCode(res.error.code);
        return;
      }
      onUpdated(res.item);
      setSuccessMessage(
        res.message ??
          "Suggestion applied. Delivery plan remains unavailable until routing is matched and configured."
      );
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={cn("w-fit", suggestedValidationBadgeClass(suggestion))}
        >
          {suggestedValidationLabel(suggestion)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {suggestionConfidenceLabel(suggestion?.suggestionConfidence ?? "low")}
        </span>
      </div>

      <p className="text-sm text-muted-foreground">
        {suggestion?.suggestedValidationReason ??
          "No suggestion reason available for this decision."}
      </p>

      <dl className="grid grid-cols-[minmax(120px,38%)_1fr] gap-x-2 gap-y-1.5 text-sm">
        <dt className="text-xs text-muted-foreground">Operator status</dt>
        <dd>
          <Badge variant="outline" className={cn("w-fit", validationStatusBadgeClass(operatorStatus))}>
            {validationStatusLabel(operatorStatus)}
          </Badge>
        </dd>
        {prefill.prefillReason ? (
          <>
            <dt className="text-xs text-muted-foreground">Legacy prefill hint</dt>
            <dd className="text-xs text-muted-foreground">{prefill.prefillReason}</dd>
          </>
        ) : null}
      </dl>

      {aligns ? (
        <p className="text-xs text-emerald-700 dark:text-emerald-300">
          Operator status already matches the suggestion.
        </p>
      ) : !eligibility.allowed ? (
        <p className="rounded-md border border-amber-600/30 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          {eligibility.message}
        </p>
      ) : (
        <Button type="button" size="sm" disabled={pending} onClick={applySuggestion}>
          {pending ? "Applying…" : "Apply suggestion"}
        </Button>
      )}

      {!row.matched ? (
        <p className="text-xs text-muted-foreground">
          Delivery plan cannot be generated until the decision is matched and delivery config is
          complete.
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Suggestions update operator validation only. They never trigger delivery or GHL writes.
      </p>

      {successMessage ? (
        <p className="rounded-md border border-emerald-600/30 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100">
          {successMessage}
        </p>
      ) : null}

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p>{error}</p>
          {errorCode ? (
            <p className="mt-1 font-mono text-xs text-destructive/80">code: {errorCode}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
