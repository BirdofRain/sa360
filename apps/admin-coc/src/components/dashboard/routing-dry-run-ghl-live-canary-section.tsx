"use client";

import { useEffect, useState, useTransition } from "react";

import {
  executeGhlLiveCanaryAction,
  loadGhlLiveCanaryPreflightAction,
} from "@/app/actions/ghl-live-canary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import type { LeadDeliveryPlanItem, RoutingDryRunDecisionItem } from "@/lib/routing-dry-run/types";
import type { GhlLiveCanaryPreflight, GhlLiveDeliveryRunItem } from "@/lib/ghl-live-canary/types";
import {
  GHL_LIVE_CANARY_SAFETY_COPY,
  LIVE_CANARY_CONFIRMATION_TEXT,
} from "@/lib/ghl-live-canary/types";
import {
  filterStaleSimulationBlockers,
  ghlLiveRunStatusBadgeClass,
  ghlLiveRunStatusLabel,
  liveCanaryCanRunFromPreflight,
  liveCanarySimulationBadge,
  truncateIdempotencyKey,
} from "@/lib/ghl-live-canary/ghl-live-canary-display";
import { cn } from "@/lib/utils";

export function RoutingDryRunGhlLiveCanarySection({
  plan,
  row,
  disabled,
  refreshToken,
  simulatedPlanId,
}: {
  plan: LeadDeliveryPlanItem | null;
  row: RoutingDryRunDecisionItem;
  disabled?: boolean;
  /** Increments after a successful adapter simulation to force a readiness refetch. */
  refreshToken?: number;
  /** Delivery plan id the most recent adapter simulation ran against (for stale-plan badges). */
  simulatedPlanId?: string | null;
}) {
  const [preflight, setPreflight] = useState<GhlLiveCanaryPreflight | null>(null);
  const [liveRun, setLiveRun] = useState<GhlLiveDeliveryRunItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!plan?.id) {
      setPreflight(null);
      return;
    }
    startTransition(async () => {
      const res = await loadGhlLiveCanaryPreflightAction(plan.id);
      if (res.ok) setPreflight(res.preflight.preflight);
    });
    // Refetch when the plan changes OR after a successful adapter simulation (refreshToken bump).
  }, [plan?.id, refreshToken]);

  const canRun = liveCanaryCanRunFromPreflight(preflight) && !disabled && Boolean(plan);
  const simBadge = liveCanarySimulationBadge({
    preflight,
    planId: plan?.id ?? null,
    simulatedPlanId,
  });
  const visibleBlockers = filterStaleSimulationBlockers(
    preflight?.blockers ?? [],
    Boolean(preflight?.lastAdapterSimulationPassed)
  );

  function runLiveCanary() {
    if (!plan) return;
    setError(null);
    startTransition(async () => {
      const res = await executeGhlLiveCanaryAction(plan.id, confirmText);
      if (!res.ok) {
        setError(res.error);
        if (res.liveRun) setLiveRun(res.liveRun);
        if (res.blockers?.length) {
          setPreflight((p) =>
            p ? { ...p, canExecute: false, blockers: res.blockers ?? p.blockers } : p
          );
        }
        return;
      }
      setLiveRun(res.liveRun);
      setModalOpen(false);
      setConfirmText("");
      const refresh = await loadGhlLiveCanaryPreflightAction(plan.id);
      if (refresh.ok) setPreflight(refresh.preflight.preflight);
    });
  }

  if (!plan) {
    return (
      <p className="text-xs text-muted-foreground">
        Generate a shadow delivery plan and run adapter simulation before live canary.
      </p>
    );
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <WarningBanner tone="warn" title={GHL_LIVE_CANARY_SAFETY_COPY}>
        Manual one-lead GHL write only. Requires live_canary env mode and operator confirmation.
      </WarningBanner>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {preflight ? (
          <>
            <Badge variant="outline">Adapter mode: {preflight.adapterMode}</Badge>
            <Badge
              variant="outline"
              className={cn(
                "w-fit",
                simBadge.status === "passed"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100"
              )}
            >
              {simBadge.label}
            </Badge>
            {preflight.duplicateBlocksLive ? (
              <Badge variant="outline" className="border-destructive/40 text-destructive">
                Duplicate risk blocks live
              </Badge>
            ) : null}
            {liveRun || preflight.lastLiveRunStatus ? (
              <Badge
                variant="outline"
                className={cn("w-fit", ghlLiveRunStatusBadgeClass(liveRun?.status ?? preflight.lastLiveRunStatus))}
              >
                Last run: {ghlLiveRunStatusLabel(liveRun?.status ?? preflight.lastLiveRunStatus)}
              </Badge>
            ) : null}
          </>
        ) : null}
      </div>

      {preflight ? (
        <dl className="grid gap-1 text-xs text-muted-foreground">
          <div>
            <dt className="inline font-medium text-foreground">Idempotency: </dt>
            <dd className="inline font-mono">{truncateIdempotencyKey(preflight.idempotencyKey)}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">Readiness: </dt>
            <dd className="inline">
              {preflight.readinessCanDeliverLive ? "live allowed" : "not ready for live"}
            </dd>
          </div>
          {preflight.duplicateRiskLevel ? (
            <div>
              <dt className="inline font-medium text-foreground">Duplicate risk: </dt>
              <dd className="inline">{preflight.duplicateRiskLevel}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {preflight && visibleBlockers.length > 0 ? (
        <ul className="list-inside list-disc text-xs text-amber-800 dark:text-amber-200">
          {visibleBlockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}

      {preflight && Array.isArray(preflight.warnings) && preflight.warnings.length > 0 ? (
        <ul className="list-inside list-disc text-xs text-muted-foreground">
          {preflight.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {!row.matched ? (
        <p className="text-xs text-muted-foreground">Unmatched decisions cannot run live canary.</p>
      ) : null}

      <Button type="button" size="sm" variant="destructive" disabled={pending || !canRun} onClick={() => setModalOpen(true)}>
        {pending ? "Working…" : "Run live canary delivery"}
      </Button>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {liveRun ? (
        <div className="rounded-md border border-border bg-muted/20 p-3 text-xs space-y-2">
          <p className="font-medium">Last live canary result</p>
          {liveRun.contactIdGhl ? <p>GHL contact ID: {liveRun.contactIdGhl}</p> : null}
          {liveRun.opportunityIdGhl ? <p>Opportunity ID: {liveRun.opportunityIdGhl}</p> : null}
          {liveRun.workflowStarted !== null ? (
            <p>Workflow started: {liveRun.workflowStarted ? "yes" : "no"}</p>
          ) : null}
          <p className="font-mono">Idempotency: {truncateIdempotencyKey(liveRun.idempotencyKey)}</p>
          {Array.isArray(liveRun.errors) && liveRun.errors.length > 0 ? (
            <ul className="list-inside list-disc text-destructive">
              {liveRun.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-4 shadow-lg space-y-3">
            <h3 className="text-sm font-semibold">Confirm live canary delivery</h3>
            <p className="text-xs text-muted-foreground">
              This will create or update one contact in the destination GHL subaccount and may start
              configured workflows. Do not use unless this client/rule has been approved for cutover.
            </p>
            <label className="block text-xs">
              Type{" "}
              <span className="font-mono font-semibold">{LIVE_CANARY_CONFIRMATION_TEXT}</span> to confirm
              <input
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={pending || confirmText.trim() !== LIVE_CANARY_CONFIRMATION_TEXT}
                onClick={runLiveCanary}
              >
                {pending ? "Executing…" : "Execute live canary"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
