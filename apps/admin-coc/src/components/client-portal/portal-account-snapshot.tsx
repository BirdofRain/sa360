import Link from "next/link";

import { formatRelativeTime } from "@/lib/client-portal/map-client-dashboard";
import type { PortalAccountSnapshot } from "@/lib/client-portal/map-client-summary";
import { cn } from "@/lib/utils";

function formatCount(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString();
}

export function PortalAccountSnapshot({ snapshot }: { snapshot: PortalAccountSnapshot }) {
  const tiles = [
    {
      href: "/portal/orders",
      label: "Active orders",
      value: formatCount(snapshot.ordersActive),
      hint:
        snapshot.ordersNeedingSetup && snapshot.ordersNeedingSetup > 0
          ? `${snapshot.ordersNeedingSetup} need setup`
          : "View order status",
    },
    {
      href: "/portal/leads",
      label: "Delivered leads",
      value: formatCount(snapshot.leadsDelivered),
      hint: snapshot.latestLeadEvent
        ? `Latest ${formatRelativeTime(snapshot.latestLeadEvent)}`
        : "View delivered leads",
    },
    {
      href: "/portal/account",
      label: "Account alerts",
      value: formatCount(snapshot.trustWarnings),
      hint: "Connection and setup status",
    },
  ];

  return (
    <section aria-label="Account snapshot">
      {!snapshot.available ? (
        <p className="mb-3 text-xs text-slate-500">
          Order and lead totals are unavailable right now. Open each page for the latest status.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className={cn(
              "rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]",
              "transition-colors hover:border-slate-300 hover:bg-slate-50/80"
            )}
          >
            <div className="text-xs text-slate-500">{tile.label}</div>
            <div className="mt-1 text-[26px] font-medium tracking-tight text-slate-900">
              {tile.value}
            </div>
            <div className="mt-1 text-xs text-slate-400">{tile.hint}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
