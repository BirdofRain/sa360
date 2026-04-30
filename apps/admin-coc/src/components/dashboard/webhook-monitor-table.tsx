"use client";

import { useState } from "react";

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

type WebhookRow = {
  id: string;
  time: string;
  source: string;
  route: string;
  status: "received" | "queued" | "processed" | "skipped" | "failed";
  client: string;
  subaccount: string;
  contact: string;
  event: string;
  knownCaller: string;
  durationMs: number;
  result: string;
};

const MOCK_ROWS: WebhookRow[] = [
  {
    id: "1",
    time: "14:02:11",
    source: "GHL",
    route: "/webhooks/ghl/lifecycle-event",
    status: "queued",
    client: "lal_client_0142",
    subaccount: "loc_…",
    contact: "cnt_…",
    event: "appointment_set",
    knownCaller: "—",
    durationMs: 42,
    result: "ok",
  },
  {
    id: "2",
    time: "14:01:03",
    source: "GHL",
    route: "/webhooks/ghl/lifecycle-event",
    status: "processed",
    client: "demo_client",
    subaccount: "—",
    contact: "cnt_…",
    event: "lead_created",
    knownCaller: "—",
    durationMs: 1180,
    result: "meta dispatched",
  },
];

function statusBadge(status: WebhookRow["status"]) {
  const map: Record<WebhookRow["status"], string> = {
    received: "bg-muted text-muted-foreground",
    queued: "bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-100",
    processed: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
    skipped: "bg-amber-50 text-amber-950 dark:bg-amber-950/35 dark:text-amber-100",
    failed: "bg-destructive/15 text-destructive",
  };
  return map[status];
}

export function WebhookMonitorTable() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<WebhookRow | null>(null);

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
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MOCK_ROWS.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => {
                  setSelected(row);
                  setOpen(true);
                }}
              >
                <TableCell className="font-mono text-xs tabular-nums">{row.time}</TableCell>
                <TableCell>{row.source}</TableCell>
                <TableCell className="max-w-[200px] truncate font-mono text-xs">{row.route}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={statusBadge(row.status)}>
                    {row.status}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[120px] truncate font-mono text-xs">{row.client}</TableCell>
                <TableCell className="font-mono text-xs">{row.subaccount}</TableCell>
                <TableCell className="font-mono text-xs">{row.contact}</TableCell>
                <TableCell className="text-sm">{row.event}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{row.knownCaller}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{row.durationMs}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{row.result}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Mock data for layout. Replace with admin API when `WebhookRequestLog` is available.
      </p>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Request detail</SheetTitle>
            <SheetDescription>
              Summary, redacted payload/response, and related entities will load here.
            </SheetDescription>
          </SheetHeader>
          {selected ? (
            <ScrollArea className="mt-4 flex-1 pr-4">
              <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Time</dt>
                <dd className="font-mono">{selected.time}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <Badge variant="outline" className={statusBadge(selected.status)}>
                    {selected.status}
                  </Badge>
                </dd>
                <dt className="text-muted-foreground">Client</dt>
                <dd className="font-mono text-xs">{selected.client}</dd>
                <dt className="text-muted-foreground">Event</dt>
                <dd>{selected.event}</dd>
              </dl>
              <div className="mt-6 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Payload (redacted)
                </p>
                <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                  {`{\n  "ok": true,\n  "eventUuid": "…",\n  "queued": true\n}`}
                </pre>
              </div>
              <div className="mt-4 flex gap-2">
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
