import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Section card with optional title row — ported from Figma reference `primitives.Card`.
 */
export function SectionPanel({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]", className)}>
      {title ? (
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-medium text-slate-800">{title}</h3>
          {action}
        </div>
      ) : null}
      <div>{children}</div>
    </div>
  );
}
