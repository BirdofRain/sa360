import type { LucideIcon } from "lucide-react";
import { Info } from "lucide-react";

import { SectionPanel } from "@/components/dashboard/section-panel";

export function PortalUnavailableState({
  title,
  hint,
  icon: Icon = Info,
}: {
  title: string;
  hint: string;
  icon?: LucideIcon;
}) {
  return (
    <SectionPanel>
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
        <div className="rounded-full bg-slate-50 p-3 text-slate-400">
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="font-medium text-slate-700">{title}</div>
        <div className="max-w-md text-sm text-slate-500">{hint}</div>
      </div>
    </SectionPanel>
  );
}
