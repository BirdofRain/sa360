"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import {
  approveSourceLeadAction,
  loadSourceLeadDetailAction,
  rejectSourceLeadAction,
  requeueSourceLeadAction,
} from "@/app/actions/source-intake";
import type { SourceLeadListItem } from "@/lib/source-intake/types";
import { SOURCE_LEAD_APPROVE_CONFIRMATION } from "@/lib/source-intake/types";
import type { DeliveryRuntimeModeStatus } from "@/lib/delivery-runtime-mode/types";
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
      if (res.ok) {
        const refreshed = await loadSourceLeadDetailAction(selectedId);
        setDetail(refreshed.detail);
      }
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
              <TableHead>Destination</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
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
                    <div className="text-sm">{row.leadName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{row.phone ?? row.email ?? ""}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.destinationClientAccountId ?? "—"}
                    {row.destinationLocationIdGhl ? (
                      <div className="font-mono text-muted-foreground">{row.destinationLocationIdGhl}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-xs", statusBadgeClass(row.status))}>
                      {row.matched ? "matched" : "unmatched"} · {row.status}
                    </Badge>
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
            <div>
              <p className="mb-1 font-medium">Raw payload</p>
              <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(detail.rawPayloadJson, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-1 font-medium">Normalized payload</p>
              <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(detail.normalizedPayloadJson, null, 2)}
              </pre>
            </div>
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
