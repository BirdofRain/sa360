import type { ReactNode } from "react";
import { AlertTriangle, Info, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

/** Inline alert strip — ported from Figma reference `primitives.WarningBanner`. */
export function WarningBanner({
  tone = "warn",
  title,
  children,
  action,
  className,
}: {
  tone?: "warn" | "err" | "info";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const t = {
    warn: {
      bg: "bg-amber-50",
      border: "border-amber-200",
      fg: "text-amber-900",
      icon: AlertTriangle,
      ic: "text-amber-600",
    },
    err: {
      bg: "bg-red-50",
      border: "border-red-200",
      fg: "text-red-900",
      icon: XCircle,
      ic: "text-red-600",
    },
    info: {
      bg: "bg-blue-50",
      border: "border-blue-200",
      fg: "text-blue-900",
      icon: Info,
      ic: "text-blue-600",
    },
  }[tone];
  const Ic = t.icon;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3",
        t.border,
        t.bg,
        className
      )}
    >
      <Ic className={cn("mt-0.5 size-4 shrink-0", t.ic)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-medium", t.fg)}>{title}</div>
        {children ? <div className={cn("mt-0.5 text-xs opacity-80", t.fg)}>{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
