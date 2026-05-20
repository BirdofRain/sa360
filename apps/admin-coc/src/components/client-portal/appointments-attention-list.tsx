import { AlertCircle } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import type { ClientPortalAppointmentAttention } from "@/lib/client-portal/types";
import { formatRelativeTime } from "@/lib/client-portal/map-client-dashboard";

export function AppointmentsAttentionList({
  items,
}: {
  items: ClientPortalAppointmentAttention[];
}) {
  return (
    <SectionPanel title="Appointments needing attention">
      {items.length === 0 ? (
        <EmptyState
          title="You're caught up"
          hint="No appointments need follow-up right now."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.contactIdGhl} className="flex gap-3 px-4 py-3">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-800">{item.displayName}</div>
                <div className="text-sm text-slate-600">{item.reason}</div>
                {item.appointmentStatus ? (
                  <div className="mt-0.5 text-xs text-slate-400">{item.appointmentStatus}</div>
                ) : null}
              </div>
              <span className="shrink-0 text-xs text-slate-400">
                {formatRelativeTime(item.lastActivityAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  );
}
