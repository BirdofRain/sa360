"use client";

import { useMemo } from "react";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { normalizeDirectDemoResult } from "@/lib/direct-delivery-demo/normalize-result";
import type {
  DirectDemoDeliveryViewModel,
  DirectDemoLiveRunStepSummary,
} from "@/lib/direct-delivery-demo/types";
import {
  deliveryConfigIncompleteMessage,
  failedDeliveryStep,
  hasLiveDeliveryDetail,
  sa360ContactStepProof,
  SOURCE_LEAD_DELIVERY_STEP_ORDER,
} from "@/lib/source-intake/delivery-result-display";

function stepStatusTone(status: string): string {
  if (status === "succeeded") return "text-emerald-700 dark:text-emerald-400";
  if (status === "failed") return "text-destructive";
  if (status === "optional_failed" || status === "skipped" || status === "partial_success") {
    return "text-amber-700 dark:text-amber-400";
  }
  return "text-muted-foreground";
}

function StepRow({
  label,
  step,
}: {
  label: string;
  step: DirectDemoLiveRunStepSummary | undefined;
}) {
  const status = step?.status ?? "not_attempted";
  return (
    <li className="rounded border border-border/60 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span className={stepStatusTone(status)}>{status}</span>
      </div>
      {step?.httpMethod && step?.httpPath ? (
        <p className="font-mono text-[11px] text-muted-foreground">
          {step.httpMethod} {step.httpPath}
          {step.httpStatus != null ? ` → HTTP ${step.httpStatus}` : ""}
        </p>
      ) : null}
      {step?.errorMessage ? (
        <p className="mt-0.5 break-words text-[11px] text-destructive">{step.errorMessage}</p>
      ) : null}
      {step?.customFieldStampSummary ? (
        <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-200">
          {step.customFieldStampSummary}
        </p>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        SA360 external call: {step?.externalCallExecuted ? "executed" : "not executed"}
        {step?.externalId ? (
          <>
            {" "}
            · ID: <span className="font-mono">{step.externalId}</span>
          </>
        ) : null}
      </p>
      {step?.requestId ? (
        <p className="text-[11px] text-muted-foreground">
          Request ID: <span className="font-mono">{step.requestId}</span>
        </p>
      ) : null}
      {step?.responseBody && (status === "failed" || status === "optional_failed") ? (
        <pre className="mt-1 max-h-28 overflow-auto rounded bg-muted p-1.5 text-[11px]">
          {JSON.stringify(step.responseBody, null, 2)}
        </pre>
      ) : null}
    </li>
  );
}

function FailureBlock({ view }: { view: DirectDemoDeliveryViewModel }) {
  const failure = view.liveRunFailure;
  const failedStep = failedDeliveryStep(view);
  if (!failure && !failedStep) return null;
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
      <p className="font-medium text-destructive">GHL live step failure</p>
      <dl className="mt-2 grid grid-cols-[130px_1fr] gap-x-2 gap-y-1">
        <dt className="text-muted-foreground">Failed step</dt>
        <dd>{failure?.failedStepLabel ?? failedStep?.label ?? "—"}</dd>
        {failure?.httpStatus != null ? (
          <>
            <dt className="text-muted-foreground">HTTP status</dt>
            <dd>{failure.httpStatus}</dd>
          </>
        ) : null}
        {failure?.httpMethod && failure?.httpPath ? (
          <>
            <dt className="text-muted-foreground">Endpoint</dt>
            <dd className="break-all font-mono">
              {failure.httpMethod} {failure.httpPath}
            </dd>
          </>
        ) : null}
        {failure?.errorCode ? (
          <>
            <dt className="text-muted-foreground">Error code</dt>
            <dd className="font-mono">{failure.errorCode}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">GHL error</dt>
        <dd className="break-words">{failure?.errorMessage ?? "—"}</dd>
        {failure?.requestId ? (
          <>
            <dt className="text-muted-foreground">Request ID</dt>
            <dd className="break-all font-mono">{failure.requestId}</dd>
          </>
        ) : null}
        {failure?.requestBodyKeys && failure.requestBodyKeys.length > 0 ? (
          <>
            <dt className="text-muted-foreground">Request keys</dt>
            <dd className="break-all font-mono">{failure.requestBodyKeys.join(", ")}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Partial contact</dt>
        <dd>{failure?.partialContactCreated ? "Yes" : "No"}</dd>
      </dl>
      {failure?.responseBody ? (
        <div className="mt-2">
          <p className="text-[11px] font-medium text-muted-foreground">Sanitized GHL response</p>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-[11px]">
            {JSON.stringify(failure.responseBody, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/** Renders a stored source lead deliveryResultJson with step-level live canary detail. */
export function SourceLeadDeliveryResult({
  deliveryResultJson,
}: {
  deliveryResultJson: unknown;
}) {
  const view = useMemo<DirectDemoDeliveryViewModel | null>(() => {
    if (!deliveryResultJson || typeof deliveryResultJson !== "object") return null;
    return normalizeDirectDemoResult(deliveryResultJson);
  }, [deliveryResultJson]);

  if (!view) return null;
  if (!hasLiveDeliveryDetail(view) && view.ok) return null;

  const configMessage = deliveryConfigIncompleteMessage(view);
  const stepByType = new Map(view.liveRunStepSummary.map((s) => [s.stepType, s]));
  const showSteps = view.liveRunStepSummary.length > 0 || Boolean(view.liveRunId);
  const contactProof = sa360ContactStepProof(view);
  const contactExecutedLabel =
    contactProof.executed === "yes"
      ? "Yes — SA360 executed and GHL confirmed"
      : contactProof.executed === "no"
        ? "No — SA360 attempted but GHL did not confirm success"
        : "Unknown — not proven by this delivery result";

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Live delivery result</p>
        <span className="text-xs text-muted-foreground">
          {view.liveRunStatus ?? (view.ok ? "ok" : "failed")}
        </span>
      </div>

      <WarningBanner tone="warn" title="Possible parallel delivery">
        A legacy/direct LeadCapture.io → GHL workflow may still be active for this form. Contacts or
        opportunities present in GHL may have been created by that direct flow, not SA360. Confirm SA360
        execution from the per-step proof below — do not infer SA360 success from GHL state alone.
      </WarningBanner>

      {view.reason && !view.ok ? (
        <p className="text-xs text-destructive">{view.reason}</p>
      ) : null}

      {configMessage ? (
        <WarningBanner tone="warn" title="Destination delivery config">
          {configMessage}
        </WarningBanner>
      ) : null}

      <div className="rounded-md border p-2 text-xs">
        <p className="font-medium">SA360 contact step proof</p>
        <dl className="mt-1 grid grid-cols-[180px_1fr] gap-x-2 gap-y-1">
          <dt className="text-muted-foreground">SA360 contact step executed?</dt>
          <dd>{contactExecutedLabel}</dd>
          <dt className="text-muted-foreground">Step status</dt>
          <dd>{contactProof.status ?? "—"}</dd>
          <dt className="text-muted-foreground">External call executed</dt>
          <dd>{contactProof.externalCallExecuted ? "yes" : "no"}</dd>
          <dt className="text-muted-foreground">GHL contact ID returned</dt>
          <dd className="break-all font-mono">{contactProof.externalId ?? "—"}</dd>
          {contactProof.httpStatus != null ? (
            <>
              <dt className="text-muted-foreground">Contact HTTP status</dt>
              <dd>{contactProof.httpStatus}</dd>
            </>
          ) : null}
        </dl>
        {contactProof.responseBody ? (
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-1.5 text-[11px]">
            {JSON.stringify(contactProof.responseBody, null, 2)}
          </pre>
        ) : null}
      </div>

      <FailureBlock view={view} />

      {showSteps ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Step-level statuses</p>
          <ul className="space-y-1 text-xs">
            {SOURCE_LEAD_DELIVERY_STEP_ORDER.map(({ stepType, label }) => (
              <StepRow key={stepType} label={label} step={stepByType.get(stepType)} />
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="grid grid-cols-[150px_1fr] gap-x-2 gap-y-1 text-[11px]">
        <dt className="text-muted-foreground">External GHL write</dt>
        <dd>{view.externalCallExecuted ? "attempted" : "none"}</dd>
        <dt className="text-muted-foreground">Live run</dt>
        <dd className="break-all font-mono">{view.liveRunId ?? "—"}</dd>
        <dt className="text-muted-foreground">Delivery plan</dt>
        <dd className="break-all font-mono">{view.deliveryPlanId ?? "—"}</dd>
        <dt className="text-muted-foreground">Plan status</dt>
        <dd>{view.deliveryPlanStatus ?? "—"}</dd>
      </dl>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Raw deliveryResultJson</summary>
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2">
          {JSON.stringify(deliveryResultJson, null, 2)}
        </pre>
      </details>
    </div>
  );
}
