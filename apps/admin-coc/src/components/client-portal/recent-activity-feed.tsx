import {
  Calendar,
  MessageCircle,
  Phone,
  ShoppingBag,
  UserPlus,
  UserCheck,
} from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import type { ClientPortalActivityKind, ClientPortalRecentActivity } from "@/lib/client-portal/types";
import { formatRelativeTime } from "@/lib/client-portal/map-client-dashboard";

const KIND_META: Record<
  ClientPortalActivityKind,
  { icon: typeof UserPlus; iconClass: string }
> = {
  lead: { icon: UserPlus, iconClass: "text-sky-600 bg-sky-50" },
  reply: { icon: MessageCircle, iconClass: "text-indigo-600 bg-indigo-50" },
  appointment: { icon: Calendar, iconClass: "text-violet-600 bg-violet-50" },
  show: { icon: UserCheck, iconClass: "text-emerald-600 bg-emerald-50" },
  sold: { icon: ShoppingBag, iconClass: "text-amber-600 bg-amber-50" },
  voice: { icon: Phone, iconClass: "text-slate-600 bg-slate-100" },
};

export function RecentActivityFeed({ items }: { items: ClientPortalRecentActivity[] }) {
  return (
    <SectionPanel title="Recent activity">
      {items.length === 0 ? (
        <EmptyState
          title="No activity yet"
          hint="When new leads and appointments come in, they will appear here."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => {
            const meta = KIND_META[item.kind];
            const Icon = meta.icon;
            return (
              <li key={item.id} className="flex gap-3 px-4 py-3">
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full ${meta.iconClass}`}
                >
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800">{item.title}</div>
                  {item.subtitle ? (
                    <div className="text-sm text-slate-500">{item.subtitle}</div>
                  ) : null}
                </div>
                <time className="shrink-0 text-xs text-slate-400" dateTime={item.at}>
                  {formatRelativeTime(item.at)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </SectionPanel>
  );
}
