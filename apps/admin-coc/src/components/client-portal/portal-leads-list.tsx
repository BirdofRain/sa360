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

import { PortalStatusPill } from "./portal-status-pill";

function LeadCard({ lead }: { lead: PortalLeadView }) {
  const href = portalLeadDetailPath(lead.id);
  return (
    <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] md:hidden">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-medium text-slate-900">{lead.leadName}</h2>
          {lead.phoneMasked ? <p className="text-xs text-slate-500">{lead.phoneMasked}</p> : null}
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
            <dd className="text-slate-800">{lead.campaign}</dd>
          </div>
        ) : null}
        {lead.sourceLabel !== "—" ? (
          <div>
            <dt className="text-xs text-slate-500">Source</dt>
            <dd className="text-slate-800">{lead.sourceLabel}</dd>
          </div>
        ) : null}
        {lead.receivedAt ? (
          <div>
            <dt className="text-xs text-slate-500">Received</dt>
            <dd className="text-slate-800">{formatRelativeTime(lead.receivedAt)}</dd>
          </div>
        ) : null}
        {lead.appointmentStatus ? (
          <div>
            <dt className="text-xs text-slate-500">Appointment</dt>
            <dd className="text-slate-800">{lead.appointmentStatus.replace(/_/g, " ")}</dd>
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

export function PortalLeadsList({ leads }: { leads: PortalLeadView[] }) {
  if (leads.length === 0) {
    return (
      <SectionPanel title="Delivered leads">
        <EmptyState
          icon={Users}
          title="No delivered leads yet"
          hint="Leads routed to your account will appear here after delivery is recorded."
        />
      </SectionPanel>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3 md:hidden">
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} />
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
                      <div className="text-xs text-slate-500">{lead.phoneMasked}</div>
                    ) : null}
                    {lead.appointmentStatus ? (
                      <div className="mt-0.5 text-xs text-slate-500">
                        Appointment: {lead.appointmentStatus.replace(/_/g, " ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700">
                    <div>{lead.campaign}</div>
                    <div className="text-xs text-slate-500">{lead.sourceLabel}</div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <PortalStatusPill
                      label={lead.deliveryLabel}
                      tone={portalDeliveryStatusTone(lead.deliveryStatus)}
                    />
                    {lead.lastEvent ? (
                      <div className="mt-1 text-xs text-slate-500">
                        {lead.lastEvent.replace(/_/g, " ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-slate-500">
                    {lead.receivedAt ? formatRelativeTime(lead.receivedAt) : "—"}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={portalLeadDetailPath(lead.id)}
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
