"use client";

import { useState, useTransition } from "react";

import type {
  GhlMirrorApplyResult,
  GhlMirrorPreviewResult,
} from "@/app/actions/channel-profile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  ChannelMirrorApplyResult,
  ChannelMirrorPlan,
  ChannelMirrorSummary,
  ChannelReadinessReport,
  ChannelWriteModeInfo,
} from "@/lib/clients/channel-profile-types";
import { cn } from "@/lib/utils";

export type GhlMirrorCardActions = {
  previewAction: (
    clientAccountId: string,
    subaccountIdGhl?: string | null
  ) => Promise<GhlMirrorPreviewResult>;
  applyAction: (
    clientAccountId: string,
    subaccountIdGhl?: string | null
  ) => Promise<GhlMirrorApplyResult>;
};

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function actionBadgeClass(action: string): string {
  switch (action) {
    case "CREATE":
      return "border-sky-600/40 bg-sky-50 text-sky-900";
    case "UPDATE":
      return "border-amber-600/40 bg-amber-50 text-amber-950";
    case "NOOP":
      return "border-slate-400/40 bg-slate-50 text-slate-700";
    case "SKIP":
      return "border-red-600/40 bg-red-50 text-red-900";
    default:
      return "border-slate-400/40 bg-slate-50 text-slate-600";
  }
}

function resultStatusBadgeClass(status: string): string {
  switch (status) {
    case "live_applied":
      return "border-emerald-600/40 bg-emerald-50 text-emerald-900";
    case "live_partial":
      return "border-amber-600/40 bg-amber-50 text-amber-950";
    case "blocked":
    case "error":
      return "border-red-600/40 bg-red-50 text-red-900";
    default:
      return "border-slate-400/40 bg-slate-50 text-slate-700";
  }
}

export function ClientGhlProfileMirrorCard({
  clientAccountId,
  subaccountIdGhl,
  mirror,
  writeMode,
  readiness,
  lastAppliedAt,
  previewAction,
  applyAction,
}: {
  clientAccountId: string;
  subaccountIdGhl: string | null;
  mirror: ChannelMirrorSummary;
  writeMode: ChannelWriteModeInfo;
  readiness: ChannelReadinessReport;
  lastAppliedAt: string | null;
} & GhlMirrorCardActions) {
  const [plan, setPlan] = useState<ChannelMirrorPlan | null>(null);
  const [applyResult, setApplyResult] = useState<ChannelMirrorApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewPending, startPreview] = useTransition();
  const [applyPending, startApply] = useTransition();

  function onPreview() {
    setError(null);
    setApplyResult(null);
    startPreview(async () => {
      const res = await previewAction(clientAccountId, subaccountIdGhl);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPlan(res.plan);
    });
  }

  function onApply() {
    setError(null);
    startApply(async () => {
      const res = await applyAction(clientAccountId, subaccountIdGhl);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setApplyResult(res.result);
      setPlan(null);
    });
  }

  const missingCustomValues = readiness.missingCustomValues ?? [];
  const liveAllowed = mirror.liveAllowed;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">GHL Profile Mirror</h3>
        <Badge variant="secondary" className="font-mono text-xs">
          mode: {writeMode.effectiveWriteMode}
        </Badge>
        <Badge variant="outline" className="font-mono text-xs">
          env max: {writeMode.maxWriteMode}
        </Badge>
        <Badge
          variant="outline"
          className={cn(
            "w-fit",
            liveAllowed
              ? "border-emerald-600/40 bg-emerald-50 text-emerald-900"
              : "border-slate-400/40 bg-slate-50 text-slate-700"
          )}
        >
          {liveAllowed ? "live writes allowed" : "live writes blocked"}
        </Badge>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        SA360 Admin remains the source of truth. GHL custom values are a workflow-readable mirror.
        This does not update existing leads.
      </p>

      <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Target GHL location</dt>
          <dd className="font-mono text-xs">{mirror.targetLocation ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Readiness</dt>
          <dd>{readiness.status}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last applied</dt>
          <dd className="text-xs">{fmtDate(lastAppliedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Canary / allowlist</dt>
          <dd className="text-xs">
            client {mirror.guardrails.checks.clientAllowlisted ? "✓" : "✗"} · location{" "}
            {mirror.guardrails.checks.locationAllowlisted ? "✓" : "✗"}
          </dd>
        </div>
      </dl>

      {missingCustomValues.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-medium">Missing custom values ({missingCustomValues.length})</p>
          <ul className="mt-1 list-inside list-disc">
            {missingCustomValues.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!liveAllowed && mirror.guardrails.blockers.length > 0 ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <p className="font-medium">Live writes blocked because:</p>
          <ul className="mt-1 list-inside list-disc">
            {mirror.guardrails.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={onPreview} disabled={previewPending}>
          {previewPending ? "Building…" : "Preview GHL Write Plan"}
        </Button>
        <Button type="button" onClick={onApply} disabled={applyPending}>
          {applyPending ? "Applying…" : "Apply Profile to GHL"}
        </Button>
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {applyResult ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn("w-fit", resultStatusBadgeClass(applyResult.resultStatus))}>
              {applyResult.resultStatus}
            </Badge>
            <span className="text-xs text-muted-foreground">
              attempted {applyResult.valuesAttempted} · written {applyResult.valuesWritten} · skipped{" "}
              {applyResult.valuesSkipped}
            </span>
          </div>
          {applyResult.resultStatus === "blocked" && applyResult.errorSummary ? (
            <p className="mt-2 text-xs text-amber-800">{applyResult.errorSummary}</p>
          ) : null}
          <MirrorEntryTable
            entries={applyResult.results.map((r) => ({
              key: r.key,
              intendedValue: r.intendedValue,
              currentValue: r.currentValue,
              action: r.action,
              status: r.status,
            }))}
          />
        </div>
      ) : null}

      {plan ? (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">
            Preview only — no writes performed. {plan.discoveryAvailable ? "" : "(existing values could not be read)"}
          </p>
          <MirrorEntryTable
            entries={plan.entries.map((e) => ({
              key: e.key,
              intendedValue: e.intendedValue,
              currentValue: e.currentValue,
              action: e.action,
              status: null,
            }))}
          />
          {plan.notes.map((n) => (
            <p key={n} className="mt-1 text-xs text-muted-foreground">
              · {n}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MirrorEntryTable({
  entries,
}: {
  entries: Array<{
    key: string;
    intendedValue: string;
    currentValue: string | null;
    action: string;
    status: string | null;
  }>;
}) {
  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
      <table className="w-full text-left text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-2 py-1 font-medium">Custom value</th>
            <th className="px-2 py-1 font-medium">Intended</th>
            <th className="px-2 py-1 font-medium">Current</th>
            <th className="px-2 py-1 font-medium">Action</th>
            {entries.some((e) => e.status) ? <th className="px-2 py-1 font-medium">Result</th> : null}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.key} className="border-t border-slate-100 dark:border-slate-900">
              <td className="px-2 py-1 font-mono">{e.key}</td>
              <td className="px-2 py-1">{e.intendedValue}</td>
              <td className="px-2 py-1 text-muted-foreground">{e.currentValue ?? "—"}</td>
              <td className="px-2 py-1">
                <Badge variant="outline" className={cn("w-fit", actionBadgeClass(e.action))}>
                  {e.action}
                </Badge>
              </td>
              {entries.some((x) => x.status) ? (
                <td className="px-2 py-1 text-muted-foreground">{e.status ?? "—"}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
