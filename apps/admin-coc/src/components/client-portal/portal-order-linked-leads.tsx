import Link from "next/link";
import { Users } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { formatRelativeTime } from "@/lib/client-portal/map-client-dashboard";
import { formatPortalDate } from "@/lib/client-portal/map-client-orders";
import {
  portalDeliveryStatusTone,
  type PortalLeadView,
} from "@/lib/client-portal/map-client-leads";
import { portalLeadDetailPath } from "@/lib/client-portal/portal-lead-detail";
import {
  PORTAL_ORDER_LINKED_LEADS_EMPTY_HINT,
  PORTAL_ORDER_LINKED_LEADS_EMPTY_TITLE,
  PORTAL_ORDER_LINKED_LEADS_FIRST_PAGE_NOTE,
  PORTAL_ORDER_LINKED_LEADS_LOAD_ERROR,
} from "@/lib/client-portal/portal-order-leads-api";

import { PortalStatusPill } from "./portal-status-pill";

function receivedLabel(iso: string): string | null {
  if (!iso) return null;
  return formatPortalDate(iso) ?? (Number.isNaN(new Date(iso).getTime()) ? null : formatRelativeTime(iso));
}

function LeadCard({ lead }: { lead: PortalLeadView }) {
  const href = portalLeadDetailPath(lead.id);
  const received = receivedLabel(lead.receivedAt);
  return (
    <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] md:hidden">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium text-slate-900">{lead.leadName}</h3>
          {lead.phoneMasked ? (
            <p className="mt-0.5 break-words text-xs text-slate-500">{lead.phoneMasked}</p>
          ) : null}
        </div>
        <PortalStatusPill
          label={lead.deliveryLabel}
          tone={portalDeliveryStatusTone(lead.deliveryStatus)}
        />
      </div>
      {received ? (
        <p className="text-sm text-slate-600">
          <span className="text-xs text-slate-500">Received </span>
          {received}
        </p>
      ) : null}
      <Link
        href={href}
        className="inline-flex min-h-10 min-w-[44px] items-center text-sm font-medium text-slate-800 underline-offset-2 hover:underline"
      >
        View lead
      </Link>
    </article>
  );
}

export function PortalOrderLinkedLeads({
  leads,
  error,
  hasMore = false,
}: {
  leads: PortalLeadView[];
  error?: string | null;
  hasMore?: boolean;
}) {
  if (error) {
    return (
      <SectionPanel title="Leads from this order">
        <p className="p-4 text-sm text-slate-600">{PORTAL_ORDER_LINKED_LEADS_LOAD_ERROR}</p>
      </SectionPanel>
    );
  }

  if (leads.length === 0) {
    return (
      <SectionPanel title="Leads from this order">
        <EmptyState
          icon={Users}
          title={PORTAL_ORDER_LINKED_LEADS_EMPTY_TITLE}
          hint={PORTAL_ORDER_LINKED_LEADS_EMPTY_HINT}
        />
      </SectionPanel>
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="space-y-3 md:hidden">
        <h2 className="text-base font-medium text-slate-800">Leads from this order</h2>
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}
        {hasMore ? (
          <p className="text-xs text-slate-500">{PORTAL_ORDER_LINKED_LEADS_FIRST_PAGE_NOTE}</p>
        ) : null}
      </div>

      <SectionPanel title="Leads from this order" className="hidden min-w-0 md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-0 text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">Lead</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Received</th>
                <th className="px-4 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-slate-800">{lead.leadName}</div>
                    {lead.phoneMasked ? (
                      <div className="mt-0.5 text-xs text-slate-500">{lead.phoneMasked}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <PortalStatusPill
                      label={lead.deliveryLabel}
                      tone={portalDeliveryStatusTone(lead.deliveryStatus)}
                    />
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-slate-500">
                    {receivedLabel(lead.receivedAt) ?? "—"}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={portalLeadDetailPath(lead.id)}
                      className="inline-flex min-h-10 min-w-[44px] items-center text-sm font-medium text-slate-800 underline-offset-2 hover:underline"
                    >
                      View lead
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasMore ? (
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            {PORTAL_ORDER_LINKED_LEADS_FIRST_PAGE_NOTE}
          </p>
        ) : null}
      </SectionPanel>
    </div>
  );
}
