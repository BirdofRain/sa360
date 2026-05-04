import { cn } from "@/lib/utils";

/** KPI tile — ported from Figma reference `primitives.StatCard`. */
export function StatTile({
  label,
  value,
  delta,
  tone = "neutral",
  hint,
  className,
}: {
  label: string;
  value: string | number;
  delta?: string;
  tone?: "neutral" | "good" | "bad" | "warn";
  hint?: string;
  className?: string;
}) {
  const toneColor = {
    neutral: "text-slate-600",
    good: "text-emerald-600",
    bad: "text-red-600",
    warn: "text-amber-600",
  }[tone];

  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]",
        className
      )}
    >
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <div className="text-[26px] font-medium tracking-tight text-slate-900">{value}</div>
        {delta ? <span className={cn("text-xs", toneColor)}>{delta}</span> : null}
      </div>
      {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
    </div>
  );
}
