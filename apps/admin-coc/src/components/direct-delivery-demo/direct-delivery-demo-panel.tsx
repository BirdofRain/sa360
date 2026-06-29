"use client";

import { Component, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";

import {
  loadDirectDemoLiveRunDetailAction,
  runDirectDemoDeliveryAction,
} from "@/app/actions/direct-delivery-demo";
import { loadDeliveryRuntimeModeAction } from "@/app/actions/delivery-runtime-mode";
import { DeployVersionsBar } from "@/components/direct-delivery-demo/deploy-versions-bar";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BuildVersionDisplay } from "@/lib/build-version";
import {
  directDemoDeliveryTierSummary,
  directDemoOutcomeLabel,
  displayText,
  liveCanarySuccessDeliveryLines,
} from "@/lib/direct-delivery-demo/normalize-result";
import { directCanaryReadinessLabel } from "@/lib/delivery-readiness/delivery-readiness-display";
import {
  describeDirectDemoPayloadSource,
  detectDirectDemoNicheWorkflowMismatch,
  directDemoLeadCreatedPayloadJson,
  isDirectDemoLiveDeliveryAllowed,
  validateDirectDemoPayload,
} from "@/lib/direct-delivery-demo/demo-payload";
import {
  DIRECT_DEMO_CLIENT_ACCOUNT_ID,
  DIRECT_DEMO_LIVE_CANARY_SUCCESS_SUMMARY,
  DIRECT_DEMO_LIVE_CONFIRMATION_TEXT,
  DIRECT_DEMO_LOCATION_ID,
  DIRECT_DEMO_POST_CANARY_CHECKLIST,
  type DirectDemoDeliveryViewModel,
  type DirectDemoLiveRunStepSummary,
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

function LiveRunStepSummaryPanel({
  contactIdGhl,
  steps,
  liveRunId,
  loading,
  detailError,
  onLoadDetails,
}: {
  contactIdGhl: string | null;
  steps: DirectDemoLiveRunStepSummary[];
  liveRunId: string | null;
  loading: boolean;
  detailError: string | null;
  onLoadDetails: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Live canary step summary</p>
        {liveRunId ? (
          <Button type="button" size="sm" variant="outline" disabled={loading} onClick={onLoadDetails}>
            {loading ? "Loading…" : "Open live run details"}
          </Button>
        ) : null}
      </div>
      {liveRunId ? (
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          GET /admin/v1/ghl-live-delivery/runs/{liveRunId}
        </p>
      ) : null}
      {detailError ? <p className="mt-2 text-destructive">{detailError}</p> : null}
      <dl className="mt-2 grid grid-cols-[140px_1fr] gap-x-2 gap-y-1">
        <dt className="text-muted-foreground">Contact created</dt>
        <dd>{contactIdGhl ? "Yes" : "No"}</dd>
        {contactIdGhl ? (
          <>
            <dt className="text-muted-foreground">Contact ID</dt>
            <dd className="break-all font-mono">{contactIdGhl}</dd>
          </>
        ) : null}
      </dl>
      {steps.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {steps.map((step, i) => (
            <li key={`step-${step.stepType}-${i}`} className="rounded border border-border/60 p-2">
              <div>
                <span className="font-medium">{step.label}:</span> {step.status}
                {step.externalId ? (
                  <span className="ml-1 font-mono text-muted-foreground">({step.externalId})</span>
                ) : null}
              </div>
              {step.httpMethod && step.httpPath ? (
                <p className="font-mono text-[11px] text-muted-foreground">
                  {step.httpMethod} {step.httpPath}
                  {step.httpStatus != null ? ` → HTTP ${step.httpStatus}` : ""}
                </p>
              ) : null}
              {step.requestBodyKeys.length > 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Request keys: {step.requestBodyKeys.join(", ")}
                </p>
              ) : null}
              {step.requestBodyPreview ? (
                <p className="text-[11px] text-muted-foreground">
                  Opportunity body: name={step.requestBodyPreview.namePresent ? "yes" : "missing"}
                  , status={step.requestBodyPreview.statusPresent ? step.requestBodyPreview.status ?? "yes" : "missing"}
                  , contactId={step.requestBodyPreview.contactId ?? "—"}
                </p>
              ) : null}
              {step.configuredOwnerId ? (
                <p className="text-[11px] text-muted-foreground">
                  Configured owner ID: <span className="font-mono">{step.configuredOwnerId}</span>
                </p>
              ) : null}
              {step.errorMessage ? (
                <span className="mt-1 block text-destructive">{step.errorMessage}</span>
              ) : null}
              {step.detail && step.detail !== step.errorMessage ? (
                <span className="block text-muted-foreground">{step.detail}</span>
              ) : null}
              {step.customFieldStampSummary ? (
                <span className="mt-1 block text-amber-800 dark:text-amber-200">
                  {step.customFieldStampSummary}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted-foreground">
          Step details not included in the delivery response. Load live run details to inspect GHL
          step errors and request bodies.
        </p>
      )}
    </div>
  );
}

function ResultCard({
  result,
  stepSummary,
  contactIdGhl,
  detailLoading,
  detailError,
  onLoadLiveRunDetails,
  runtimeModeLiveCanary,
}: {
  result: DirectDemoDeliveryViewModel;
  stepSummary: DirectDemoLiveRunStepSummary[];
  contactIdGhl: string | null;
  detailLoading: boolean;
  detailError: string | null;
  onLoadLiveRunDetails: () => void;
  runtimeModeLiveCanary: boolean;
}) {
  const modeLabel = displayText(result.mode, "simulate");
  const outcome = directDemoOutcomeLabel(result);
  const deliveryTiers = directDemoDeliveryTierSummary(result);
  const successDeliveryLines = liveCanarySuccessDeliveryLines(result);
  const showLiveCanarySuccess =
    outcome === "success" && result.mode === "live_canary" && result.liveRunStatus === "succeeded";
  const showReturnToSimulateReminder =
    runtimeModeLiveCanary && result.mode === "live_canary" && Boolean(result.liveRunId);
  const liveRunFailure =
    result.liveRunFailure &&
    outcome !== "partial_success" &&
    result.liveRunFailure.failedStepType !== "unknown"
      ? result.liveRunFailure
      : null;
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
      {showLiveCanarySuccess ? (
        <div className="rounded-md border border-emerald-600/40 bg-emerald-50/90 p-3 text-sm dark:bg-emerald-950/40">
          <p className="font-semibold text-emerald-950 dark:text-emerald-100">
            {result.summary ?? DIRECT_DEMO_LIVE_CANARY_SUCCESS_SUMMARY}
          </p>
          {deliveryTiers ? (
            <dl className="mt-2 grid grid-cols-[160px_1fr] gap-x-2 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Required delivery</dt>
              <dd className="font-medium capitalize">{deliveryTiers.requiredDelivery}</dd>
              <dt className="text-muted-foreground">Optional enrichment</dt>
              <dd className="font-medium capitalize">
                {deliveryTiers.optionalEnrichment === "needs_config"
                  ? "needs config"
                  : deliveryTiers.optionalEnrichment}
              </dd>
            </dl>
          ) : null}
          {successDeliveryLines ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-emerald-950 dark:text-emerald-100">
              {successDeliveryLines.map((line) => (
                <li key={line.label}>
                  <span className="font-medium">{line.label}:</span> {line.status}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : result.summary ? (
        <p>{result.summary}</p>
      ) : null}
      {deliveryTiers && !showLiveCanarySuccess ? (
        <div className="rounded-md border border-amber-600/30 bg-amber-50/80 p-3 text-xs dark:bg-amber-950/30">
          <p className="font-medium text-amber-950 dark:text-amber-100">
            Required delivery completed. Optional enrichment needs config.
          </p>
          <dl className="mt-2 grid grid-cols-[160px_1fr] gap-x-2 gap-y-1">
            <dt className="text-muted-foreground">Required delivery</dt>
            <dd className="font-medium capitalize">{deliveryTiers.requiredDelivery}</dd>
            <dt className="text-muted-foreground">Optional enrichment</dt>
            <dd className="font-medium capitalize">
              {deliveryTiers.optionalEnrichment === "needs_config"
                ? "needs config"
                : deliveryTiers.optionalEnrichment}
            </dd>
          </dl>
        </div>
      ) : null}
      {showReturnToSimulateReminder ? (
        <WarningBanner tone="warn" title="Return to simulate when done">
          Live canary mode may still be active. Return to simulate when done testing.
        </WarningBanner>
      ) : null}
      {showLiveCanarySuccess ? (
        <div className="rounded-md border border-border bg-background p-3 text-xs">
          <p className="font-medium">Next</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-muted-foreground">
            {DIRECT_DEMO_POST_CANARY_CHECKLIST.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {result.reason && !result.ok ? (
        <p
          className={
            outcome === "partial_success"
              ? "text-amber-900 dark:text-amber-100"
              : "text-destructive"
          }
        >
          {result.reason}
        </p>
      ) : null}
      {result.mode === "live_canary" && (result.liveRunId || result.liveRunStatus === "partial_success") ? (
        <LiveRunStepSummaryPanel
          contactIdGhl={contactIdGhl}
          steps={stepSummary}
          liveRunId={result.liveRunId}
          loading={detailLoading}
          detailError={detailError}
          onLoadDetails={onLoadLiveRunDetails}
        />
      ) : null}
      {liveRunFailure ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <p className="font-medium text-destructive">GHL live step failure</p>
          <dl className="mt-2 grid grid-cols-[140px_1fr] gap-x-2 gap-y-1">
            <dt className="text-muted-foreground">Failed step</dt>
            <dd>{liveRunFailure.failedStepLabel}</dd>
            {liveRunFailure.httpStatus != null ? (
              <>
                <dt className="text-muted-foreground">HTTP status</dt>
                <dd>{liveRunFailure.httpStatus}</dd>
              </>
            ) : null}
            {liveRunFailure.httpMethod && liveRunFailure.httpPath ? (
              <>
                <dt className="text-muted-foreground">Endpoint</dt>
                <dd className="break-all font-mono">
                  {liveRunFailure.httpMethod} {liveRunFailure.httpPath}
                </dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">GHL error</dt>
            <dd className="break-words">{liveRunFailure.errorMessage}</dd>
            {liveRunFailure.requestBodyKeys.length > 0 ? (
              <>
                <dt className="text-muted-foreground">Request keys</dt>
                <dd className="break-all font-mono">
                  {liveRunFailure.requestBodyKeys.join(", ")}
                </dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Partial contact</dt>
            <dd>{liveRunFailure.partialContactCreated ? "Yes" : "No"}</dd>
          </dl>
        </div>
      ) : null}
      {result.matchedRuleSummary ? (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
          <p className="font-medium">Routing rule matched by dry run</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {result.matchedRuleSummary.id}
          </p>
          <p className="mt-1">
            Match: <span className="font-medium">{result.matchedRuleSummary.matchType}</span>
            {result.matchedRuleSummary.matchValue
              ? ` · ${result.matchedRuleSummary.matchValue}`
              : ""}
          </p>
          <p className="mt-1 text-muted-foreground">
            Destination: {result.matchedRuleSummary.clientAccountId} ·{" "}
            {result.matchedRuleSummary.destinationSubaccountIdGhl}
          </p>
          {result.fieldMappingSource ? (
            <p className="mt-1 text-muted-foreground">
              Field mapping source: {result.fieldMappingSource}
            </p>
          ) : null}
          <p className="mt-1 text-muted-foreground">
            Direct Delivery Demo matches the highest-priority rule for the payload — if you are
            editing a different rule in Delivery Config (e.g. utm_campaign vs campaign_id), compare
            match type here.
          </p>
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
        <dt className="text-muted-foreground">Plan type</dt>
        <dd className="font-mono">{result.planType ?? "—"}</dd>
        <dt className="text-muted-foreground">Plan path</dt>
        <dd className="font-mono">{result.planPath ?? "—"}</dd>
        <dt className="text-muted-foreground">Plan status</dt>
        <dd>{result.deliveryPlanStatus ?? "—"}</dd>
        {result.missingConfigFields.length > 0 ? (
          <>
            <dt className="text-muted-foreground">Missing config</dt>
            <dd className="break-words">{result.missingConfigFields.join(", ")}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Adapter mode</dt>
        <dd className="font-mono">{result.adapterMode ?? "—"}</dd>
        {result.sourceLaneLabel ? (
          <>
            <dt className="text-muted-foreground">Source lane</dt>
            <dd>{result.sourceLaneLabel}</dd>
          </>
        ) : null}
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
          <p className="font-medium">Canary readiness</p>
          <p>
            {directCanaryReadinessLabel(result.readiness.readyForDirectCanary)}
            {result.readiness.canDeliverLive ? " · Full delivery config OK" : ""}
          </p>
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
      {result.nextAction && !showLiveCanarySuccess ? (
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

export function DirectDeliveryDemoPanel({
  adminBuild,
  initialApiBuild,
}: {
  adminBuild: BuildVersionDisplay;
  initialApiBuild: BuildVersionDisplay | null;
}) {
  const [raw, setRaw] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DirectDemoDeliveryViewModel | null>(null);
  const [detailSteps, setDetailSteps] = useState<DirectDemoLiveRunStepSummary[] | null>(null);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [apiBuild, setApiBuild] = useState<BuildVersionDisplay | null>(initialApiBuild);
  const [runtimeModeLiveCanary, setRuntimeModeLiveCanary] = useState(false);
  const [pending, startTransition] = useTransition();

  const liveEnabled = useMemo(
    () => confirmation.trim() === DIRECT_DEMO_LIVE_CONFIRMATION_TEXT,
    [confirmation]
  );

  const payloadInfo = useMemo(() => {
    if (!raw.trim()) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { parseError: true as const };
    }
    const validation = validateDirectDemoPayload(parsed);
    return {
      parseError: false as const,
      sourceLabel: describeDirectDemoPayloadSource(parsed),
      destinationClientAccountId: validation.destinationClientAccountId,
      destinationLocationIdGhl: validation.destinationLocationIdGhl,
      nicheMismatch: detectDirectDemoNicheWorkflowMismatch(parsed),
      valid: validation.ok,
      errors: validation.errors,
    };
  }, [raw]);

  async function loadLiveRunDetails(liveRunId: string) {
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await loadDirectDemoLiveRunDetailAction(liveRunId);
      if (!res.ok) {
        setDetailError(res.error);
        return;
      }
      setDetailSteps(res.stepSummary);
      setDetailContactId(res.contactIdGhl);
      if (res.apiBuildVersion && result) {
        setResult({ ...result, apiBuildVersion: res.apiBuildVersion });
      }
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    setDetailSteps(null);
    setDetailContactId(null);
    setDetailError(null);
    if (!result?.liveRunId || result.mode !== "live_canary") return;
    if (result.liveRunStepSummary.length > 0 && result.contactIdGhl) return;
    void loadLiveRunDetails(result.liveRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when liveRunId changes only
  }, [result?.liveRunId, result?.mode]);

  useEffect(() => {
    void loadDeliveryRuntimeModeAction().then((res) => {
      if (!res.ok || !res.status) return;
      setRuntimeModeLiveCanary(res.status.effectiveMode === "live_canary");
    });
  }, [result?.liveRunId, result?.mode]);

  function run(mode: "simulate" | "live_canary") {
    setError(null);
    setResult(null);
    setDetailSteps(null);
    setDetailContactId(null);
    setDetailError(null);

    // Local validation before sending to the API — invalid demo payloads must not create
    // false API failures.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setError("Payload must be valid JSON.");
      return;
    }
    const validation = validateDirectDemoPayload(parsed);
    if (!validation.ok) {
      setError(`Payload validation failed:\n• ${validation.errors.join("\n• ")}`);
      return;
    }
    if (mode === "live_canary") {
      const guard = isDirectDemoLiveDeliveryAllowed(parsed);
      if (!guard.allowed) {
        setError(guard.reason ?? "Live canary is not allowed for this payload.");
        return;
      }
    }

    startTransition(async () => {
      try {
        const res = await runDirectDemoDeliveryAction(raw, mode, confirmation);
        if (!res.ok) {
          setError(res.error);
          if (res.data) setResult(res.data);
          return;
        }
        setResult(res.data);
        if (res.data.apiBuildVersion?.commitShort) {
          setApiBuild({
            commitShort: res.data.apiBuildVersion.commitShort,
            commitSha: res.data.apiBuildVersion.commitSha,
            buildLabel: res.data.apiBuildVersion.buildLabel,
          });
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Unexpected error running direct demo delivery.";
        setError(msg);
      }
    });
  }

  return (
    <div className="space-y-4">
      <DeployVersionsBar adminBuild={adminBuild} apiBuild={apiBuild} />
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

      {payloadInfo ? (
        <div className="space-y-1 rounded-lg border border-border bg-muted/30 p-3 text-xs">
          {payloadInfo.parseError ? (
            <p className="text-destructive">Payload is not valid JSON.</p>
          ) : (
            <>
              <p className="font-medium">{payloadInfo.sourceLabel}</p>
              <dl className="grid grid-cols-[160px_1fr] gap-x-2 gap-y-0.5">
                <dt className="text-muted-foreground">Destination client</dt>
                <dd className="break-all font-mono">{payloadInfo.destinationClientAccountId ?? "—"}</dd>
                <dt className="text-muted-foreground">Destination GHL location</dt>
                <dd className="break-all font-mono">{payloadInfo.destinationLocationIdGhl ?? "—"}</dd>
              </dl>
              {payloadInfo.nicheMismatch ? (
                <p className="text-amber-800 dark:text-amber-200">{payloadInfo.nicheMismatch}</p>
              ) : null}
              {!payloadInfo.valid ? (
                <div className="text-destructive">
                  <p className="font-medium">Payload validation errors:</p>
                  <ul className="list-disc pl-4">
                    {payloadInfo.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm font-medium text-destructive">Live canary (one lead)</p>
        <p className="text-xs text-muted-foreground">
          Requires effective runtime mode <span className="font-mono">live_canary</span> (enable via
          Delivery runtime mode panel above; env must allow live_canary), direct delivery env
          allowlist, OAuth connection, readiness, and successful simulation.
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
          <ResultCard
            result={result}
            stepSummary={detailSteps ?? result.liveRunStepSummary}
            contactIdGhl={detailContactId ?? result.contactIdGhl ?? result.liveRunFailure?.contactIdGhl ?? null}
            detailLoading={detailLoading}
            detailError={detailError}
            runtimeModeLiveCanary={runtimeModeLiveCanary}
            onLoadLiveRunDetails={() => {
              if (result.liveRunId) void loadLiveRunDetails(result.liveRunId);
            }}
          />
        </DirectDemoResultBoundary>
      ) : null}
    </div>
  );
}
