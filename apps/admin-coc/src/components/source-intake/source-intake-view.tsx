"use client";

import { useCallback, useState, useTransition } from "react";
import {
  approveSourceLeadAction,
  loadSourceLeadDetailAction,
  rejectSourceLeadAction,
} from "@/app/actions/source-intake";
import type { SourceLeadListItem } from "@/lib/source-intake/types";
import { SOURCE_LEAD_APPROVE_CONFIRMATION } from "@/lib/source-intake/types";
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

export function SourceIntakeView({
  items,
  emptyHint,
}: {
  items: SourceLeadListItem[];
  emptyHint: string | null;
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
    });
  };

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
            <div className="space-y-2 border-t pt-4">
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
                  disabled={pending || confirmation !== SOURCE_LEAD_APPROVE_CONFIRMATION}
                  onClick={() => runApprove("live_canary")}
                >
                  Approve & deliver one lead
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={runReject}>
                  Reject
                </Button>
              </div>
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
