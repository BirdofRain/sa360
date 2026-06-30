import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  Inbox,
  PackageCheck,
  Send,
} from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import type { FulfillmentActivityEvent, FulfillmentActivityKind } from "@/lib/lead-fulfillment/types";

const KIND_META: Record<
  FulfillmentActivityKind,
  { icon: typeof Inbox; iconClass: string; label: string }
> = {
  lead_received: { icon: Inbox, iconClass: "text-sky-600 bg-sky-50", label: "Lead received" },
  proof_packet_created: {
    icon: FileCheck2,
    iconClass: "text-indigo-600 bg-indigo-50",
    label: "Proof packet created",
  },
  lead_verified: { icon: CheckCircle2, iconClass: "text-emerald-600 bg-emerald-50", label: "Lead verified" },
  lead_reserved: { icon: PackageCheck, iconClass: "text-violet-600 bg-violet-50", label: "Lead reserved" },
  lead_delivered: { icon: Send, iconClass: "text-teal-600 bg-teal-50", label: "Lead delivered" },
  delivery_failed: { icon: AlertTriangle, iconClass: "text-red-600 bg-red-50", label: "Delivery failed" },
};

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString();
}

export function FulfillmentActivityList({ events }: { events: FulfillmentActivityEvent[] }) {
  return (
    <SectionPanel title="Fulfillment activity">
      {events.length === 0 ? (
        <EmptyState title="No activity yet" hint="Fulfillment events will stream here when LF1 is live." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {events.map((event) => {
            const meta = KIND_META[event.kind];
            const Icon = meta.icon;
            return (
              <li key={event.id} className="flex gap-3 px-4 py-3">
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full ${meta.iconClass}`}
                >
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800">{meta.label}</div>
                  <div className="text-sm text-slate-500">{event.summary}</div>
                  <div className="mt-0.5 font-mono text-xs text-slate-400">{event.leadUid}</div>
                </div>
                <time className="shrink-0 text-xs text-slate-400" dateTime={event.at}>
                  {formatRelativeTime(event.at)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </SectionPanel>
  );
}
