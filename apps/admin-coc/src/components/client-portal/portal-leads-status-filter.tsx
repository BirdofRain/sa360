import Link from "next/link";

import {
  PORTAL_LEAD_LIST_STATUS_OPTIONS,
  portalLeadListPath,
  type PortalLeadListStatus,
} from "@/lib/client-portal/portal-lead-list-status";
import { cn } from "@/lib/utils";

export function PortalLeadsStatusFilter({
  active,
}: {
  active: PortalLeadListStatus;
}) {
  return (
    <nav
      className="inline-flex max-w-full flex-wrap rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm"
      aria-label="Lead status"
    >
      {PORTAL_LEAD_LIST_STATUS_OPTIONS.map((option) => {
        const isActive = option.value === active;
        return (
          <Link
            key={option.value}
            href={portalLeadListPath(option.value)}
            className={cn(
              "inline-flex min-h-9 shrink-0 items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            )}
            aria-current={isActive ? "page" : undefined}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
