import { ArrowDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { PLANNING_STATUSES, planningStatusTone } from "../planning-status";
import { ARCHITECTURE_FLOWS, ARCHITECTURE_TIERS } from "./architecture-data";
import type { ArchitectureBlock, ArchitectureFlow, ArchitectureTier } from "./architecture-types";

function getBlocksById(tiers: ArchitectureTier[]): Map<string, ArchitectureBlock> {
  const out = new Map<string, ArchitectureBlock>();
  for (const tier of tiers) {
    for (const block of tier.blocks) {
      out.set(block.id, block);
    }
  }
  return out;
}

function ArchitectureBlockCard({ block }: { block: ArchitectureBlock }) {
  const Icon = block.icon;
  return (
    <article className="flex h-full flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3.5 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <header className="flex items-start gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-700">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="truncate text-sm font-semibold text-slate-900">{block.name}</h4>
              {block.caption ? (
                <div className="text-[11px] text-slate-500">{block.caption}</div>
              ) : null}
            </div>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
                planningStatusTone(block.status)
              )}
            >
              {block.status}
            </span>
          </div>
        </div>
      </header>
      <p className="text-[12.5px] leading-snug text-slate-600">{block.description}</p>
    </article>
  );
}

function TierSection({ tier }: { tier: ArchitectureTier }) {
  return (
    <section
      className={cn(
        "rounded-2xl border p-5 shadow-[0_1px_0_rgba(15,23,42,0.03)]",
        tier.tone.container
      )}
      aria-labelledby={`tier-${tier.id}-title`}
    >
      <header className="mb-4 flex flex-wrap items-start gap-3">
        <span
          className={cn(
            "mt-1 inline-flex h-6 items-center rounded-md px-2 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-white",
            tier.tone.accent
          )}
        >
          {tier.id}
        </span>
        <div className="min-w-0 flex-1">
          <h3
            id={`tier-${tier.id}-title`}
            className={cn("text-base font-semibold", tier.tone.eyebrow)}
          >
            {tier.label}
          </h3>
          {tier.caption ? (
            <p className="mt-0.5 text-xs text-slate-600">{tier.caption}</p>
          ) : null}
        </div>
      </header>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {tier.blocks.map((block) => (
          <ArchitectureBlockCard key={block.id} block={block} />
        ))}
      </div>
    </section>
  );
}

function TierConnector() {
  return (
    <div className="flex justify-center" aria-hidden>
      <div className="flex flex-col items-center text-slate-400">
        <div className="h-3 w-px bg-slate-300" />
        <ArrowDown className="size-4" />
        <div className="h-3 w-px bg-slate-300" />
      </div>
    </div>
  );
}

function FlowRow({
  flow,
  blocks,
}: {
  flow: ArchitectureFlow;
  blocks: Map<string, ArchitectureBlock>;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <header className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-900">{flow.title}</h4>
          <p className="mt-0.5 text-xs text-slate-500">{flow.description}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
            planningStatusTone(flow.status)
          )}
        >
          {flow.status}
        </span>
      </header>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-xs">
        {flow.steps.map((step, i) => {
          const resolved = step.freeform ? null : blocks.get(step.ref);
          const label = step.freeform ? step.ref : resolved?.name ?? step.ref;
          const caption = resolved?.caption;
          return (
            <li key={`${flow.id}-${i}`} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px]",
                  step.freeform
                    ? "border-dashed border-slate-300 bg-white text-slate-500"
                    : "border-slate-200 bg-slate-50 text-slate-700"
                )}
              >
                <span className="font-medium">{label}</span>
                {caption ? (
                  <span className="text-[10.5px] text-slate-500">{caption}</span>
                ) : null}
              </span>
              {i < flow.steps.length - 1 ? (
                <ChevronRight className="size-3 text-slate-400" aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
    </article>
  );
}

function ArchitectureLegend() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Status legend
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600">
        {PLANNING_STATUSES.map((status) => (
          <li key={status} className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
                planningStatusTone(status)
              )}
            >
              {status}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ArchitectureMap() {
  const blocksById = getBlocksById(ARCHITECTURE_TIERS);
  return (
    <div className="space-y-5">
      <ArchitectureLegend />
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            System tiers
          </h3>
          <span className="text-[11px] text-slate-400">
            Owned platform (SA360) sits between client CRM and external execution services.
          </span>
        </div>
        <div className="space-y-3">
          {ARCHITECTURE_TIERS.map((tier, i) => (
            <div key={tier.id} className="space-y-3">
              <TierSection tier={tier} />
              {i < ARCHITECTURE_TIERS.length - 1 ? <TierConnector /> : null}
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Primary data flows
          </h3>
          <span className="text-[11px] text-slate-400">
            Each flow is a left-to-right traversal of the system tiers above.
          </span>
        </div>
        <div className="space-y-3">
          {ARCHITECTURE_FLOWS.map((flow) => (
            <FlowRow key={flow.id} flow={flow} blocks={blocksById} />
          ))}
        </div>
      </section>
    </div>
  );
}
