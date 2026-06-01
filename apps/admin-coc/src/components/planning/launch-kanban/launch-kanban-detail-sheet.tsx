"use client";

import { useEffect, useRef, useState } from "react";
import { AlertOctagon, ArrowRight, Calendar, GitBranch, User2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import {
  LAUNCH_KANBAN_COLUMNS,
  launchKanbanColumnLabel,
  LAUNCH_KANBAN_PRIORITIES,
  type KanbanPriority,
  type LaunchKanbanCard as KanbanCardModel,
} from "./launch-kanban-types";
import type { AdminKanbanCardUpdate } from "@/lib/admin-api/types";
import {
  dateOnlyInputToIso,
  isoToDateOnlyInputValue,
  localeFormatCalendarDayFromIso,
} from "@/lib/date-local";

const PRIORITY_TONE: Record<KanbanPriority, string> = {
  P0: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
  P1: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
  P2: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200",
};

const selectClass =
  "h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300";

function formatDueDate(iso: string | null | undefined): string | null {
  return localeFormatCalendarDayFromIso(iso);
}

function nextColumnLabel(status: string): string | null {
  const idx = (LAUNCH_KANBAN_COLUMNS as readonly string[]).indexOf(status);
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

/** Debounced text/textarea field. Calls `onSave(value)` after the user stops typing. */
function DebouncedField({
  id,
  value,
  onSave,
  multiline = false,
  placeholder,
  rows = 4,
  debounceMs = 600,
}: {
  id: string;
  value: string;
  onSave: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  rows?: number;
  debounceMs?: number;
}) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>(value);

  useEffect(() => {
    setLocal(value);
    lastSaved.current = value;
  }, [value]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function schedule(next: string) {
    setLocal(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (next !== lastSaved.current) {
        lastSaved.current = next;
        onSave(next);
      }
    }, debounceMs);
  }

  function flushOnBlur() {
    if (timer.current) clearTimeout(timer.current);
    if (local !== lastSaved.current) {
      lastSaved.current = local;
      onSave(local);
    }
  }

  if (multiline) {
    return (
      <textarea
        id={id}
        rows={rows}
        value={local}
        onChange={(e) => schedule(e.currentTarget.value)}
        onBlur={flushOnBlur}
        placeholder={placeholder}
        className="w-full resize-y rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
      />
    );
  }
  return (
    <Input
      id={id}
      value={local}
      onChange={(e) => schedule(e.currentTarget.value)}
      onBlur={flushOnBlur}
      placeholder={placeholder}
      className="h-8 text-sm"
    />
  );
}

export function LaunchKanbanDetailSheet({
  card,
  open,
  onOpenChange,
  cardsById,
  onSave,
}: {
  card: KanbanCardModel | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  cardsById: Map<string, KanbanCardModel>;
  onSave: (id: string, patch: AdminKanbanCardUpdate) => void;
}) {
  const nextCol = card ? nextColumnLabel(card.status) : null;
  const dueDisplay = card ? formatDueDate(card.dueDate) : null;
  const priority = (card?.priority as KanbanPriority) ?? "P2";

  function patch(p: AdminKanbanCardUpdate) {
    if (!card) return;
    onSave(card.id, p);
  }

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
                    PRIORITY_TONE[priority] ?? PRIORITY_TONE.P2
                  )}
                >
                  {priority}
                </span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                  {card.workstream}
                </span>
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
                {card.description || "—"}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <Section title="Edit">
                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="lk-d-title" className="text-[11px] text-slate-500">
                      Title
                    </Label>
                    <DebouncedField
                      id="lk-d-title"
                      value={card.title}
                      onSave={(v) => patch({ title: v })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label
                      htmlFor="lk-d-description"
                      className="text-[11px] text-slate-500"
                    >
                      Description
                    </Label>
                    <DebouncedField
                      id="lk-d-description"
                      value={card.description ?? ""}
                      onSave={(v) => patch({ description: v })}
                      multiline
                      rows={3}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="lk-d-status" className="text-[11px] text-slate-500">
                        Status
                      </Label>
                      <select
                        id="lk-d-status"
                        value={card.status}
                        onChange={(e) => patch({ status: e.currentTarget.value })}
                        className={selectClass}
                      >
                        {LAUNCH_KANBAN_COLUMNS.map((s) => (
                          <option key={s} value={s}>
                            {launchKanbanColumnLabel(s)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="lk-d-priority" className="text-[11px] text-slate-500">
                        Priority
                      </Label>
                      <select
                        id="lk-d-priority"
                        value={priority}
                        onChange={(e) => patch({ priority: e.currentTarget.value })}
                        className={selectClass}
                      >
                        {LAUNCH_KANBAN_PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="lk-d-owner" className="text-[11px] text-slate-500">
                        Owner
                      </Label>
                      <DebouncedField
                        id="lk-d-owner"
                        value={card.owner ?? ""}
                        onSave={(v) =>
                          patch({ owner: v.trim() === "" ? null : v.trim() })
                        }
                        placeholder="Unassigned"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="lk-d-due" className="text-[11px] text-slate-500">
                        Due date
                      </Label>
                      <input
                        id="lk-d-due"
                        type="date"
                        value={isoToDateOnlyInputValue(card.dueDate)}
                        onChange={(e) =>
                          patch({ dueDate: dateOnlyInputToIso(e.currentTarget.value) })
                        }
                        className={selectClass}
                      />
                    </div>
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="lk-d-workstream" className="text-[11px] text-slate-500">
                      Workstream
                    </Label>
                    <DebouncedField
                      id="lk-d-workstream"
                      value={card.workstream}
                      onSave={(v) =>
                        patch({ workstream: v.trim() === "" ? card.workstream : v })
                      }
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="lk-d-notes" className="text-[11px] text-slate-500">
                      Notes
                    </Label>
                    <DebouncedField
                      id="lk-d-notes"
                      value={card.notes ?? ""}
                      onSave={(v) => patch({ notes: v.trim() === "" ? null : v })}
                      multiline
                      rows={4}
                      placeholder="Free-form notes for the team…"
                    />
                  </div>
                </div>
              </Section>

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
                    {dueDisplay ?? "—"}
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
                {card.dependencies?.length ? (
                  <ul className="space-y-1.5">
                    {card.dependencies.map((id) => {
                      const dep = cardsById.get(id);
                      return (
                        <li
                          key={id}
                          className="flex items-start gap-2 rounded-md border border-slate-100 bg-white px-2.5 py-1.5 text-xs"
                        >
                          <GitBranch
                            className="mt-0.5 size-3.5 shrink-0 text-slate-400"
                            aria-hidden
                          />
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
            </div>

            <footer className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3">
              <Button
                type="button"
                size="sm"
                disabled={!nextCol}
                title={nextCol ? `Move to ${nextCol}` : "Already in the final column"}
                onClick={() => {
                  if (nextCol) patch({ status: nextCol });
                }}
              >
                Move to Next Column
                {nextCol ? (
                  <span className="ml-1 inline-flex items-center gap-1 text-[11px] opacity-80">
                    <ArrowRight className="size-3" aria-hidden />
                    {nextCol}
                  </span>
                ) : null}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => patch({ blocked: !card.blocked })}
              >
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
