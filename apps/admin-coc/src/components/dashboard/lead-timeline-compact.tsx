"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, ExternalLink, Loader2 } from "lucide-react";

import { loadLeadTimelineAction } from "@/app/actions/lead-timeline";
import type { AdminLeadTimelineEntry, AdminLeadTimelineResponse } from "@/lib/admin-api/types";
import { copyTextToClipboard } from "@/lib/webhook-monitor-detail.utils";
import { isInvalidWebhookRow } from "@/lib/webhook-monitor-utils";
import type { LeadTimelineFetchParams } from "@/lib/lead-timeline-query";
import { leadTimelinePageHref } from "@/lib/lead-timeline-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

function validityBadge(validity: "valid" | "invalid") {
  if (validity === "invalid") {
    return <Badge variant="destructive">invalid</Badge>;
  }
  return (
    <Badge variant="outline" className="border-emerald-600/35 text-emerald-900 dark:text-emerald-100">
      valid
    </Badge>
  );
}

function TimelineRowActions({
  row,
  onOpenRequest,
}: {
  row: AdminLeadTimelineEntry;
  onOpenRequest?: (webhookLogId: string) => void;
}) {
  const [copied, setCopied] = useState<"event" | "request" | null>(null);

  const copy = async (text: string | null | undefined, kind: "event" | "request") => {
    if (!text?.trim()) return;
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1500);
    }
  };

  return (
    <div className="flex flex-wrap justify-end gap-1">
      {row.webhookLogId && onOpenRequest ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => onOpenRequest(row.webhookLogId!)}
        >
          Open request
        </Button>
      ) : null}
      {row.eventUuid ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-1.5"
          title="Copy event UUID"
          onClick={() => copy(row.eventUuid, "event")}
        >
          <Copy className="size-3" />
          <span className="sr-only">{copied === "event" ? "Copied" : "Copy event UUID"}</span>
        </Button>
      ) : null}
      {row.requestId ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-1.5"
          title="Copy request ID"
          onClick={() => copy(row.requestId, "request")}
        >
          <Copy className="size-3" />
          <span className="sr-only">{copied === "request" ? "Copied" : "Copy request ID"}</span>
        </Button>
      ) : null}
    </div>
  );
}

export function RelatedLeadTimelineSection({
  anchor,
  onOpenRequest,
}: {
  anchor: LeadTimelineFetchParams | null;
  onOpenRequest?: (webhookLogId: string) => void;
}) {
  const [data, setData] = useState<AdminLeadTimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!anchor?.requestId && !anchor?.leadUid && !anchor?.contactIdGhl) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadLeadTimelineAction({ ...anchor, sort: "asc", limit: 80 }).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.error) {
        setError(res.error);
        setData(null);
        return;
      }
      setData(res.timeline);
    });
    return () => {
      cancelled = true;
    };
  }, [anchor]);

  const fullPageHref = anchor ? leadTimelinePageHref(anchor) : "/lead-timeline";

  return (
    <section className="rounded-lg border border-border bg-card/50 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Related Lead Timeline
        </h3>
        <Link
          href={fullPageHref}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Full timeline
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Loading related events…
        </div>
      ) : null}

      {error ? (
        <p className="py-2 text-xs text-destructive">{error}</p>
      ) : null}

      {!loading && !error && data && data.timeline.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">
          No related lead events found yet. This may mean the lead_created signal failed, used a
          different lead_uid/client, or is outside the current scope.
        </p>
      ) : null}

      {!loading && !error && data && data.timeline.length > 0 ? (
        <div className="max-h-[280px] overflow-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[11px]">Time</TableHead>
                <TableHead className="text-[11px]">Event</TableHead>
                <TableHead className="text-[11px]">Status</TableHead>
                <TableHead className="text-[11px]">Validity</TableHead>
                <TableHead className="text-[11px]">HTTP</TableHead>
                <TableHead className="text-[11px]">Error</TableHead>
                <TableHead className="text-right text-[11px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.timeline.map((row) => (
                <TableRow
                  key={`${row.sourceTable}:${row.id}`}
                  className={
                    isInvalidWebhookRow(row.processingStatus) ? "bg-destructive/5" : undefined
                  }
                >
                  <TableCell className="whitespace-nowrap text-[11px] tabular-nums">
                    {formatTime(row.receivedAt)}
                  </TableCell>
                  <TableCell className="max-w-[120px] truncate font-mono text-[11px]">
                    {row.eventNameInternal ?? row.source}
                  </TableCell>
                  <TableCell className="max-w-[100px] truncate text-[11px]">
                    {row.processingStatus}
                  </TableCell>
                  <TableCell>{validityBadge(row.validity)}</TableCell>
                  <TableCell className="font-mono text-[11px] tabular-nums">
                    {row.httpStatus ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate text-[11px] text-destructive">
                    {row.errorSummary ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <TimelineRowActions row={row} onOpenRequest={onOpenRequest} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </section>
  );
}
