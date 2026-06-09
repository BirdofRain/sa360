"use client";

import { Component, useMemo, useState, useTransition, type ReactNode } from "react";

import { runDirectDemoDeliveryAction } from "@/app/actions/direct-delivery-demo";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  directDemoOutcomeLabel,
  displayText,
} from "@/lib/direct-delivery-demo/normalize-result";
import { directDemoLeadCreatedPayloadJson } from "@/lib/direct-delivery-demo/demo-payload";
import {
  DIRECT_DEMO_CLIENT_ACCOUNT_ID,
  DIRECT_DEMO_LIVE_CONFIRMATION_TEXT,
  DIRECT_DEMO_LOCATION_ID,
  type DirectDemoDeliveryViewModel,
} from "@/lib/direct-delivery-demo/types";

function InlineErrorPanel({
  title,
  message,
  onDismiss,
}: {
  title: string;
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      role="alert"
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 whitespace-pre-wrap break-words">{message}</p>
      {onDismiss ? (
        <button
          type="button"
          className="mt-2 text-xs underline underline-offset-2"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

function ResultCard({ result }: { result: DirectDemoDeliveryViewModel }) {
  const modeLabel = displayText(result.mode, "simulate");
  const outcome = directDemoOutcomeLabel(result);
  const statusBadge =
    outcome === "success"
      ? { variant: "default" as const, label: "Success" }
      : outcome === "partial_success"
        ? { variant: "secondary" as const, label: "Partial success" }
        : outcome === "failed"
          ? { variant: "destructive" as const, label: "Failed" }
          : { variant: "destructive" as const, label: "Blocked" };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
        <Badge variant="outline">{modeLabel}</Badge>
        {result.externalCallExecuted ? (
          <Badge variant="destructive">External GHL write attempted</Badge>
        ) : (
          <Badge variant="secondary">No external writes</Badge>
        )}
      </div>
      {result.summary ? <p>{result.summary}</p> : null}
      {result.reason && !result.ok ? (
        <p className="text-destructive">{result.reason}</p>
      ) : null}
      {result.contactIdGhl || result.liveRunStepSummary.length > 0 ? (
        <div className="rounded-md border border-border bg-background p-3 text-xs">
          <p className="font-medium">Live canary step summary</p>
          <dl className="mt-2 grid grid-cols-[140px_1fr] gap-x-2 gap-y-1">
            <dt className="text-muted-foreground">Contact created</dt>
            <dd>{result.contactIdGhl ? "Yes" : "No"}</dd>
            {result.contactIdGhl ? (
              <>
                <dt className="text-muted-foreground">Contact ID</dt>
                <dd className="break-all font-mono">{result.contactIdGhl}</dd>
              </>
            ) : null}
          </dl>
          {result.liveRunStepSummary.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {result.liveRunStepSummary.map((step, i) => (
                <li key={`step-${step.stepType}-${i}`}>
                  <span className="font-medium">{step.label}:</span> {step.status}
                  {step.externalId ? (
                    <span className="ml-1 font-mono text-muted-foreground">({step.externalId})</span>
                  ) : null}
                  {step.errorMessage ? (
                    <span className="block text-destructive">{step.errorMessage}</span>
                  ) : null}
                  {step.detail && step.detail !== step.errorMessage ? (
                    <span className="block text-muted-foreground">{step.detail}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {result.liveRunFailure ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <p className="font-medium text-destructive">GHL live step failure</p>
          <dl className="mt-2 grid grid-cols-[140px_1fr] gap-x-2 gap-y-1">
            <dt className="text-muted-foreground">Failed step</dt>
            <dd>{result.liveRunFailure.failedStepLabel}</dd>
            {result.liveRunFailure.httpStatus != null ? (
              <>
                <dt className="text-muted-foreground">HTTP status</dt>
                <dd>{result.liveRunFailure.httpStatus}</dd>
              </>
            ) : null}
            {result.liveRunFailure.httpMethod && result.liveRunFailure.httpPath ? (
              <>
                <dt className="text-muted-foreground">Endpoint</dt>
                <dd className="break-all font-mono">
                  {result.liveRunFailure.httpMethod} {result.liveRunFailure.httpPath}
                </dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">GHL error</dt>
            <dd className="break-words">{result.liveRunFailure.errorMessage}</dd>
            {result.liveRunFailure.requestBodyKeys.length > 0 ? (
              <>
                <dt className="text-muted-foreground">Request keys</dt>
                <dd className="break-all font-mono">
                  {result.liveRunFailure.requestBodyKeys.join(", ")}
                </dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Partial contact</dt>
            <dd>{result.liveRunFailure.partialContactCreated ? "Yes" : "No"}</dd>
          </dl>
        </div>
      ) : null}
      <dl className="grid grid-cols-[160px_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Matched</dt>
        <dd>{result.matched ? "Yes" : "No"}</dd>
        <dt className="text-muted-foreground">Destination client</dt>
        <dd className="break-all font-mono">{result.destinationClientAccountId ?? "—"}</dd>
        <dt className="text-muted-foreground">Destination location</dt>
        <dd className="break-all font-mono">{result.destinationSubaccountIdGhl ?? "—"}</dd>
        <dt className="text-muted-foreground">Routing decision</dt>
        <dd className="break-all font-mono">{result.routingDryRunDecisionId ?? "—"}</dd>
        <dt className="text-muted-foreground">Delivery plan</dt>
        <dd className="break-all font-mono">{result.deliveryPlanId ?? "—"}</dd>
        <dt className="text-muted-foreground">Adapter run</dt>
        <dd className="break-all font-mono">{result.adapterRunId ?? "—"}</dd>
        <dt className="text-muted-foreground">Live run</dt>
        <dd className="break-all font-mono">{result.liveRunId ?? "—"}</dd>
        <dt className="text-muted-foreground">Plan status</dt>
        <dd>{result.deliveryPlanStatus ?? "—"}</dd>
        <dt className="text-muted-foreground">Adapter mode</dt>
        <dd className="font-mono">{result.adapterMode ?? "—"}</dd>
      </dl>
      {result.duplicateRisk ? (
        <div className="rounded-md border border-border bg-background p-2 text-xs">
          <p className="font-medium">Duplicate risk</p>
          <p>
            {result.duplicateRisk.riskLevel}
            {result.duplicateRisk.blocksLiveDelivery ? " — blocks live" : ""}
          </p>
          {result.duplicateRisk.recommendedAction ? (
            <p className="text-muted-foreground">{result.duplicateRisk.recommendedAction}</p>
          ) : null}
        </div>
      ) : null}
      {result.readiness ? (
        <div className="rounded-md border border-border bg-background p-2 text-xs">
          <p className="font-medium">Delivery readiness</p>
          <p>{result.readiness.canDeliverLive ? "Can deliver live" : "Not live-ready"}</p>
          {result.readiness.blockers.length > 0 ? (
            <ul className="mt-1 list-disc pl-4 text-muted-foreground">
              {result.readiness.blockers.map((b, i) => (
                <li key={`readiness-blocker-${i}`}>{b}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {result.blockers.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-destructive">Blockers</p>
          <ul className="list-disc pl-4 text-xs text-destructive">
            {result.blockers.map((b, i) => (
              <li key={`blocker-${i}`}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.warnings.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-amber-700">Warnings</p>
          <ul className="list-disc pl-4 text-xs text-amber-800">
            {result.warnings.map((w, i) => (
              <li key={`warning-${i}`}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.nextAction ? (
        <p className="text-xs text-muted-foreground">Next: {result.nextAction}</p>
      ) : null}
    </div>
  );
}

type ResultBoundaryState = { error: string | null };

class DirectDemoResultBoundary extends Component<
  { children: ReactNode; onError: (message: string) => void },
  ResultBoundaryState
> {
  state: ResultBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ResultBoundaryState {
    return { error: error.message || "Could not render delivery result." };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error.message || "Could not render delivery result.");
  }

  render() {
    if (this.state.error) {
      return (
        <InlineErrorPanel
          title="Could not display result"
          message={this.state.error}
          onDismiss={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

export function DirectDeliveryDemoPanel() {
  const [raw, setRaw] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DirectDemoDeliveryViewModel | null>(null);
  const [pending, startTransition] = useTransition();

  const liveEnabled = useMemo(
    () => confirmation.trim() === DIRECT_DEMO_LIVE_CONFIRMATION_TEXT,
    [confirmation]
  );

  function run(mode: "simulate" | "live_canary") {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const res = await runDirectDemoDeliveryAction(raw, mode, confirmation);
        if (!res.ok) {
          setError(res.error);
          if (res.data) setResult(res.data);
          return;
        }
        setResult(res.data);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Unexpected error running direct demo delivery.";
        setError(msg);
      }
    });
  }

  return (
    <div className="space-y-4">
      <WarningBanner tone="warn" title="Demo only — guarded direct delivery">
        Routes one normalized <span className="font-mono">lead_created</span> through dry-run → plan →
        adapter simulation. Live canary can create/update one contact in Smart Agent 360 Demo (
        <span className="font-mono">{DIRECT_DEMO_CLIENT_ACCOUNT_ID}</span> /{" "}
        <span className="font-mono">{DIRECT_DEMO_LOCATION_ID}</span>) when every safety gate passes.
      </WarningBanner>

      <div className="space-y-2">
        <Label htmlFor="direct-demo-payload">Normalized lifecycle JSON</Label>
        <textarea
          id="direct-demo-payload"
          className="min-h-[220px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          placeholder='{"client_account_id":"lal_master_vet", ...}'
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              setError(null);
              setResult(null);
              try {
                setRaw(directDemoLeadCreatedPayloadJson());
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Could not load demo payload."
                );
              }
            }}
          >
            Load demo payload
          </Button>
          <Button type="button" disabled={pending || !raw.trim()} onClick={() => run("simulate")}>
            {pending ? "Running…" : "Run simulation"}
          </Button>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm font-medium text-destructive">Live canary (one lead)</p>
        <p className="text-xs text-muted-foreground">
          Requires <span className="font-mono">GHL_DELIVERY_ADAPTER_MODE=live_canary</span>, direct
          delivery env allowlist, OAuth connection, readiness, and successful simulation.
        </p>
        <div className="grid gap-2 sm:max-w-md">
          <Label htmlFor="direct-demo-confirm">Type {DIRECT_DEMO_LIVE_CONFIRMATION_TEXT}</Label>
          <Input
            id="direct-demo-confirm"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
            disabled={pending}
          />
        </div>
        <Button
          type="button"
          variant="destructive"
          disabled={pending || !raw.trim() || !liveEnabled}
          onClick={() => run("live_canary")}
        >
          Run live canary delivery
        </Button>
      </div>

      {error ? (
        <InlineErrorPanel title="Request failed" message={error} onDismiss={() => setError(null)} />
      ) : null}
      {result ? (
        <DirectDemoResultBoundary onError={(msg) => setError(msg)}>
          <ResultCard result={result} />
        </DirectDemoResultBoundary>
      ) : null}
    </div>
  );
}
