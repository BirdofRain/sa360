"use client";

import { useState, useTransition } from "react";

import { applyRoutingSuggestionAction } from "@/app/actions/routing-dry-run";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const suggestion = row.suggestedValidation;
  const prefill = row.suggestedLegacyPrefill;
  const aligns = suggestionAlignsWithOperatorStatus(row.validationStatus, suggestion);
  const operatorStatus = effectiveValidationStatus(row.validationStatus);

  function applySuggestion() {
    setError(null);
    startTransition(async () => {
      const res = await applyRoutingSuggestionAction(row.id, row);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onUpdated(res.item);
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
          {suggestionConfidenceLabel(suggestion.suggestionConfidence)}
        </span>
      </div>

      <p className="text-sm text-muted-foreground">{suggestion.suggestedValidationReason}</p>

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
      ) : (
        <Button type="button" size="sm" disabled={pending} onClick={applySuggestion}>
          {pending ? "Applying…" : "Apply suggestion"}
        </Button>
      )}

      <p className="text-xs text-muted-foreground">
        Suggestions are advisory only and never overwrite your saved validation automatically.
      </p>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
