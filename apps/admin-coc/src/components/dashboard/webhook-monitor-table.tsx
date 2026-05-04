"use client";

import { useState } from "react";

import type { AdminWebhookListItem } from "@/lib/admin-api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function statusBadgeClass(processingStatus: string): string {
  const s = processingStatus.toLowerCase();
  if (s.includes("fail") || s.includes("error")) return "bg-destructive/15 text-destructive";
  if (s.includes("skip")) return "bg-amber-50 text-amber-950 dark:bg-amber-950/35 dark:text-amber-100";
  if (s.includes("queued") || s.includes("stored") || s.includes("duplicate") || s.includes("processed")) {
    return "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100";
  }
  return "bg-muted text-muted-foreground";
}

export function WebhookMonitorTable({
  items,
  emptyHint,
}: {
  items: AdminWebhookListItem[];
  emptyHint?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<AdminWebhookListItem | null>(null);

  return (
    <>
      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[100px]">Time</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="min-w-[140px]">Route</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Subaccount</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Known caller</TableHead>
              <TableHead className="text-right">ms</TableHead>
              <TableHead>HTTP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="h-24 text-center text-sm text-muted-foreground">
                  {emptyHint ?? "No rows."}
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => {
                    setSelected(row);
                    setOpen(true);
                  }}
                >
                  <TableCell className="font-mono text-xs tabular-nums">{formatTime(row.receivedAt)}</TableCell>
                  <TableCell className="text-sm">{row.source}</TableCell>
                  <TableCell className="max-w-[200px] truncate font-mono text-xs">{row.route}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass(row.processingStatus)}>
                      {row.processingStatus}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[120px] truncate font-mono text-xs">
                    {row.clientAccountId ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[100px] truncate font-mono text-xs">
                    {row.subaccountIdGhl ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[100px] truncate font-mono text-xs">
                    {row.contactIdGhl ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">{row.eventNameInternal ?? row.eventUuid ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">—</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {row.durationMs ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">{row.httpStatus ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Data from <span className="font-mono">GET /admin/v1/webhook-requests</span>.
      </p>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Request detail</SheetTitle>
            <SheetDescription>
              Row fields from the admin API list payload (payload bodies use the detail endpoint when available).
            </SheetDescription>
          </SheetHeader>
          {selected ? (
            <ScrollArea className="mt-4 flex-1 pr-4">
              <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">request_id</dt>
                <dd className="break-all font-mono text-xs">{selected.requestId}</dd>
                <dt className="text-muted-foreground">Time</dt>
                <dd className="font-mono text-xs">{formatTime(selected.receivedAt)}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <Badge variant="outline" className={statusBadgeClass(selected.processingStatus)}>
                    {selected.processingStatus}
                  </Badge>
                </dd>
                <dt className="text-muted-foreground">Client</dt>
                <dd className="font-mono text-xs">{selected.clientAccountId ?? "—"}</dd>
                <dt className="text-muted-foreground">Event</dt>
                <dd>{selected.eventNameInternal ?? "—"}</dd>
                <dt className="text-muted-foreground">error_code</dt>
                <dd className="font-mono text-xs">{selected.errorCode ?? "—"}</dd>
                <dt className="text-muted-foreground">error_summary</dt>
                <dd className="text-xs">{selected.errorSummary ?? "—"}</dd>
              </dl>
              <div className="mt-6 flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled>
                  Copy cURL
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled>
                  Replay
                </Button>
              </div>
            </ScrollArea>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
