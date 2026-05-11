"use client";

import { AlertOctagon, ArrowRight, Calendar, GitBranch, User2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import {
  LAUNCH_KANBAN_COLUMNS,
  type KanbanPriority,
  type LaunchKanbanCard as KanbanCardModel,
} from "./launch-kanban-types";

const PRIORITY_TONE: Record<KanbanPriority, string> = {
  P0: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
  P1: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
  P2: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200",
};

function formatDueDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function nextColumnLabel(status: KanbanCardModel["status"]): string | null {
  const idx = LAUNCH_KANBAN_COLUMNS.indexOf(status);
  if (idx === -1 || idx === LAUNCH_KANBAN_COLUMNS.length - 1) return null;
  return LAUNCH_KANBAN_COLUMNS[idx + 1];
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-3 py-1.5">
      <dt className="text-[11px] uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-700">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h4>
      <div>{children}</div>
    </section>
  );
}

export function LaunchKanbanDetailSheet({
  card,
  open,
  onOpenChange,
  cardsById,
}: {
  card: KanbanCardModel | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  cardsById: Map<string, KanbanCardModel>;
}) {
  const nextCol = card ? nextColumnLabel(card.status) : null;
  const due = card ? formatDueDate(card.dueDate) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {card ? (
          <>
            <SheetHeader className="space-y-2 border-b border-slate-100 px-6 pb-4 pt-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white">
                  {card.status}
                </span>
                <span
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-semibold tracking-wide",
                    PRIORITY_TONE[card.priority]
                  )}
                >
                  {card.priority}
                </span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                  {card.workstream}
                </span>
                {card.betaMvp ? (
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    Beta MVP
                  </span>
                ) : null}
                {card.blocked ? (
                  <span className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 ring-1 ring-inset ring-red-200">
                    <AlertOctagon className="size-3" aria-hidden />
                    Blocked
                  </span>
                ) : null}
              </div>
              <SheetTitle className="text-lg font-semibold leading-tight text-slate-900">
                {card.title}
              </SheetTitle>
              <SheetDescription className="text-sm text-slate-500">
                {card.description}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <dl className="rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-2">
                <MetaRow label="Owner">
                  <span className="inline-flex items-center gap-1.5 text-slate-700">
                    <User2 className="size-3.5 text-slate-400" aria-hidden />
                    {card.owner ?? "Unassigned"}
                  </span>
                </MetaRow>
                <MetaRow label="Due Date">
                  <span className="inline-flex items-center gap-1.5 text-slate-700">
                    <Calendar className="size-3.5 text-slate-400" aria-hidden />
                    {due ?? "—"}
                  </span>
                </MetaRow>
                <MetaRow label="Updated">{card.updatedAt ?? "—"}</MetaRow>
                <MetaRow label="Card ID">
                  <code className="font-mono text-xs text-slate-500">{card.id}</code>
                </MetaRow>
              </dl>

              <Section title="Acceptance criteria">
                {card.acceptanceCriteria?.length ? (
                  <ul className="space-y-1.5 text-sm text-slate-700">
                    {card.acceptanceCriteria.map((line, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span
                          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-slate-300"
                          aria-hidden
                        />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400">
                    No acceptance criteria captured yet.
                  </p>
                )}
              </Section>

              <Section title="Dependencies">
                {card.dependencyIds?.length ? (
                  <ul className="space-y-1.5">
                    {card.dependencyIds.map((id) => {
                      const dep = cardsById.get(id);
                      return (
                        <li
                          key={id}
                          className="flex items-start gap-2 rounded-md border border-slate-100 bg-white px-2.5 py-1.5 text-xs"
                        >
                          <GitBranch className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-slate-700">
                              {dep?.title ?? id}
                            </span>
                            {dep ? (
                              <span className="text-[11px] text-slate-400">
                                {dep.status} · {dep.priority} · {dep.workstream}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400">
                                Unresolved dependency reference
                              </span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400">No upstream dependencies.</p>
                )}
              </Section>

              <Section title="Notes">
                {card.notes?.length ? (
                  <ul className="space-y-1.5 text-sm text-slate-700">
                    {card.notes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400">No notes yet.</p>
                )}
              </Section>

              <Section title="Activity">
                {card.activity?.length ? (
                  <ol className="space-y-2 border-l border-slate-100 pl-3">
                    {card.activity.map((a, i) => (
                      <li key={i} className="text-xs">
                        <div className="text-slate-400">{a.ts}</div>
                        <div className="text-slate-700">{a.message}</div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-xs text-slate-400">
                    Activity log will populate once persistence wiring lands.
                  </p>
                )}
              </Section>
            </div>

            <footer className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3">
              <Button
                type="button"
                size="sm"
                disabled={!nextCol}
                title={nextCol ? `Move to ${nextCol}` : "Already in the final column"}
              >
                Move to Next Column
                {nextCol ? (
                  <span className="ml-1 inline-flex items-center gap-1 text-[11px] opacity-80">
                    <ArrowRight className="size-3" aria-hidden />
                    {nextCol}
                  </span>
                ) : null}
              </Button>
              <Button type="button" size="sm" variant="outline">
                {card.blocked ? "Mark Unblocked" : "Mark Blocked"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="ml-auto"
              >
                Close
              </Button>
            </footer>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
