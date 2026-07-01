"use client";

import { useState } from "react";

import { EmptyState } from "@/components/dashboard/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DELIVERY_STATUS_DISPLAY,
  formatDateTime,
} from "@/lib/front-office/display";
import type { LeadDeliveryRow } from "@/lib/front-office/types";
import { FoStatusPill } from "../shared/fo-status-pill";
import { FoLeadDeliveryDrawer } from "./fo-lead-delivery-drawer";

export function FoLeadDeliveryTable({ rows }: { rows: LeadDeliveryRow[] }) {
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openRow(leadUid: string) {
    setSelectedUid(leadUid);
    setDrawerOpen(true);
  }

  if (!rows.length) {
    return (
      <EmptyState
        title="No lead deliveries yet"
        hint="When source leads are received and routed, they will appear here."
      />
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>Lead</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Routing</TableHead>
              <TableHead>Delivery</TableHead>
              <TableHead>Last event</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const status = DELIVERY_STATUS_DISPLAY[row.deliveryStatus];
              return (
                <TableRow
                  key={row.leadUid}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => openRow(row.leadUid)}
                >
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatDateTime(row.receivedAt)}
                  </TableCell>
                  <TableCell className="font-medium">{row.leadName}</TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {row.phoneMasked}
                    {row.emailMasked ? (
                      <span className="block text-[11px]">{row.emailMasked}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.sourcePlatform ?? row.source}
                    {row.sourceType ? (
                      <span className="block text-[11px] text-slate-400">{row.sourceType}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs">{row.campaignName ?? row.campaign}</TableCell>
                  <TableCell className="text-xs">{row.matchedClient}</TableCell>
                  <TableCell className="text-xs capitalize">
                    {row.routingStatus ?? "—"}
                  </TableCell>
                  <TableCell>
                    <FoStatusPill label={status.label} className={status.className} />
                  </TableCell>
                  <TableCell className="text-xs capitalize">{row.lastEvent ?? "—"}</TableCell>
                  <TableCell className="max-w-[140px] truncate text-xs text-red-600">
                    {row.errorSummary ?? row.error ?? "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <FoLeadDeliveryDrawer
        leadUid={selectedUid}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}
