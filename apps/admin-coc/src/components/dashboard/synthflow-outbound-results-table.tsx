"use client";

import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";

import type {
  AdminSynthflowOutboundResultDetail,
  AdminSynthflowOutboundResultListItem,
} from "@/lib/admin-api/types";
import { loadSynthflowOutboundDetailAction } from "@/app/actions/synthflow-outbound-detail";
import {
  bookedBadgeClasses,
  getOutboundOutcomeTone,
  outcomeToneClasses,
} from "@/lib/synthflow-outbound-outcome-badges";
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
import { JsonPre } from "@/components/dashboard/synthflow-json-blocks";

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

function OutcomeBadge({ outcome }: { outcome: string }) {
  const tone = getOutboundOutcomeTone(outcome);
  return (
    <span
      className={`inline-flex max-w-full truncate rounded-md border px-2 py-0.5 font-mono text-xs ${outcomeToneClasses(tone)}`}
      title={outcome}
    >
      {outcome || "—"}
    </span>
  );
}

export function SynthflowOutboundResultsTable({
  items,
  emptyHint,
}: {
  items: AdminSynthflowOutboundResultListItem[];
  emptyHint?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [selectedList, setSelectedList] = useState<AdminSynthflowOutboundResultListItem | null>(null);
  const [detail, setDetail] = useState<AdminSynthflowOutboundResultDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadDetail = useCallback(async (row: AdminSynthflowOutboundResultListItem) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    const res = await loadSynthflowOutboundDetailAction(row.id);
    setDetailLoading(false);
    if (res.error) {
      setDetailError(res.error);
      return;
    }
    setDetail(res.detail);
  }, []);

  async function onOpenRow(row: AdminSynthflowOutboundResultListItem) {
    setSelectedList(row);
    setOpen(true);
    await loadDetail(row);
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="whitespace-nowrap">receivedAt</TableHead>
              <TableHead className="whitespace-nowrap">outcome</TableHead>
              <TableHead className="whitespace-nowrap">booked</TableHead>
              <TableHead className="whitespace-nowrap">appointmentTime</TableHead>
              <TableHead className="whitespace-nowrap">callId</TableHead>
              <TableHead className="whitespace-nowrap">fromNumber</TableHead>
              <TableHead className="whitespace-nowrap">toNumber</TableHead>
              <TableHead className="whitespace-nowrap">clientAccountId</TableHead>
              <TableHead className="whitespace-nowrap">contactIdGhl</TableHead>
              <TableHead className="whitespace-nowrap">modelId</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-28 text-center text-sm text-slate-500">
                  {emptyHint ?? "No rows."}
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => onOpenRow(row)}
                >
                  <TableCell className="whitespace-nowrap font-mono text-xs">{formatTime(row.receivedAt)}</TableCell>
                  <TableCell className="max-w-[200px]">
                    <OutcomeBadge outcome={row.outcome} />
                  </TableCell>
                  <TableCell className="text-xs">
                    <span
                      className={`inline-flex rounded-md border px-2 py-0.5 font-medium ${bookedBadgeClasses(row.booked)}`}
                    >
                      {row.booked ? "Yes" : "No"}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {row.appointmentTime ? formatTime(row.appointmentTime) : "—"}
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate font-mono text-xs">{row.callId}</TableCell>
                  <TableCell className="max-w-[120px] truncate font-mono text-xs">{row.fromNumber ?? "—"}</TableCell>
                  <TableCell className="max-w-[120px] truncate font-mono text-xs">{row.toNumber ?? "—"}</TableCell>
                  <TableCell className="max-w-[120px] truncate font-mono text-xs">{row.clientAccountId ?? "—"}</TableCell>
                  <TableCell className="max-w-[100px] truncate font-mono text-xs">{row.contactIdGhl ?? "—"}</TableCell>
                  <TableCell className="max-w-[140px] truncate font-mono text-xs">{row.modelId ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="mt-2 text-xs text-slate-400">
        Data from <span className="font-mono">GET /admin/v1/coc/synthflow-outbound-results</span>. Row click loads detail via{" "}
        <span className="font-mono">GET /admin/v1/coc/synthflow-outbound-results/:id</span> (server-side).
      </p>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Outbound call result</SheetTitle>
            <SheetDescription className="text-left">
              Outcome and redacted payload from Synthflow outbound-result ingestion. No call duration is stored on this log row.
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="mt-4 flex-1 pr-4">
            {detailLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading detail…
              </div>
            ) : detailError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {detailError}
              </div>
            ) : detail && selectedList ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1">
                  <OutcomeBadge outcome={detail.outcome} />
                  <Badge
                    variant="outline"
                    className={`font-normal ${bookedBadgeClasses(detail.booked)} border`}
                  >
                    {detail.booked ? "Booked" : "Not booked"}
                  </Badge>
                </div>
                <dl className="grid grid-cols-[120px_1fr] gap-x-2 gap-y-2 text-sm">
                  <dt className="text-slate-500">callId</dt>
                  <dd className="break-all font-mono text-xs">{detail.callId}</dd>
                  <dt className="text-slate-500">outcome</dt>
                  <dd className="font-mono text-xs">{detail.outcome}</dd>
                  <dt className="text-slate-500">booked</dt>
                  <dd>{detail.booked ? "true" : "false"}</dd>
                  <dt className="text-slate-500">appointmentTime</dt>
                  <dd className="font-mono text-xs">{detail.appointmentTime ? formatTime(detail.appointmentTime) : "—"}</dd>
                  <dt className="text-slate-500">transcriptSummary</dt>
                  <dd className="text-xs leading-relaxed text-slate-800">{detail.transcriptSummary ?? "—"}</dd>
                  <dt className="text-slate-500">modelId</dt>
                  <dd className="break-all font-mono text-xs">{detail.modelId ?? "—"}</dd>
                  <dt className="text-slate-500">requestId</dt>
                  <dd className="break-all font-mono text-xs">{detail.requestId ?? "—"}</dd>
                  <dt className="text-slate-500">clientAccountId</dt>
                  <dd className="break-all font-mono text-xs">{detail.clientAccountId ?? "—"}</dd>
                  <dt className="text-slate-500">subaccountIdGhl</dt>
                  <dd className="break-all font-mono text-xs">{detail.subaccountIdGhl ?? "—"}</dd>
                  <dt className="text-slate-500">contactIdGhl</dt>
                  <dd className="break-all font-mono text-xs">{detail.contactIdGhl ?? "—"}</dd>
                  <dt className="text-slate-500">fromNumber</dt>
                  <dd className="font-mono text-xs">{detail.fromNumber ?? "—"}</dd>
                  <dt className="text-slate-500">toNumber</dt>
                  <dd className="font-mono text-xs">{detail.toNumber ?? "—"}</dd>
                  <dt className="text-slate-500">fromNumberE164</dt>
                  <dd className="font-mono text-xs">{detail.fromNumberE164 ?? "—"}</dd>
                  <dt className="text-slate-500">toNumberE164</dt>
                  <dd className="font-mono text-xs">{detail.toNumberE164 ?? "—"}</dd>
                  <dt className="text-slate-500">receivedAt</dt>
                  <dd className="font-mono text-xs">{formatTime(detail.receivedAt)}</dd>
                </dl>
                <JsonPre value={detail.payloadRedacted} title="payloadRedacted" />
                <div className="flex gap-2 pt-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => selectedList && loadDetail(selectedList)}>
                    Reload detail
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Select a row to load detail.</p>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
