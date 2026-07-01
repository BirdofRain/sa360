"use client";

import { cn } from "@/lib/utils";
import type { AgentAvailability } from "@/lib/front-office/types";

const OPTIONS: { value: AgentAvailability; label: string; dot: string }[] = [
  { value: "available", label: "Available", dot: "bg-emerald-500" },
  { value: "busy", label: "Busy", dot: "bg-amber-500" },
  { value: "offline", label: "Offline", dot: "bg-slate-400" },
];

export function FoAvailabilityToggle({
  value,
  onChange,
}: {
  value: AgentAvailability;
  onChange: (v: AgentAvailability) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === opt.value
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-slate-50"
          )}
        >
          <span className={cn("size-1.5 rounded-full", opt.dot)} aria-hidden />
          {opt.label}
        </button>
      ))}
    </div>
  );
}
