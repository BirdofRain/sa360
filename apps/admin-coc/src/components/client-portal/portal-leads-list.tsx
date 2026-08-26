import Link from "next/link";
import { Users } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { formatRelativeTime } from "@/lib/client-portal/map-client-dashboard";
import {
  portalDeliveryStatusTone,
  type PortalLeadView,
} from "@/lib/client-portal/map-client-leads";
import { portalLeadDetailPath } from "@/lib/client-portal/portal-lead-detail";
import {
  portalLeadListEmptyCopy,
  type PortalLeadListStatus,
} from "@/lib/client-portal/portal-lead-list-status";
import { formatPortalDisplayValue } from "@/lib/client-portal/portal-labels";

import { PortalStatusPill } from "./portal-status-pill";

function LeadCard({
  lead,
  listStatus,
}: {
  lead: PortalLeadView;
  listStatus: PortalLeadListStatus;
}) {
  const href = portalLeadDetailPath(lead.id, listStatus);
  const sourceLabel = formatPortalDisplayValue(lead.sourceLabel);
  const appointment = formatPortalDisplayValue(lead.appointmentStatus);
  return (
    <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] md:hidden">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-medium text-slate-900">{lead.leadName}</h2>
          {lead.phoneMasked ? <p className="mt-0.5 text-xs text-slate-500">{lead.phoneMasked}</p> : null}
        </div>
        <PortalStatusPill
          label={lead.deliveryLabel}
          tone={portalDeliveryStatusTone(lead.deliveryStatus)}
        />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {lead.campaign !== "—" ? (
          <div>
            <dt className="text-xs text-slate-500">Campaign</dt>
            <dd className="mt-0.5 text-slate-800">{lead.campaign}</dd>
          </div>
        ) : null}
        {sourceLabel ? (
          <div>
            <dt className="text-xs text-slate-500">Source</dt>
            <dd className="mt-0.5 text-slate-800">{sourceLabel}</dd>
          </div>
        ) : null}
        {lead.receivedAt ? (
          <div>
            <dt className="text-xs text-slate-500">Received</dt>
            <dd className="mt-0.5 text-slate-800">{formatRelativeTime(lead.receivedAt)}</dd>
          </div>
        ) : null}
        {appointment ? (
          <div>
            <dt className="text-xs text-slate-500">Appointment</dt>
            <dd className="mt-0.5 text-slate-800">{appointment}</dd>
          </div>
        ) : null}
      </dl>
      <Link
        href={href}
        className="inline-flex min-h-10 items-center text-sm font-medium text-slate-800 underline-offset-2 hover:underline"
      >
        View lead
      </Link>
    </article>
  );
}

export function PortalLeadsList({
  leads,
  statusFilter = "all",
}: {
  leads: PortalLeadView[];
  statusFilter?: PortalLeadListStatus;
}) {
  if (leads.length === 0) {
    const empty = portalLeadListEmptyCopy(statusFilter);
    return (
      <SectionPanel title="Delivered leads">
        <EmptyState icon={Users} title={empty.title} hint={empty.hint} />
      </SectionPanel>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3 md:hidden">
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} listStatus={statusFilter} />
        ))}
      </div>

      <SectionPanel title="Delivered leads" className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">Lead</th>
                <th className="px-4 py-2 font-medium">Campaign</th>
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
                    {formatPortalDisplayValue(lead.appointmentStatus) ? (
                      <div className="mt-0.5 text-xs text-slate-500">
                        Appointment: {formatPortalDisplayValue(lead.appointmentStatus)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700">
                    <div>{lead.campaign}</div>
                    {formatPortalDisplayValue(lead.sourceLabel) ? (
                      <div className="mt-0.5 text-xs text-slate-500">
                        {formatPortalDisplayValue(lead.sourceLabel)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <PortalStatusPill
                      label={lead.deliveryLabel}
                      tone={portalDeliveryStatusTone(lead.deliveryStatus)}
                    />
                    {formatPortalDisplayValue(lead.lastEvent) ? (
                      <div className="mt-1 text-xs text-slate-500">
                        {formatPortalDisplayValue(lead.lastEvent)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-slate-500">
                    {lead.receivedAt ? formatRelativeTime(lead.receivedAt) : "—"}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={portalLeadDetailPath(lead.id, statusFilter)}
                      className="inline-flex min-h-10 items-center text-sm font-medium text-slate-800 underline-offset-2 hover:underline"
                    >
                      View lead
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionPanel>
    </div>
  );
}
