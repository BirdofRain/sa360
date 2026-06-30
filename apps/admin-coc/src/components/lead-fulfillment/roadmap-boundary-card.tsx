import Link from "next/link";

import { SectionPanel } from "@/components/dashboard/section-panel";
import { ROADMAP_BOUNDARY_SECTIONS } from "@/lib/lead-fulfillment/roadmap-boundaries";
import { cn } from "@/lib/utils";

const SECTION_STYLES = {
  legacy: {
    container: "border-zinc-200 bg-zinc-50/70",
    eyebrow: "text-zinc-700",
    dot: "bg-zinc-500",
  },
  deprecated: {
    container: "border-rose-200 bg-rose-50/60",
    eyebrow: "text-rose-700",
    dot: "bg-rose-500",
  },
} as const;

export function RoadmapBoundaryCard() {
  return (
    <SectionPanel
      title="Roadmap boundaries"
      action={
        <Link href="/workflow" className="text-xs font-medium text-blue-600 hover:underline">
          Workflow map →
        </Link>
      }
    >
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        {ROADMAP_BOUNDARY_SECTIONS.map((section) => {
          const styles = SECTION_STYLES[section.id];
          return (
            <div
              key={section.id}
              className={cn("rounded-lg border p-4", styles.container)}
            >
              <div className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", styles.dot)} aria-hidden />
                <h4 className="text-sm font-semibold text-slate-900">{section.title}</h4>
              </div>
              <p className={cn("mt-1 text-xs", styles.eyebrow)}>{section.eyebrow}</p>
              <ul className="mt-3 space-y-2">
                {section.items.map((item) => (
                  <li key={item.id} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-slate-400" aria-hidden />
                    {item.title}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </SectionPanel>
  );
}
