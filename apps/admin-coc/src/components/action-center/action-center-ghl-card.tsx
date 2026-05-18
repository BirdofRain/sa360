import { CheckCircle2, AlertTriangle, WifiOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/action-center/format";
import type { GhlConnectionStatus } from "@/lib/action-center/types";
import { cn } from "@/lib/utils";

const STATUS_META = {
  connected: {
    label: "Connected",
    icon: CheckCircle2,
    badge: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
  },
  degraded: {
    label: "Degraded",
    icon: AlertTriangle,
    badge: "border-amber-200 bg-amber-50 text-amber-900",
    dot: "bg-amber-500",
  },
  disconnected: {
    label: "Disconnected",
    icon: WifiOff,
    badge: "border-red-200 bg-red-50 text-red-800",
    dot: "bg-red-500",
  },
} as const;

export function ActionCenterGhlCard({ connection }: { connection: GhlConnectionStatus }) {
  const meta = STATUS_META[connection.status];
  const Icon = meta.icon;

  return (
    <Card className="border-slate-200 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <CardHeader className="border-b border-slate-100 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base text-slate-900">GHL connection</CardTitle>
            <CardDescription className="mt-0.5">
              CRM backbone status for this subaccount
            </CardDescription>
          </div>
          <Badge variant="outline" className={cn("gap-1.5 font-medium", meta.badge)}>
            <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
            <Icon className="size-3" aria-hidden />
            {meta.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Location</p>
          <p className="mt-0.5 font-medium text-slate-900">{connection.locationName}</p>
          <p className="font-mono text-[11px] text-slate-500">{connection.locationId}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Last sync</p>
          <p className="mt-0.5 text-sm text-slate-700">
            {connection.lastSyncAt
              ? formatRelativeTime(connection.lastSyncAt)
              : "No sync timestamp"}
          </p>
        </div>
        {connection.message ? (
          <p className="sm:col-span-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {connection.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
