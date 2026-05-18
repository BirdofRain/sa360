import { CalendarCheck, Flame, PhoneCall, TrendingUp } from "lucide-react";

import type { ActionCenterKpis } from "@/lib/action-center/types";
import { cn } from "@/lib/utils";

const TILES: {
  key: keyof ActionCenterKpis;
  label: string;
  icon: typeof Flame;
  accent: string;
}[] = [
  {
    key: "aiAppointmentsToday",
    label: "AI appointments today",
    icon: CalendarCheck,
    accent: "text-sky-600 bg-sky-50 ring-sky-100",
  },
  {
    key: "hotActionsWaiting",
    label: "Hot actions waiting",
    icon: Flame,
    accent: "text-amber-700 bg-amber-50 ring-amber-100",
  },
  {
    key: "callsLoggedToday",
    label: "Calls logged today",
    icon: PhoneCall,
    accent: "text-slate-700 bg-slate-100 ring-slate-200",
  },
  {
    key: "revenueSignalsToday",
    label: "Revenue signals today",
    icon: TrendingUp,
    accent: "text-emerald-700 bg-emerald-50 ring-emerald-100",
  },
];

export function ActionCenterKpiRow({ kpis }: { kpis: ActionCenterKpis }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {TILES.map(({ key, label, icon: Icon, accent }) => (
        <div
          key={key}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
        >
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
                accent
              )}
            >
              <Icon className="size-4" aria-hidden />
            </span>
            <p className="text-[11px] font-medium uppercase leading-snug tracking-wide text-slate-500">
              {label}
            </p>
          </div>
          <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
            {kpis[key]}
          </p>
        </div>
      ))}
    </div>
  );
}
