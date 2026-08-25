import { Users } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { formatRelativeTime } from "@/lib/client-portal/map-client-dashboard";
import {
  portalDeliveryStatusTone,
  type PortalLeadView,
} from "@/lib/client-portal/map-client-leads";

import { PortalStatusPill } from "./portal-status-pill";

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
    <SectionPanel title="Delivered leads">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs text-slate-500">
              <th className="px-4 py-2 font-medium">Lead</th>
              <th className="px-4 py-2 font-medium">Campaign</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Received</th>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionPanel>
  );
}
