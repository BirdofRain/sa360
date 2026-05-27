"use client";

import { useState, useTransition } from "react";

import { generateDeliveryPlanAction, runRoutingDryRunTestAction } from "@/app/actions/routing-dry-run";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LeadDeliveryPlanItem, RoutingDryRunTestResult } from "@/lib/routing-dry-run/types";
import { deliveryPlanStatusLabel } from "@/lib/routing-dry-run/delivery-plan-display";
import {
  confidenceBadgeClass,
  deliveryModeBadgeClass,
  displayMatchType,
  matchBadgeClass,
} from "@/lib/routing-dry-run/routing-dry-run-display";
import { cn } from "@/lib/utils";

function ResultSummary({ result }: { result: RoutingDryRunTestResult }) {
  const matched = result.matched;
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn("w-fit", matchBadgeClass(matched))}>
          {matched ? "Matched" : "Review required"}
        </Badge>
        <Badge variant="outline" className={cn("w-fit", confidenceBadgeClass(result.confidence, matched))}>
          {result.confidence}
        </Badge>
        {result.matchType ? (
          <span className="text-xs text-muted-foreground">Match: {displayMatchType(result.matchType)}</span>
        ) : null}
        <Badge variant="outline" className={cn("w-fit", deliveryModeBadgeClass())}>
          {result.deliveryMode}
        </Badge>
      </div>
      <dl className="grid grid-cols-[140px_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Destination client</dt>
        <dd className="break-all font-mono">{result.destinationClientAccountId ?? "—"}</dd>
        <dt className="text-muted-foreground">Destination subaccount</dt>
        <dd className="break-all font-mono">{result.destinationSubaccountIdGhl ?? "—"}</dd>
        <dt className="text-muted-foreground">Reason</dt>
        <dd className="break-all">{result.reason}</dd>
        <dt className="text-muted-foreground">Decision ID</dt>
        <dd className="break-all font-mono">{result.decisionId}</dd>
      </dl>
      {result.lifecycleEventsEmitted.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Emitted events</p>
          <ul className="flex flex-wrap gap-1">
            {result.lifecycleEventsEmitted.map((ev) => (
              <li key={ev}>
                <Badge variant="secondary" className="font-mono text-xs">
                  {ev}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function RoutingDryRunTestPanel() {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [result, setResult] = useState<RoutingDryRunTestResult | null>(null);
  const [plan, setPlan] = useState<LeadDeliveryPlanItem | null>(null);
  const [pending, startTransition] = useTransition();

  function onRun() {
    setError(null);
    setPlanError(null);
    setResult(null);
    setPlan(null);
    startTransition(async () => {
      const res = await runRoutingDryRunTestAction(raw);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res.data.result);
    });
  }

  return (
    <details className="rounded-xl border border-border bg-card">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        Test payload
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          Paste lifecycle JSON and run matcher (no delivery)
        </span>
      </summary>
      <div className="space-y-3 border-t border-border px-4 pb-4 pt-3">
        <textarea
          className="min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder='{"event":{...},"contact":{...},"attribution":{...}}'
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          This does not deliver the lead. Payload is not stored beyond this session.
        </p>
        <Button type="button" onClick={onRun} disabled={pending}>
          {pending ? "Running…" : "Run dry run"}
        </Button>
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {result ? <ResultSummary result={result} /> : null}
        {result ? (
          <div className="space-y-2 border-t border-border pt-3">
            {result.matched && result.decisionId ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setPlanError(null);
                  startTransition(async () => {
                    const res = await generateDeliveryPlanAction(result.decisionId);
                    if (!res.ok) {
                      setPlanError(res.error);
                      return;
                    }
                    setPlan(res.plan);
                  });
                }}
              >
                Generate shadow delivery plan
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Cannot generate delivery plan until routing rule matches and decision is persisted.
              </p>
            )}
            {planError ? (
              <p className="text-sm text-destructive">{planError}</p>
            ) : null}
            {plan ? (
              <p className="text-xs text-muted-foreground">
                Delivery plan: {deliveryPlanStatusLabel(plan.status)} ({plan.steps.length} steps, shadow only)
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}
