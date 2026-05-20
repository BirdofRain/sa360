import { Activity, CalendarCheck, Users } from "lucide-react";

import { SectionPanel } from "@/components/dashboard/section-panel";
import type { ClientPortalSystemHealth } from "@/lib/client-portal/types";
import { formatRelativeTime } from "@/lib/client-portal/map-client-dashboard";
import { cn } from "@/lib/utils";

const STATUS_STYLES = {
  healthy: {
    pill: "bg-emerald-50 text-emerald-800 border-emerald-200",
    label: "Healthy",
  },
  needs_attention: {
    pill: "bg-amber-50 text-amber-800 border-amber-200",
    label: "Needs attention",
  },
  disconnected: {
    pill: "bg-red-50 text-red-800 border-red-200",
    label: "Disconnected",
  },
} as const;

const CHECK_ICONS: Record<string, typeof Activity> = {
  lifecycle_feed: Activity,
  appointments: CalendarCheck,
  crm_snapshot: Users,
};

function checkDot(status: "ok" | "warn" | "error") {
  if (status === "ok") return "bg-emerald-500";
  if (status === "warn") return "bg-amber-500";
  return "bg-red-500";
}

export function SystemHealthCard({ health }: { health: ClientPortalSystemHealth }) {
  const style = STATUS_STYLES[health.status];

  return (
    <SectionPanel title="System health">
      <div className="space-y-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                style.pill
              )}
            >
              {style.label}
            </span>
            <p className="mt-2 text-sm font-medium text-slate-800">{health.headline}</p>
            <p className="mt-1 text-xs text-slate-500">
              Last activity {formatRelativeTime(health.lastActivityAt)}
            </p>
          </div>
        </div>

        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
          {health.checks.map((check) => {
            const Icon = CHECK_ICONS[check.id] ?? Activity;
            return (
              <li key={check.id} className="flex gap-3 px-3 py-3">
                <span
                  className={cn("mt-2 size-2 shrink-0 rounded-full", checkDot(check.status))}
                  aria-hidden
                />
                <div className="flex min-w-0 flex-1 gap-3">
                  <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
                  <div>
                    <div className="text-sm font-medium text-slate-800">{check.label}</div>
                    <div className="text-sm text-slate-500">{check.detail}</div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </SectionPanel>
  );
}
