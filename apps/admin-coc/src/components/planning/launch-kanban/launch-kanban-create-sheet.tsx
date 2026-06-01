"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";

import type { LaunchKanbanActionResult } from "@/app/actions/launch-kanban";
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
  DEFAULT_NEW_CARD_WORKSTREAM,
  LAUNCH_KANBAN_COLUMNS,
  launchKanbanColumnLabel,
  LAUNCH_KANBAN_PRIORITIES,
  type KanbanPriority,
  type KanbanStatus,
  type LaunchKanbanCard,
} from "./launch-kanban-types";

const selectClass =
  "h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300";

export type LaunchKanbanCreateDraft = {
  title: string;
  description: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  owner: string;
  dueDate: string;
  workstream: string;
  notes: string;
};

function formatCreateTaskError(message: string): string {
  const match = message.match(/\{[\s\S]*\}/);
  if (!match) return message;
  try {
    const j = JSON.parse(match[0]) as {
      error?: string;
      details?: { fieldErrors?: Record<string, string[] | unknown> };
    };
    const fe = j.details?.fieldErrors;
    if (fe && typeof fe === "object") {
      const parts = Object.entries(fe).flatMap(([k, arr]) =>
        Array.isArray(arr) ? arr.map((msg) => `${k}: ${String(msg)}`) : []
      );
      if (parts.length) return parts.join("\n");
    }
    if (typeof j.error === "string") return j.error;
  } catch {
    /* ignore */
  }
  return message;
}

function emptyDraft(): LaunchKanbanCreateDraft {
  return {
    title: "",
    description: "",
    status: "TO DO",
    priority: "P2",
    owner: "",
    dueDate: "",
    workstream: "",
    notes: "",
  };
}

export function LaunchKanbanCreateSheet({
  open,
  onOpenChange,
  workstreamSuggestions,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Canonical + board-specific workstreams for the datalist */
  workstreamSuggestions: string[];
  onCreate: (draft: LaunchKanbanCreateDraft) => Promise<LaunchKanbanActionResult<LaunchKanbanCard>>;
}) {
  const formId = useId();
  const [draft, setDraft] = useState<LaunchKanbanCreateDraft>(emptyDraft);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(emptyDraft());
      setTitleError(null);
      setSubmitError(null);
      setPending(false);
    }
  }, [open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!draft.title.trim()) {
      setTitleError("Title is required.");
      return;
    }
    setTitleError(null);
    setPending(true);
    const result = await onCreate(draft);
    setPending(false);
    if (!result.ok) {
      setSubmitError(formatCreateTaskError(result.error));
      return;
    }
    onOpenChange(false);
  }

  const wsListId = `${formId}-ws-list`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="space-y-1 border-b border-slate-100 px-6 pb-4 pt-5">
          <SheetTitle className="text-lg font-semibold text-slate-900">New task</SheetTitle>
          <SheetDescription className="text-sm text-slate-500">
            Creates a card on the launch board. Workstream can be left blank — it defaults to{" "}
            <span className="font-medium text-slate-700">{DEFAULT_NEW_CARD_WORKSTREAM}</span>.
          </SheetDescription>
        </SheetHeader>

        <form id={formId} onSubmit={(e) => void handleSubmit(e)} className="space-y-4 px-6 py-5">
          {submitError ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs whitespace-pre-wrap text-red-800"
            >
              {submitError}
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-title`} className="text-[11px] text-slate-500">
              Title <span className="text-red-600">*</span>
            </Label>
            <Input
              id={`${formId}-title`}
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="Short title"
              className={cn("h-8 text-sm", titleError && "border-red-400")}
              autoComplete="off"
              disabled={pending}
            />
            {titleError ? (
              <p className="text-[11px] text-red-600" role="alert">
                {titleError}
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-desc`} className="text-[11px] text-slate-500">
              Description
            </Label>
            <textarea
              id={`${formId}-desc`}
              rows={3}
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="Optional details"
              disabled={pending}
              className="w-full resize-y rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`${formId}-status`} className="text-[11px] text-slate-500">
                Status
              </Label>
              <select
                id={`${formId}-status`}
                className={selectClass}
                value={draft.status}
                disabled={pending}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, status: e.target.value as KanbanStatus }))
                }
              >
                {LAUNCH_KANBAN_COLUMNS.map((s) => (
                  <option key={s} value={s}>
                    {launchKanbanColumnLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${formId}-priority`} className="text-[11px] text-slate-500">
                Priority
              </Label>
              <select
                id={`${formId}-priority`}
                className={selectClass}
                value={draft.priority}
                disabled={pending}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, priority: e.target.value as KanbanPriority }))
                }
              >
                {LAUNCH_KANBAN_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-owner`} className="text-[11px] text-slate-500">
              Owner
            </Label>
            <Input
              id={`${formId}-owner`}
              value={draft.owner}
              onChange={(e) => setDraft((d) => ({ ...d, owner: e.target.value }))}
              placeholder="Optional"
              className="h-8 text-sm"
              disabled={pending}
              autoComplete="off"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-due`} className="text-[11px] text-slate-500">
              Due date
            </Label>
            <Input
              id={`${formId}-due`}
              type="date"
              value={draft.dueDate}
              onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))}
              className="h-8 text-sm"
              disabled={pending}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-ws`} className="text-[11px] text-slate-500">
              Workstream
            </Label>
            <Input
              id={`${formId}-ws`}
              value={draft.workstream}
              onChange={(e) => setDraft((d) => ({ ...d, workstream: e.target.value }))}
              placeholder={`Optional — defaults to ${DEFAULT_NEW_CARD_WORKSTREAM}`}
              className="h-8 text-sm"
              disabled={pending}
              list={wsListId}
              autoComplete="off"
            />
            <datalist id={wsListId}>
              {workstreamSuggestions.map((w) => (
                <option key={w} value={w} />
              ))}
            </datalist>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-notes`} className="text-[11px] text-slate-500">
              Notes
            </Label>
            <textarea
              id={`${formId}-notes`}
              rows={2}
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              placeholder="Optional internal notes"
              disabled={pending}
              className="w-full resize-y rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending} className="gap-1.5">
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Plus className="size-3.5" aria-hidden />
              )}
              Create task
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
