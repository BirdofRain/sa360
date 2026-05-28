"use client";

import { useState, useTransition } from "react";

import { simulateGhlAdapterAction } from "@/app/actions/ghl-adapter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import type { LeadDeliveryPlanItem } from "@/lib/routing-dry-run/types";
import type { GhlAdapterRunItem } from "@/lib/ghl-adapter/types";
import { GHL_ADAPTER_SAFETY_COPY } from "@/lib/ghl-adapter/types";
import {
  ghlAdapterModeLabel,
  ghlAdapterStatusBadgeClass,
  ghlAdapterStatusLabel,
  redactRequestPreview,
} from "@/lib/ghl-adapter/ghl-adapter-display";
import { cn } from "@/lib/utils";

export function RoutingDryRunGhlAdapterSection({
  plan,
  disabled,
}: {
  plan: LeadDeliveryPlanItem | null;
  disabled?: boolean;
}) {
  const [run, setRun] = useState<GhlAdapterRunItem | null>(null);
  const [adapterMode, setAdapterMode] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function simulate() {
    if (!plan) return;
    setError(null);
    startTransition(async () => {
      const res = await simulateGhlAdapterAction(plan.id);
      if (!res.ok) {
        setError(res.error);
        if (res.adapterRun) setRun(res.adapterRun);
        if (res.adapterMode) setAdapterMode(res.adapterMode);
        if (res.blockedReason) setBlockedReason(res.blockedReason);
        return;
      }
      setRun(res.adapterRun);
      setAdapterMode(res.adapterMode);
      setBlockedReason(null);
    });
  }

  if (!plan) {
    return (
      <p className="text-xs text-muted-foreground">
        Generate a shadow delivery plan first to run GHL adapter simulation.
      </p>
    );
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <WarningBanner tone="info" title={GHL_ADAPTER_SAFETY_COPY}>
        This validates the payload SA360 would use after cutover. No external delivery.
      </WarningBanner>

      <div className="flex flex-wrap items-center gap-2">
        {adapterMode ? (
          <Badge variant="outline" className="w-fit">
            Adapter mode: {ghlAdapterModeLabel(adapterMode)}
          </Badge>
        ) : null}
        {run ? (
          <Badge variant="outline" className={cn("w-fit", ghlAdapterStatusBadgeClass(run.status))}>
            {ghlAdapterStatusLabel(run.status)}
          </Badge>
        ) : null}
      </div>

      {blockedReason ? (
        <p className="text-xs text-amber-800 dark:text-amber-200">{blockedReason}</p>
      ) : null}

      <Button type="button" size="sm" variant="secondary" disabled={pending || disabled} onClick={simulate}>
        {pending ? "Simulating…" : "Run GHL adapter simulation"}
      </Button>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {run && run.stepRuns.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">Step</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Target</th>
                <th className="px-2 py-1.5">Preview</th>
              </tr>
            </thead>
            <tbody>
              {run.stepRuns.map((step) => (
                <tr key={step.id} className="border-b border-border/60 align-top">
                  <td className="px-2 py-1.5 tabular-nums">{step.stepOrder}</td>
                  <td className="px-2 py-1.5 font-mono">{step.stepType}</td>
                  <td className="px-2 py-1.5">{ghlAdapterStatusLabel(step.status)}</td>
                  <td className="px-2 py-1.5 font-mono">
                    {step.targetSystem}
                    {step.targetId ? ` · ${step.targetId}` : ""}
                  </td>
                  <td className="max-w-[240px] px-2 py-1.5">
                    <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">
                      {redactRequestPreview(step.requestPreviewJson)}
                    </pre>
                    {step.validationErrors.length > 0 ? (
                      <ul className="mt-1 list-inside list-disc text-amber-800 dark:text-amber-200">
                        {step.validationErrors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
