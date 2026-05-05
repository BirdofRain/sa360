"use client";

import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";

import type { AdminSynthflowDetail, AdminSynthflowListItem } from "@/lib/admin-api/types";
import { loadSynthflowDetailAction } from "@/app/actions/synthflow-detail";
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

import { SynthflowDetailPayloadSections } from "./synthflow-json-blocks";

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

export function SynthflowMonitorTable({
  items,
  emptyHint,
}: {
  items: AdminSynthflowListItem[];
  emptyHint?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [selectedList, setSelectedList] = useState<AdminSynthflowListItem | null>(null);
  const [detail, setDetail] = useState<AdminSynthflowDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadDetail = useCallback(async (row: AdminSynthflowListItem) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    const res = await loadSynthflowDetailAction(row.id);
    setDetailLoading(false);
    if (res.error) {
      setDetailError(res.error);
      return;
    }
    setDetail(res.detail);
  }, []);

  async function onOpenRow(row: AdminSynthflowListItem) {
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
              <TableHead className="whitespace-nowrap">fromNumber</TableHead>
              <TableHead className="whitespace-nowrap">toNumber</TableHead>
              <TableHead className="whitespace-nowrap">knownCaller</TableHead>
              <TableHead className="whitespace-nowrap">matchedBy</TableHead>
              <TableHead className="whitespace-nowrap">lookupStatus</TableHead>
              <TableHead className="whitespace-nowrap">clientAccountId</TableHead>
              <TableHead className="whitespace-nowrap">subaccountIdGhl</TableHead>
              <TableHead className="whitespace-nowrap">customerName</TableHead>
              <TableHead className="whitespace-nowrap">contactIdGhl</TableHead>
              <TableHead className="whitespace-nowrap">assignedAgentName</TableHead>
              <TableHead className="whitespace-nowrap">modelId</TableHead>
              <TableHead className="whitespace-nowrap text-right">durationMs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="h-28 text-center text-sm text-slate-500">
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
                  <TableCell className="max-w-[120px] truncate font-mono text-xs">{row.fromNumber ?? "—"}</TableCell>
                  <TableCell className="max-w-[120px] truncate font-mono text-xs">{row.toNumber ?? "—"}</TableCell>
                  <TableCell className="text-xs">{row.knownCaller ?? "—"}</TableCell>
                  <TableCell className="max-w-[100px] truncate text-xs">{row.matchedBy ?? "—"}</TableCell>
                  <TableCell className="max-w-[120px] truncate text-xs">{row.lookupStatus ?? "—"}</TableCell>
                  <TableCell className="max-w-[120px] truncate font-mono text-xs">{row.clientAccountId ?? "—"}</TableCell>
                  <TableCell className="max-w-[100px] truncate font-mono text-xs">{row.subaccountIdGhl ?? "—"}</TableCell>
                  <TableCell className="max-w-[120px] truncate text-xs">{row.customerName ?? "—"}</TableCell>
                  <TableCell className="max-w-[100px] truncate font-mono text-xs">{row.contactIdGhl ?? "—"}</TableCell>
                  <TableCell className="max-w-[120px] truncate text-xs">{row.assignedAgentName ?? "—"}</TableCell>
                  <TableCell className="max-w-[140px] truncate font-mono text-xs">{row.modelId ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{row.durationMs ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="mt-2 text-xs text-slate-400">
        Data from <span className="font-mono">GET /admin/v1/coc/synthflow-requests</span>. Row click loads detail via{" "}
        <span className="font-mono">GET /admin/v1/coc/synthflow-requests/:id</span> (server-side).
      </p>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Synthflow request detail</SheetTitle>
            <SheetDescription>
              Redacted JSON from the API. Custom variables and metadata are extracted when nested under{" "}
              <span className="font-mono">call_inbound</span>.
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
                <dl className="grid grid-cols-[120px_1fr] gap-x-2 gap-y-2 text-sm">
                  <dt className="text-slate-500">request_id</dt>
                  <dd className="break-all font-mono text-xs">{detail.requestId}</dd>
                  <dt className="text-slate-500">receivedAt</dt>
                  <dd className="font-mono text-xs">{formatTime(detail.receivedAt)}</dd>
                  <dt className="text-slate-500">processingStatus</dt>
                  <dd>
                    <Badge variant="outline">{detail.processingStatus}</Badge>
                  </dd>
                  <dt className="text-slate-500">httpStatus</dt>
                  <dd className="font-mono text-xs">{detail.httpStatus ?? "—"}</dd>
                  <dt className="text-slate-500">durationMs</dt>
                  <dd className="font-mono text-xs">{detail.durationMs ?? "—"}</dd>
                  <dt className="text-slate-500">lookupStatus</dt>
                  <dd>{detail.lookupStatus ?? "—"}</dd>
                  <dt className="text-slate-500">knownCaller</dt>
                  <dd>{detail.knownCaller ?? "—"}</dd>
                  <dt className="text-slate-500">matchedBy</dt>
                  <dd>{detail.matchedBy ?? "—"}</dd>
                  <dt className="text-slate-500">clientAccountId</dt>
                  <dd className="font-mono text-xs">{detail.clientAccountId ?? "—"}</dd>
                  <dt className="text-slate-500">subaccountIdGhl</dt>
                  <dd className="font-mono text-xs">{detail.subaccountIdGhl ?? "—"}</dd>
                  <dt className="text-slate-500">customerName</dt>
                  <dd>{detail.customerName ?? "—"}</dd>
                  <dt className="text-slate-500">contactIdGhl</dt>
                  <dd className="font-mono text-xs">{detail.contactIdGhl ?? "—"}</dd>
                  <dt className="text-slate-500">assignedAgentName</dt>
                  <dd>{detail.assignedAgentName ?? "—"}</dd>
                  <dt className="text-slate-500">modelId</dt>
                  <dd className="font-mono text-xs">{detail.modelId ?? "—"}</dd>
                  <dt className="text-slate-500">errorCode</dt>
                  <dd className="font-mono text-xs">{detail.errorCode ?? "—"}</dd>
                  <dt className="text-slate-500">errorSummary</dt>
                  <dd className="text-xs">{detail.errorSummary ?? "—"}</dd>
                </dl>
                <SynthflowDetailPayloadSections detail={detail} />
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
