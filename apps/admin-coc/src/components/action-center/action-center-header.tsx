import { CalendarClock, Radio } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export function ActionCenterHeader({
  agentDisplayName,
  generatedAt,
}: {
  agentDisplayName: string;
  generatedAt: string;
}) {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const updated = new Date(generatedAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <header className="rounded-xl border border-slate-800/80 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 px-5 py-5 text-white shadow-lg shadow-slate-900/20 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className="border-amber-400/40 bg-amber-400/10 text-amber-100"
        >
          <Radio className="size-3" aria-hidden />
          Execution console
        </Badge>
        <Badge variant="outline" className="border-white/20 bg-white/5 text-slate-200">
          Read-only MVP
        </Badge>
      </div>
      <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.2em] text-amber-200/90">
        Today&apos;s revenue actions
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{agentDisplayName}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock className="size-4 text-slate-400" aria-hidden />
          {today}
        </span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-400">Refreshed {updated}</span>
      </div>
    </header>
  );
}
