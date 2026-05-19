"use client";

import { useCallback, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { loadWebhookDetailAction } from "@/app/actions/webhook-detail";
import type { AdminWebhookDetail, AdminWebhookListItem } from "@/lib/admin-api/types";
import { isInvalidWebhookRow } from "@/lib/webhook-monitor-utils";
import type { WebhookReceivedAtSort } from "@/lib/webhook-monitor-utils";
import { WebhookMonitorDetailDrawer } from "@/components/dashboard/webhook-monitor-detail-drawer";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export { isInvalidWebhookRow };

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

const UNKNOWN_LEAD = "Unknown lead";

function displayLeadName(row: Pick<AdminWebhookListItem, "leadName">): string {
  return row.leadName?.trim() || UNKNOWN_LEAD;
}

function displayEvent(row: Pick<AdminWebhookListItem, "eventNameInternal" | "eventUuid">): string {
  return row.eventNameInternal ?? row.eventUuid ?? "—";
}

function cellOrDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

const TABLE_COLUMN_COUNT = 16;

function statusBadgeClass(processingStatus: string): string {
  const s = processingStatus.toLowerCase();
  if (isInvalidWebhookRow(processingStatus)) {
    return "border-destructive/60 bg-destructive/15 text-destructive dark:bg-destructive/25";
  }
  if (s.includes("fail") || s.includes("error")) return "bg-destructive/15 text-destructive";
  if (s.includes("skip")) return "bg-amber-50 text-amber-950 dark:bg-amber-950/35 dark:text-amber-100";
  if (s.includes("queued") || s.includes("stored") || s.includes("duplicate") || s.includes("processed")) {
    return "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100";
  }
  return "bg-muted text-muted-foreground";
}

function rowClassName(processingStatus: string): string {
  if (!isInvalidWebhookRow(processingStatus)) return "cursor-pointer";
  return "cursor-pointer bg-destructive/10 hover:bg-destructive/[0.16] dark:bg-destructive/20 dark:hover:bg-destructive/25";
}

function TimeSortHeader({
  sortDirection,
  onToggleSort,
}: {
  sortDirection: WebhookReceivedAtSort;
  onToggleSort: () => void;
}) {
  const Icon = sortDirection === "desc" ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
      onClick={onToggleSort}
      title={sortDirection === "desc" ? "Newest first — click for oldest first" : "Oldest first — click for newest first"}
    >
      Time
      <Icon className="size-3.5 opacity-70" aria-hidden />
      <span className="sr-only">
        {sortDirection === "desc" ? "sorted newest first" : "sorted oldest first"}
      </span>
    </button>
  );
}

