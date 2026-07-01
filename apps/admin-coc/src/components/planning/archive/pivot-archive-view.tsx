import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { planningStatusTone } from "../planning-status";
import {
  PIVOT_COMPARISON_ROWS,
  PIVOT_WHAT_CHANGED,
  PIVOT_WHAT_STAYED,
  PIVOT_WHAT_STOPPED,
} from "./pre-pivot-compare-data";
import {
  PRE_PIVOT_ARCHITECTURE_FLOWS,
  PRE_PIVOT_ARCHITECTURE_TIERS,
} from "./pre-pivot-architecture-data";
import { PRE_PIVOT_WORKFLOW_MODULES } from "./pre-pivot-workflow-data";

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function PivotArchiveView() {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-amber-300 bg-amber-50/60 px-5 py-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Pre-Pivot SA360 Archive</h2>
          <span className="rounded-md border border-amber-400 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
            Archived / Read-only
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Historical snapshot of the SA360 roadmap before the Lead Fulfillment OS pivot.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          This view is for comparison only. Current roadmap execution lives under Lead
          Fulfillment OS.
        </p>
      </section>

      <SectionCard
        title="Pre-pivot workflow map"
        subtitle="Recovered historical module structure before LF1-LF6."
      >
        <div className="space-y-3">
          {PRE_PIVOT_WORKFLOW_MODULES.map((module) => (
            <article
              key={module.id}
              className={cn(
                "rounded-xl border p-4 shadow-[0_1px_0_rgba(15,23,42,0.03)]",
                module.tone.container
              )}
            >
              <header className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <div className={cn("text-[11px] font-semibold uppercase tracking-wider", module.tone.eyebrow)}>
                    {module.short}
                  </div>
                  <h4 className="text-sm font-semibold text-slate-900">{module.title}</h4>
                  <p className="text-xs text-slate-600">{module.purpose}</p>
                </div>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                    planningStatusTone(module.moduleStatus)
                  )}
                >
                  {module.moduleStatus}
                </span>
              </header>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {module.cards.map((card) => (
                  <div key={card.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-mono text-[10px] text-slate-400">{card.id}</div>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          planningStatusTone(card.status)
                        )}
                      >
                        {card.status}
                      </span>
                    </div>
                    <h5 className="mt-0.5 text-xs font-semibold text-slate-800">{card.title}</h5>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Pre-pivot architecture summary"
        subtitle="Historical system map before Lead Fulfillment OS framing."
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {PRE_PIVOT_ARCHITECTURE_TIERS.map((tier) => (
              <article
                key={tier.id}
                className={cn("rounded-lg border p-3", tier.tone.container)}
              >
                <h4 className={cn("text-xs font-semibold uppercase tracking-wider", tier.tone.eyebrow)}>
                  {tier.label}
                </h4>
                <p className="mt-0.5 text-[11px] text-slate-600">{tier.caption}</p>
                <ul className="mt-2 space-y-1 text-xs text-slate-700">
                  {tier.blocks.map((block) => (
                    <li key={block.id}>
                      <span className="font-medium">{block.name}</span>
                      {block.caption ? <span className="text-slate-500"> - {block.caption}</span> : null}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Primary pre-pivot flows
            </h4>
            <ul className="mt-2 space-y-1.5 text-xs text-slate-700">
              {PRE_PIVOT_ARCHITECTURE_FLOWS.map((flow) => (
                <li key={flow.id}>
                  <span className="font-medium">{flow.title}</span>
                  <span className="text-slate-500"> - {flow.status}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Pivot comparison" subtitle="Pre-pivot direction versus current Lead Fulfillment OS direction.">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="px-2 py-1.5 font-semibold">Pre-Pivot Direction</th>
                <th className="px-2 py-1.5 font-semibold">Current Lead Fulfillment OS Direction</th>
                <th className="px-2 py-1.5 font-semibold">Status</th>
                <th className="px-2 py-1.5 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {PIVOT_COMPARISON_ROWS.map((row) => (
                <tr key={row.prePivotDirection} className="border-b border-slate-100 align-top">
                  <td className="px-2 py-1.5 text-slate-700">{row.prePivotDirection}</td>
                  <td className="px-2 py-1.5 text-slate-700">{row.currentDirection}</td>
                  <td className="px-2 py-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 font-semibold",
                        row.status === "Deprecated / Do Not Build"
                          ? planningStatusTone("DEPRECATED / DO NOT BUILD")
                          : row.status === "Legacy / Retainer Only"
                            ? planningStatusTone("LEGACY / RETAINER ONLY")
                            : planningStatusTone("BUILDING")
                      )}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-slate-600">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <SectionCard title="What stayed">
          <ul className="space-y-1 text-xs text-slate-700">
            {PIVOT_WHAT_STAYED.map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard title="What stopped">
          <ul className="space-y-1 text-xs text-slate-700">
            {PIVOT_WHAT_STOPPED.map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard title="What changed">
          <ul className="space-y-1 text-xs text-slate-700">
            {PIVOT_WHAT_CHANGED.map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
