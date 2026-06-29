"use client";

import { useEffect, useState, useTransition } from "react";

import { patchDuplicateRiskReviewAction } from "@/app/actions/routing-dry-run";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import type { RoutingDryRunDecisionItem } from "@/lib/routing-dry-run/types";
import { formatRoutingDryRunActionError } from "@/lib/routing-dry-run/routing-dry-run-action.util";
import type { DuplicateRiskAssessmentItem } from "@/lib/routing-dry-run/duplicate-risk-types";
import {
  canRunDuplicateOverride,
  hasDuplicateCandidate,
  type DuplicateOverrideStatus,
} from "@/lib/routing-dry-run/duplicate-identity-guard";
import {
  duplicateRiskBadgeClass,
  duplicateRiskLevelLabel,
  identityStatusLabel,
} from "@/lib/routing-dry-run/duplicate-risk-display";
import { cn } from "@/lib/utils";

export function RoutingDryRunDuplicateRiskSection({
  row,
  onUpdated,
}: {
  row: RoutingDryRunDecisionItem;
  onUpdated?: (duplicateRisk: DuplicateRiskAssessmentItem) => void;
}) {
  const [assessment, setAssessment] = useState(row.duplicateRisk);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Keep local state in sync if the parent row changes (e.g. drawer reopened for another row).
  useEffect(() => {
    setAssessment(row.duplicateRisk);
    setError(null);
  }, [row.duplicateRisk]);

  function review(status: DuplicateOverrideStatus) {
    setError(null);
    // Client-side guard: identity-link overrides require a duplicate candidate.
    const guard = canRunDuplicateOverride(assessment, status);
    if (!guard.allowed) {
      setError(guard.message);
      return;
    }
    startTransition(async () => {
      const res = await patchDuplicateRiskReviewAction(row.id, {
        operatorOverrideStatus: status,
      });
      if (!res.ok) {
        setError(formatRoutingDryRunActionError(res.error));
        return;
      }
      setAssessment(res.duplicateRisk);
      onUpdated?.(res.duplicateRisk);
    });
  }

  if (!assessment) {
    return (
      <p className="text-xs text-muted-foreground">
        Duplicate-risk assessment will appear after routing dry-run completes for this lead.
      </p>
    );
  }

  const canMarkIdentity = hasDuplicateCandidate(assessment);

  return (
    <div className="space-y-3">
      <WarningBanner tone="info" title="Internal correlation only">
        SA360 does not merge or update GHL contacts. This section flags duplicate risk for operator
        review before live delivery.
      </WarningBanner>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn("w-fit", duplicateRiskBadgeClass(assessment.riskLevel))}>
          {duplicateRiskLevelLabel(assessment.riskLevel)}
        </Badge>
        <Badge variant="outline" className="w-fit">
          Identity: {identityStatusLabel(assessment.identityStatus)}
        </Badge>
        {assessment.blocksLiveDelivery ? (
          <Badge variant="outline" className="w-fit border-destructive/50 text-destructive">
            Blocks live delivery
          </Badge>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">{assessment.recommendedAction}</p>

      {(assessment.reasons ?? []).length > 0 ? (
        <ul className="list-inside list-disc text-xs text-muted-foreground">
          {(assessment.reasons ?? []).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}

      {(assessment.candidateMatches ?? []).length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-2 py-1.5">Match</th>
                <th className="px-2 py-1.5">Lead UID</th>
                <th className="px-2 py-1.5">Contact</th>
                <th className="px-2 py-1.5">Detail</th>
              </tr>
            </thead>
            <tbody>
              {(assessment.candidateMatches ?? []).map((m, i) => (
                <tr key={`${m.matchType}-${i}`} className="border-b border-border/60 align-top">
                  <td className="px-2 py-1.5 font-mono">{m.matchType}</td>
                  <td className="px-2 py-1.5 font-mono">{m.existingLeadUid ?? "—"}</td>
                  <td className="px-2 py-1.5 font-mono">{m.existingContactIdGhl ?? "—"}</td>
                  <td className="px-2 py-1.5">{m.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending || !canMarkIdentity}
          onClick={() => review("same_person")}
        >
          Mark as same person
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !canMarkIdentity}
          onClick={() => review("separate_person")}
        >
          Mark as separate person
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => review("ignored_test")}
        >
          Ignored (test)
        </Button>
      </div>

      {!canMarkIdentity ? (
        <p className="text-xs text-muted-foreground">
          No duplicate candidate detected — “same person” / “separate person” are unavailable. Use
          “Ignored (test)” to annotate this review.
        </p>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
