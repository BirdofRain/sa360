"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import {
  approveSourceLeadAction,
  loadSourceLeadDetailAction,
  rejectSourceLeadAction,
  requeueMetaLeadgenFetchAction,
  requeueSourceLeadAction,
} from "@/app/actions/source-intake";
import {
  canRequeueMetaFetch,
  metaFetchBadgeClass,
  sourceClientLabel,
} from "@/lib/source-intake/meta-fetch-presentation";
import { routingAuthorityLabel } from "@/lib/source-intake/routing-authority";
import type { SourceLeadListItem } from "@/lib/source-intake/types";
import { SOURCE_LEAD_APPROVE_CONFIRMATION } from "@/lib/source-intake/types";
import type { DeliveryRuntimeModeStatus } from "@/lib/delivery-runtime-mode/types";
import { useAdminCocCanMutate } from "@/components/auth/admin-coc-access";
import { SourceLeadDeliveryResult } from "@/components/source-intake/source-lead-delivery-result";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function statusBadgeClass(status: string): string {
  if (status.includes("matched") && !status.includes("unmatched")) {
    return "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40";
  }
  if (status.includes("unmatched") || status === "needs_review") {
    return "bg-amber-50 text-amber-950 dark:bg-amber-950/35";
  }
  if (status.includes("failed") || status === "duplicate_blocked" || status === "rejected") {
    return "bg-destructive/15 text-destructive";
  }
  if (status === "delivered") {
    return "bg-violet-50 text-violet-900 dark:bg-violet-950/40";
  }
  return "bg-muted text-muted-foreground";
}

