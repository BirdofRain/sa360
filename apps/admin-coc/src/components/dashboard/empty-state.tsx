import type { LucideIcon } from "lucide-react";
import { Info } from "lucide-react";

import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = Info,
  title,
  hint,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className
      )}
    >
      <div className="rounded-full bg-slate-50 p-3 text-slate-400">
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="font-medium text-slate-700">{title}</div>
      {hint ? <div className="max-w-sm text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}
