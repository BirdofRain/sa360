"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SupportTicketDetailDrawer } from "@/components/support/support-ticket-detail-drawer";
import {
  formatSupportTicketTime,
  supportTicketCategoryLabel,
  supportTicketPriorityBadgeClass,
  supportTicketStatusBadgeClass,
  supportTicketStatusLabel,
} from "@/lib/support-tickets/display";
import type { SupportTicketListQuery, SupportTicketSummary } from "@/lib/support-tickets/types";
import { cn } from "@/lib/utils";

export function SupportTicketsTable({
  items,
  query,
}: {
  items: SupportTicketSummary[];
  query: SupportTicketListQuery;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<SupportTicketSummary | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openTicket(row: SupportTicketSummary) {
    setSelected(row);
    setDrawerOpen(true);
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/80 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Ticket #</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Priority</th>
              <th className="px-3 py-2.5">Category</th>
              <th className="px-3 py-2.5">Subject / preview</th>
              <th className="px-3 py-2.5">Client</th>
              <th className="px-3 py-2.5">Related</th>
              <th className="px-3 py-2.5">Created</th>
              <th className="px-3 py-2.5">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-500">
                  No tickets match these filters.
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b border-slate-100 hover:bg-slate-50/80"
                  onClick={() => openTicket(row)}
                >
                  <td className="px-3 py-2 font-mono text-xs tabular-nums">#{row.ticketNumber}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
                        supportTicketStatusBadgeClass(row.status)
                      )}
                    >
                      {supportTicketStatusLabel(row.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
                        supportTicketPriorityBadgeClass(row.priority)
                      )}
                    >
                      {row.priority}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{supportTicketCategoryLabel(row.category)}</td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-xs">
                    {row.subject ?? row.descriptionPreview}
                  </td>
                  <td className="max-w-[120px] truncate px-3 py-2 font-mono text-xs">
                    {row.clientAccountId ?? row.masterClientAccountId ?? "—"}
                  </td>
                  <td className="max-w-[140px] truncate px-3 py-2 font-mono text-xs">
                    {row.relatedEntityType ? `${row.relatedEntityType}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {formatSupportTicketTime(row.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {formatSupportTicketTime(row.updatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <SupportTicketDetailDrawer
        summary={selected}
        open={drawerOpen}
        onOpenChange={(o) => {
          setDrawerOpen(o);
          if (!o) setSelected(null);
        }}
        onUpdated={() => router.refresh()}
      />
    </>
  );
}