/** A source lead is requeueable when a delivery attempt failed but it is not terminal. */
function canRequeueStatus(status: string | undefined): boolean {
  return status === "delivery_failed";
}
export function SourceIntakeView({
  items,
  emptyHint,
  runtimeMode,
}: {
  items: SourceLeadListItem[];
  emptyHint: string | null;
  runtimeMode?: DeliveryRuntimeModeStatus | null;
}) {
  const canMutate = useAdminCocCanMutate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof loadSourceLeadDetailAction>>["detail"]>(null);
  const [confirmation, setConfirmation] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const openDetail = useCallback((id: string) => {
    setSelectedId(id);
    setActionMessage(null);
    startTransition(async () => {
      const res = await loadSourceLeadDetailAction(id);
      setDetail(res.detail);
      if (res.error) setActionMessage(res.error);
    });
  }, []);

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
    setConfirmation("");
    setActionMessage(null);
  };

  const runApprove = (mode: "simulate" | "live_canary") => {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await approveSourceLeadAction(selectedId, mode, confirmation);
      setActionMessage(res.ok ? (res.summary ?? "Approved.") : res.error ?? "Failed.");
      // Always refresh so updated status and deliveryResultJson (incl. failed
      // step details) render, even when the delivery attempt failed.
      const refreshed = await loadSourceLeadDetailAction(selectedId);
      setDetail(refreshed.detail);
    });
  };

  const runReject = () => {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await rejectSourceLeadAction(selectedId);
      setActionMessage(res.ok ? "Rejected." : res.error ?? "Failed.");
      if (res.ok) {
        const refreshed = await loadSourceLeadDetailAction(selectedId);
        setDetail(refreshed.detail);
      }
    });
  };

  const runRequeue = () => {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await requeueSourceLeadAction(selectedId);
      // Requeue only resets routing status — it never auto-runs delivery.
      setActionMessage(
        res.ok
          ? `Requeued to ${res.status ?? "routing"} — review, then approve again.`
          : res.error ?? "Requeue failed."
      );
      if (res.ok) {
        const refreshed = await loadSourceLeadDetailAction(selectedId);
        setDetail(refreshed.detail);
      }
    });
  };

  const runRequeueMetaFetch = () => {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await requeueMetaLeadgenFetchAction(selectedId);
      // Requeue re-runs capture only (Graph fetch + association). No routing or delivery.
      setActionMessage(
        res.ok
          ? `Meta Graph fetch requeued (job ${res.jobId ?? "queued"}). Refresh in a minute to see the result.`
          : res.error ?? "Meta Graph requeue failed."
      );
      if (res.ok) {
        const refreshed = await loadSourceLeadDetailAction(selectedId);
        setDetail(refreshed.detail);
      }
    });
  };

  const effectiveMode = runtimeMode?.effectiveMode ?? "simulate";
  const maxMode = runtimeMode?.maxAllowedMode ?? "simulate";
  const canRunLive = Boolean(runtimeMode?.canRunLiveCanary) && effectiveMode === "live_canary";
  const showSwitchHint = maxMode === "live_canary" && effectiveMode !== "live_canary";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>System</TableHead>
              <TableHead>Route key</TableHead>
              <TableHead>Lead</TableHead>
              <TableHead>Source client</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground">
                  {emptyHint ?? "No source leads."}
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => openDetail(row.id)}
                >
                  <TableCell className="whitespace-nowrap text-xs">{formatTime(row.receivedAt)}</TableCell>
                  <TableCell>{row.sourceProvider}</TableCell>
                  <TableCell className="text-xs">{row.sourceSystem}</TableCell>
                  <TableCell className="font-mono text-xs">{row.sourceRouteKey ?? "—"}</TableCell>
                  <TableCell>
                    <div className="text-sm">{row.leadName ?? row.sourceLeadId ?? "—"}</div>
                    {row.phone || row.email ? (
                      <div className="text-xs text-muted-foreground">{row.phone ?? row.email}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs" data-testid="source-client-cell">
                    {sourceClientLabel(row)}
                    {row.captureOnly && row.intakeMethod ? (
                      <div className="font-mono text-muted-foreground">{row.intakeMethod}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs" data-testid="destination-cell">
                    {row.destinationClientAccountId ?? "—"}
                    {row.destinationLocationIdGhl ? (
                      <div className="font-mono text-muted-foreground">{row.destinationLocationIdGhl}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-xs", statusBadgeClass(row.status))}>
                      {row.captureOnly ? "captured" : row.matched ? "matched" : "unmatched"} · {row.status}
                    </Badge>
                    {row.sourceSystem === "meta_lead_ads" && row.metaLeadgenFetch?.state && !row.captureOnly ? (
                      <div className="mt-1">
                        <Badge
                          variant="outline"
                          className={cn("text-[10px]", metaFetchBadgeClass(row.metaLeadgenFetch.state))}
                        >
                          graph · {row.metaLeadgenFetch.state}
                        </Badge>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {selectedId && detail ? (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l bg-background shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-semibold">Source lead detail</h2>
            <Button variant="ghost" size="sm" onClick={closeDetail}>
              Close
            </Button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">ID</p>
              <p className="font-mono text-xs break-all">{detail.id}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-xs">
              <div>
                <span className="text-muted-foreground">Matched</span>
                <p data-testid="detail-routing-matched">{detail.matched ? "yes" : "no"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Status</span>
                <p>{detail.status}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Authority</span>
                <p data-testid="detail-routing-authority">
                  {routingAuthorityLabel(detail.routingAuthority)}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Rule</span>
                <p className="font-mono">{detail.matchedRuleId ?? "—"}</p>
              </div>
            </div>
            {detail.sourceSystem === "meta_lead_ads" ? (
              <div className="space-y-2 rounded-lg border p-3" data-testid="meta-graph-fetch">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">Meta Graph fetch</p>
                  <Badge
                    variant="outline"
                    className={cn("text-xs", metaFetchBadgeClass(detail.metaLeadgenFetch?.state))}
                  >
                    {detail.metaLeadgenFetch?.state ?? (detail.captureOnly ? "captured" : "not queued")}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Graph outcome</span>
                    <p>
                      {detail.metaLeadgenFetch?.graphOutcome ?? "—"}
                      {detail.metaLeadgenFetch?.graphStatus ? ` (HTTP ${detail.metaLeadgenFetch.graphStatus})` : ""}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Attempt</span>
                    <p>{detail.metaLeadgenFetch?.attempt ?? "—"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Token scope</span>
                    <p>{detail.metaLeadgenFetch?.tokenScope ?? "—"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Job</span>
                    <p className="font-mono break-all">{detail.metaLeadgenFetch?.jobId ?? "—"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Queued</span>
                    <p>{detail.metaLeadgenFetch?.queuedAt ? formatTime(detail.metaLeadgenFetch.queuedAt) : "—"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Finished</span>
                    <p>
                      {detail.metaLeadgenFetch?.fetchFinishedAt
                        ? formatTime(detail.metaLeadgenFetch.fetchFinishedAt)
                        : "—"}
                    </p>
                  </div>
                </div>
                {detail.metaLeadgenFetch?.graphErrorCode ? (
                  <p className="text-xs text-muted-foreground">
                    Graph error {detail.metaLeadgenFetch.graphErrorCode}
                    {detail.metaLeadgenFetch.graphErrorMessage ? `: ${detail.metaLeadgenFetch.graphErrorMessage}` : ""}
                  </p>
                ) : null}
                {detail.errorSummary && !detail.captureOnly ? (
                  <p className="text-xs text-muted-foreground">{detail.errorSummary}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Live delivery: no. CAPI dispatch: no. Graph fetch hydrates and associates only.
                </p>
                {canRequeueMetaFetch(detail) ? (
                  canMutate ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={runRequeueMetaFetch}
                      data-testid="requeue-meta-fetch"
                    >
                      Requeue Meta Graph fetch
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">Read-only observer — requeue is unavailable.</p>
                  )
                ) : null}
              </div>
            ) : null}
            {detail.captureReview ? (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="font-medium">Capture, association, inventory, and delivery</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Capture</span>
                    <p>
                      {detail.captureReview.captureOnly ? "Capture only" : "Source event"}
                      {detail.captureReview.intakeMethod ? ` · ${detail.captureReview.intakeMethod}` : ""}
                      {detail.captureReview.originalIntakeMethod &&
                      detail.captureReview.originalIntakeMethod !== detail.captureReview.intakeMethod
                        ? ` (first seen via ${detail.captureReview.originalIntakeMethod})`
                        : ""}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Association</span>
                    <p>{detail.captureReview.associationOutcome ?? "not recorded"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Source client</span>
                    <p data-testid="detail-source-client">{detail.sourceClientAccountId ?? "none"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Delivery destination</span>
                    <p data-testid="detail-destination">{detail.destinationClientAccountId ?? "none"}</p>
                  </div>
                  {detail.captureReview.associationPageId || detail.captureReview.associationFormId ? (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Page / Form</span>
                      <p className="font-mono">
                        {detail.captureReview.associationPageId ?? "—"} / {detail.captureReview.associationFormId ?? "—"}
                      </p>
                    </div>
                  ) : null}
                  <div>
                    <span className="text-muted-foreground">Inventory tracked</span>
                    <p>{detail.captureReview.inventoryTracked ? "yes" : "no"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Sale eligibility</span>
                    <p>
                      {detail.captureReview.inventorySaleEligible === false
                        ? "not eligible"
                        : detail.captureReview.inventorySaleEligible === true
                          ? "eligible"
                          : String(detail.captureReview.inventorySaleEligible ?? "not recorded")}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">This request delivery</span>
                    <p>
                      {detail.captureReview.deliveryThisRequestAttempted === true
                        ? "attempted"
                        : detail.captureReview.deliveryThisRequestAttempted === false
                          ? "not attempted"
                          : "not recorded"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Historical delivery</span>
                    <p>{detail.captureReview.deliveryHistoricalOutcome ?? "not recorded"}</p>
                  </div>
                </div>
                {detail.captureReview.associationExplanation ? (
                  <p className="text-xs text-muted-foreground">
                    {detail.captureReview.associationExplanation}
                  </p>
                ) : null}
                {detail.captureReview.submittedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Submitted {detail.captureReview.submittedAt}. Received{" "}
                    {detail.captureReview.receivedAt ?? "not recorded"}.
                  </p>
                ) : null}
              </div>
            ) : null}
            {detail.rawPayloadJson != null ? (
              <div>
                <p className="mb-1 font-medium">Raw request payload</p>
                <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(detail.rawPayloadJson, null, 2)}
                </pre>
              </div>
            ) : null}
            {detail.normalizedPayloadJson != null ? (
              <div>
                <p className="mb-1 font-medium">Canonical normalized payload</p>
                <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(detail.normalizedPayloadJson, null, 2)}
                </pre>
              </div>
            ) : null}
            <div>
              <p className="mb-1 font-medium">Routing result</p>
              <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(detail.routingResultJson, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-1 font-medium">Duplicate risk</p>
              <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(detail.duplicateRiskJson, null, 2)}
              </pre>
            </div>
            {detail.deliveryResultJson ? (
              <SourceLeadDeliveryResult deliveryResultJson={detail.deliveryResultJson} />
            ) : null}
            {detail.enrichmentPreview ? (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="font-medium">Delivery & enrichment preview</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Delivery eligible</span>
                    <p>{detail.enrichmentPreview.deliveryEligible ? "Eligible" : "Blocked"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Enrichment</span>
                    <p>{detail.enrichmentPreview.enrichmentStatus}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Automation</span>
                    <p>{detail.enrichmentPreview.automationReadiness}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Schema</span>
                    <p>{detail.enrichmentPreview.sourceSchemaStatus}</p>
                  </div>
                </div>
                <ul className="list-inside list-disc text-xs text-muted-foreground">
                  <li>Name: {detail.enrichmentPreview.coreDelivery.namePresent ? "yes" : "no"}</li>
                  <li>Phone: {detail.enrichmentPreview.coreDelivery.phonePresent ? "yes" : "no"}</li>
                  <li>Route matched: {detail.enrichmentPreview.coreDelivery.routeMatched ? "yes" : "no"}</li>
                  <li>Mapped fields: {detail.enrichmentPreview.mappedFieldCount}</li>
                  {detail.enrichmentPreview.missingOptionalFields.length > 0 ? (
                    <li>Missing optional: {detail.enrichmentPreview.missingOptionalFields.join(", ")}</li>
                  ) : null}
                  {detail.enrichmentPreview.unmappedSourceFieldKeys.length > 0 ? (
                    <li>Unmapped: {detail.enrichmentPreview.unmappedSourceFieldKeys.join(", ")}</li>
                  ) : null}
                  <li>
                    Voice AI:{" "}
                    {detail.enrichmentPreview.automation.voiceAiReady
                      ? "ready"
                      : detail.enrichmentPreview.automation.voiceAiLimited
                        ? "limited"
                        : "blocked"}
                  </li>
                </ul>
                {detail.enrichmentPreview.deliveryBlockers.length > 0 ? (
                  <p className="text-xs text-destructive">
                    Blockers: {detail.enrichmentPreview.deliveryBlockers.join("; ")}
                  </p>
                ) : null}
                {detail.enrichmentPreview.deliveryWarnings.length > 0 ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {detail.enrichmentPreview.deliveryWarnings.join("; ")}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="space-y-2 rounded-lg border p-3">
              <p className="font-medium">Runtime delivery mode</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Effective mode</span>
                  <p className="font-mono">{effectiveMode}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Max mode (env)</span>
                  <p className="font-mono">{maxMode}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Live canary writes</span>
                  <p>{canRunLive ? "allowed" : "blocked"}</p>
                </div>
                {runtimeMode?.liveCanaryEnabledUntil ? (
                  <div>
                    <span className="text-muted-foreground">Live window until</span>
                    <p className="text-xs">{runtimeMode.liveCanaryEnabledUntil}</p>
                  </div>
                ) : null}
              </div>
              {showSwitchHint ? (
                <p className="rounded bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/35 dark:text-amber-200">
                  Env allows live_canary, but runtime mode is still simulate. Switch runtime delivery
                  mode to live_canary before live delivery.{" "}
                  <Link href="/direct-delivery-demo" className="underline">
                    Switch runtime mode
                  </Link>
                </p>
              ) : null}
            </div>
            {canMutate ? (
            <div className="space-y-2 border-t pt-4">
              {canRequeueStatus(detail.status) ? (
                <div className="space-y-2 rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 dark:bg-amber-950/20">
                  <p className="text-xs text-amber-900 dark:text-amber-200">
                    This lead is in <span className="font-mono">delivery_failed</span>. Requeue to reset
                    routing status before approving again. Requeue does not auto-deliver.
                  </p>
                  <Button size="sm" variant="outline" disabled={pending} onClick={runRequeue}>
                    Requeue source lead
                  </Button>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Type <span className="font-mono">{SOURCE_LEAD_APPROVE_CONFIRMATION}</span> to approve
              </p>
              <Input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder={SOURCE_LEAD_APPROVE_CONFIRMATION}
                autoComplete="off"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending || confirmation !== SOURCE_LEAD_APPROVE_CONFIRMATION}
                  onClick={() => runApprove("simulate")}
                >
                  Approve simulation only
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={
                    pending || confirmation !== SOURCE_LEAD_APPROVE_CONFIRMATION || !canRunLive
                  }
                  title={
                    canRunLive
                      ? undefined
                      : `Effective runtime mode is ${effectiveMode}. Live delivery requires effective mode live_canary.`
                  }
                  onClick={() => runApprove("live_canary")}
                >
                  Approve & deliver one lead
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={runReject}>
                  Reject
                </Button>
              </div>
              {!canRunLive ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  &ldquo;Approve &amp; deliver one lead&rdquo; is disabled because the effective runtime
                  mode is {effectiveMode}. Use simulation, or switch runtime mode to live_canary.
                </p>
              ) : null}
              {actionMessage ? (
                <p className="text-xs text-muted-foreground">{actionMessage}</p>
              ) : null}
            </div>
            ) : (
              <p className="border-t pt-4 text-xs text-muted-foreground">
                Read-only observer — approve, reject, and requeue are unavailable.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
