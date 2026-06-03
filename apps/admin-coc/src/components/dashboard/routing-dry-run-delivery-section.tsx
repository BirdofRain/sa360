"use client";

import { useState, useTransition } from "react";

import {
  generateDeliveryPlanAction,
  loadDeliveryPlanForDecisionAction,
} from "@/app/actions/routing-dry-run";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import type { LeadDeliveryPlanItem, RoutingDryRunDecisionItem } from "@/lib/routing-dry-run/types";
import { getDeliveryPlanEligibility } from "@/lib/routing-dry-run/routing-dry-run-plan-eligibility";
import {
  deliveryPlanStatusBadgeClass,
  deliveryPlanStatusLabel,
  deliveryPlanStepStatusLabel,
  deliveryPlanStepSummary,
} from "@/lib/routing-dry-run/delivery-plan-display";
import { RoutingDryRunGhlAdapterSection } from "@/components/dashboard/routing-dry-run-ghl-adapter-section";
import { RoutingDryRunGhlLiveCanarySection } from "@/components/dashboard/routing-dry-run-ghl-live-canary-section";
import { cn } from "@/lib/utils";

export function RoutingDryRunDeliverySection({
  row,
  onPlanUpdated,
}: {
  row: RoutingDryRunDecisionItem;
  onPlanUpdated?: (plan: LeadDeliveryPlanItem) => void;
}) {
  const [plan, setPlan] = useState<LeadDeliveryPlanItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const summary = row.deliveryPlanSummary;
  const displayStatus = plan?.status ?? summary?.status ?? null;
  const eligibility = getDeliveryPlanEligibility(row);

  function loadExisting() {
    setError(null);
    startTransition(async () => {
      const res = await loadDeliveryPlanForDecisionAction(row.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPlan(res.plan);
      onPlanUpdated?.(res.plan);
    });
  }

  function generate() {
    setError(null);
    if (!eligibility.allowed) {
      setError(eligibility.message);
      return;
    }
    startTransition(async () => {
      const res = await generateDeliveryPlanAction(row.id, row);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPlan(res.plan);
      onPlanUpdated?.(res.plan);
    });
  }

  const steps = Array.isArray(plan?.steps) ? plan.steps : [];

  return (
    <div className="space-y-3">
      <WarningBanner tone="info" title="Shadow only — no external delivery">
        No GHL contacts, workflows, tags, opportunities, or Google Sheet writes were executed.
      </WarningBanner>

      {!eligibility.allowed ? (
        <WarningBanner tone="warn" title="Delivery plan unavailable">
          {eligibility.message}
        </WarningBanner>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn("w-fit", deliveryPlanStatusBadgeClass(displayStatus))}>
          {deliveryPlanStatusLabel(displayStatus)}
        </Badge>
        {plan?.generatedAt ? (
          <span className="text-xs text-muted-foreground">
            Generated {new Date(plan.generatedAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      {plan?.summary ? <p className="text-sm text-muted-foreground">{plan.summary}</p> : null}

      {plan?.warnings && plan.warnings.length > 0 ? (
        <ul className="list-inside list-disc text-xs text-amber-800 dark:text-amber-200">
          {plan.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={generate} disabled={pending || !eligibility.allowed}>
          {pending ? "Working…" : plan ? "Regenerate delivery plan" : "Generate delivery plan"}
        </Button>
        {!plan && summary ? (
          <Button type="button" size="sm" variant="outline" onClick={loadExisting} disabled={pending}>
            View delivery plan
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {plan && steps.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">Step</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Summary</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step) => (
                <tr key={step.id} className="border-b border-border/60">
                  <td className="px-2 py-1.5 tabular-nums">{step.stepOrder}</td>
                  <td className="px-2 py-1.5 font-mono">{step.stepType}</td>
                  <td className="px-2 py-1.5">{deliveryPlanStepStatusLabel(step.status)}</td>
                  <td className="px-2 py-1.5">{deliveryPlanStepSummary(step)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          GHL adapter test
        </h4>
        <RoutingDryRunGhlAdapterSection plan={plan} disabled={!row.matched} />
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Live canary delivery
        </h4>
        <RoutingDryRunGhlLiveCanarySection plan={plan} row={row} disabled={!row.matched} />
      </div>
    </div>
  );
}
