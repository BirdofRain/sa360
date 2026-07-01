import Link from "next/link";

import {
  DELIVERY_STATUS_DISPLAY,
  formatRelativeTime,
} from "@/lib/front-office/display";
import type { RecentDeliveryEvent } from "@/lib/front-office/types";
import { FoStatusPill } from "../shared/fo-status-pill";

export function FoRecentDeliveryFeed({
  events,
}: {
  events: RecentDeliveryEvent[];
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Recent lead delivery</h2>
        <Link
          href="/front-office/lead-delivery"
          className="text-xs font-medium text-slate-500 hover:text-slate-800"
        >
          View all
        </Link>
      </div>
      <ul className="divide-y divide-slate-100">
        {events.map((event) => {
          const status = DELIVERY_STATUS_DISPLAY[event.status];
          return (
            <li key={event.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">{event.leadName}</p>
                <p className="text-xs text-slate-500">
                  {event.clientName} · {event.campaign}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <FoStatusPill label={status.label} className={status.className} />
                <p className="mt-1 text-[11px] text-slate-400">
                  {formatRelativeTime(event.at)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
