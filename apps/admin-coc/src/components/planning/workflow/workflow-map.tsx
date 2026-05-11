import { ArrowDown, CornerDownRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { WORKFLOW_MODULES } from "./workflow-data";
import type {
  WorkflowBranchTone,
  WorkflowCard as WorkflowCardModel,
  WorkflowModule,
  WorkflowStatus,
} from "./workflow-types";

const STATUS_TONE: Record<WorkflowStatus, string> = {
  LIVE: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  BUILDING: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
  NEXT: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200",
  FUTURE: "bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200",
};

const BRANCH_TONE: Record<WorkflowBranchTone, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  failure: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
  next: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200",
  neutral: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200",
};

function FieldChip({ name }: { name: string }) {
  return (
    <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10.5px] text-slate-600">
      {name}
    </span>
  );
}

function WorkflowCard({ card }: { card: WorkflowCardModel }) {
  return (
    <article className="flex h-full flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3.5 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-slate-400">{card.id}</div>
          <h4 className="text-sm font-semibold leading-snug text-slate-900">{card.title}</h4>
        </div>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
            STATUS_TONE[card.status]
          )}
        >
          {card.status}
        </span>
      </header>
      <ul className="space-y-1 text-[12.5px] leading-snug text-slate-600">
        {card.bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-slate-300" aria-hidden />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      {card.footnote ? (
        <p className="text-[11px] italic text-slate-400">{card.footnote}</p>
      ) : null}
      {card.fieldChips?.length ? (
        <div className="mt-auto flex flex-wrap gap-1 pt-1">
          {card.fieldChips.map((c) => (
            <FieldChip key={c} name={c} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function ModuleSection({ mod }: { mod: WorkflowModule }) {
  return (
    <section
      className={cn(
        "rounded-2xl border p-5 shadow-[0_1px_0_rgba(15,23,42,0.03)]",
        mod.tone.container
      )}
      aria-labelledby={`module-${mod.id}-title`}
    >
      <header className="mb-4 flex flex-wrap items-start gap-3">
        <span
          className={cn(
            "mt-1 inline-flex h-6 items-center rounded-md px-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-white",
            mod.tone.accent
          )}
        >
          {mod.short}
        </span>
        <div className="min-w-0 flex-1">
          <h3
            id={`module-${mod.id}-title`}
            className={cn("text-base font-semibold", mod.tone.eyebrow)}
          >
            {mod.title}
          </h3>
          <p className="mt-0.5 text-xs text-slate-600">{mod.purpose}</p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {mod.cards.map((card) => (
          <WorkflowCard key={card.id} card={card} />
        ))}
      </div>

      {mod.branches?.length ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-white/60 px-3 py-2.5">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Branching
          </div>
          <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
            {mod.branches.map((b, i) => (
              <li
                key={i}
                className="inline-flex items-center gap-1.5 text-xs text-slate-600"
              >
                <span
                  className={cn(
                    "inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-medium",
                    BRANCH_TONE[b.tone]
                  )}
                >
                  {b.trigger}
                </span>
                <CornerDownRight className="size-3 text-slate-400" aria-hidden />
                <span className="font-mono text-[11px] text-slate-700">{b.target}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {mod.fieldChips?.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Fields
          </span>
          {mod.fieldChips.map((c) => (
            <FieldChip key={c} name={c} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ModuleConnector() {
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

function Legend() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Legend
      </div>
      <div className="grid grid-cols-1 gap-3 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="mb-1 font-medium text-slate-700">Status badges</div>
          <ul className="space-y-1">
            <li className="flex items-center gap-2">
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", STATUS_TONE.LIVE)}>
                LIVE
              </span>
              Currently shipping / running in production
            </li>
            <li className="flex items-center gap-2">
              <span
                className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", STATUS_TONE.BUILDING)}
              >
                BUILDING
              </span>
              Actively being built right now
            </li>
            <li className="flex items-center gap-2">
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", STATUS_TONE.NEXT)}>
                NEXT
              </span>
              On deck for the beta MVP
            </li>
            <li className="flex items-center gap-2">
              <span
                className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", STATUS_TONE.FUTURE)}
              >
                FUTURE
              </span>
              Beyond beta scope
            </li>
          </ul>
        </div>
        <div>
          <div className="mb-1 font-medium text-slate-700">Connectors</div>
          <ul className="space-y-1">
            <li className="flex items-center gap-2">
              <span className="inline-block h-px w-8 bg-slate-500" aria-hidden />
              Solid: current live / near-live path
            </li>
            <li className="flex items-center gap-2">
              <span
                className="inline-block h-px w-8 border-t border-dashed border-slate-400"
                aria-hidden
              />
              Dashed: planned / next path
            </li>
          </ul>
        </div>
        <div>
          <div className="mb-1 font-medium text-slate-700">Outcome badges</div>
          <ul className="space-y-1">
            <li className="flex items-center gap-2">
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", BRANCH_TONE.success)}>
                success
              </span>
              Conversion / positive outcome path
            </li>
            <li className="flex items-center gap-2">
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", BRANCH_TONE.failure)}>
                review / fail
              </span>
              Failure or review-required path
            </li>
          </ul>
        </div>
        <div>
          <div className="mb-1 font-medium text-slate-700">Field chips</div>
          <div className="flex flex-wrap gap-1">
            <FieldChip name="sa360_channel_mode" />
            <FieldChip name="sa360_ai_mode" />
            <FieldChip name="sa360_followup_day" />
            <FieldChip name="sa360_booking_detected" />
            <FieldChip name="sa360_call_in_progress" />
            <FieldChip name="sa360_routing_status" />
          </div>
        </div>
      </div>
    </section>
  );
}

export function WorkflowMap() {
  return (
    <div className="space-y-4">
      <Legend />
      <div className="space-y-3">
        {WORKFLOW_MODULES.map((mod, i) => (
          <div key={mod.id} className="space-y-3">
            <ModuleSection mod={mod} />
            {i < WORKFLOW_MODULES.length - 1 ? <ModuleConnector /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