export function WebhookMonitorTable({
  items,
  sortDirection = "desc",
  onToggleSort,
  emptyHint,
}: {
  items: AdminWebhookListItem[];
  sortDirection?: WebhookReceivedAtSort;
  onToggleSort?: () => void;
  emptyHint?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<AdminWebhookListItem | null>(null);
  const [detail, setDetail] = useState<AdminWebhookDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadDetail = useCallback(async (row: AdminWebhookListItem) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    const res = await loadWebhookDetailAction(row.id);
    setDetailLoading(false);
    if (res.error) {
      setDetailError(res.error);
      return;
    }
    setDetail(res.detail);
  }, []);

  async function onOpenRow(row: AdminWebhookListItem) {
    setSelected(row);
    setOpen(true);
    await loadDetail(row);
  }

  async function onJumpToRequest(webhookLogId: string) {
    const row = items.find((item) => item.id === webhookLogId);
    if (row) await onOpenRow(row);
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table className="min-w-[1280px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="sticky left-0 z-10 w-[108px] bg-card">
                {onToggleSort ? (
                  <TimeSortHeader sortDirection={sortDirection} onToggleSort={onToggleSort} />
                ) : (
                  "Time"
                )}
              </TableHead>
              <TableHead className="min-w-[120px]">Event</TableHead>
              <TableHead className="min-w-[120px]">Lead</TableHead>
              <TableHead className="min-w-[96px]">Client</TableHead>
              <TableHead className="min-w-[96px]">Subaccount</TableHead>
              <TableHead className="min-w-[100px]">Validity</TableHead>
              <TableHead className="min-w-[100px]">Status</TableHead>
              <TableHead className="min-w-[140px]">Route</TableHead>
              <TableHead className="min-w-[96px]">Contact</TableHead>
              <TableHead className="min-w-[88px]">error_code</TableHead>
              <TableHead className="min-w-[140px]">error_summary</TableHead>
              <TableHead className="min-w-[52px] text-right">ms</TableHead>
              <TableHead className="min-w-[52px]">HTTP</TableHead>
              <TableHead className="min-w-[120px]">request_id</TableHead>
              <TableHead className="min-w-[108px]">Phone</TableHead>
              <TableHead className="min-w-[140px]">Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={TABLE_COLUMN_COUNT} className="h-24 text-center text-sm text-muted-foreground">
                  {emptyHint ?? "No rows."}
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => (
                <TableRow
                  key={row.id}
                  className={rowClassName(row.processingStatus)}
                  onClick={() => onOpenRow(row)}
                >
                  <TableCell className="sticky left-0 z-10 bg-inherit font-mono text-xs tabular-nums">
                    {formatTime(row.receivedAt)}
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-sm" title={displayEvent(row)}>
                    {displayEvent(row)}
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate text-sm" title={displayLeadName(row)}>
                    {displayLeadName(row)}
                  </TableCell>
                  <TableCell
                    className="max-w-[120px] truncate font-mono text-xs"
                    title={row.clientAccountId ?? undefined}
                  >
                    {cellOrDash(row.clientAccountId)}
                  </TableCell>
                  <TableCell
                    className="max-w-[100px] truncate font-mono text-xs"
                    title={row.subaccountIdGhl ?? undefined}
                  >
                    {cellOrDash(row.subaccountIdGhl)}
                  </TableCell>
                  <TableCell className="align-top">
                    {isInvalidWebhookRow(row.processingStatus) ? (
                      <div className="flex max-w-[200px] flex-col gap-1">
                        <Badge variant="destructive" className="w-fit shrink-0">
                          Invalid webhook
                        </Badge>
                        <span
                          className="line-clamp-2 text-[11px] leading-snug text-destructive"
                          title={row.errorSummary ?? undefined}
                        >
                          {row.errorSummary ?? "Bad input or authentication failed."}
                        </span>
                      </div>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-emerald-600/35 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-100"
                      >
                        Valid
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {isInvalidWebhookRow(row.processingStatus) ? (
                        <Badge variant="destructive" className="w-fit">
                          ERROR
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className={cn("w-fit", statusBadgeClass(row.processingStatus))}>
                        {row.processingStatus}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate font-mono text-xs" title={row.route}>
                    {cellOrDash(row.route)}
                  </TableCell>
                  <TableCell
                    className="max-w-[100px] truncate font-mono text-xs"
                    title={row.contactIdGhl ?? undefined}
                  >
                    {cellOrDash(row.contactIdGhl)}
                  </TableCell>
                  <TableCell
                    className="max-w-[100px] truncate font-mono text-xs"
                    title={row.errorCode ?? undefined}
                  >
                    {cellOrDash(row.errorCode)}
                  </TableCell>
                  <TableCell
                    className="max-w-[200px] truncate text-xs text-destructive"
                    title={row.errorSummary ?? undefined}
                  >
                    {cellOrDash(row.errorSummary)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {cellOrDash(row.durationMs)}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">{cellOrDash(row.httpStatus)}</TableCell>
                  <TableCell className="max-w-[140px] truncate font-mono text-xs" title={row.requestId}>
                    {cellOrDash(row.requestId)}
                  </TableCell>
                  <TableCell
                    className="max-w-[120px] truncate font-mono text-xs"
                    title={row.leadPhone ?? undefined}
                  >
                    {cellOrDash(row.leadPhone)}
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-xs" title={row.leadEmail ?? undefined}>
                    {cellOrDash(row.leadEmail)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Newest requests first by default. Row click loads redacted detail via{" "}
        <span className="font-mono">GET /admin/v1/coc/webhook-requests/:id</span>.
      </p>

      <WebhookMonitorDetailDrawer
        open={open}
        onOpenChange={setOpen}
        selected={selected}
        detail={detail}
        detailLoading={detailLoading}
        detailError={detailError}
        onReload={() => selected && loadDetail(selected)}
        onOpenRequest={onJumpToRequest}
      />
    </>
  );
}
