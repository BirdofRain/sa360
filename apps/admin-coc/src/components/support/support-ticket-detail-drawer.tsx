"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { getSupportTicketAction, updateSupportTicketAction } from "@/app/actions/support-tickets";
import { CocDetailViewShell } from "@/components/CocDetailViewShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatSupportTicketTime,
  supportTicketCategoryLabel,
  supportTicketPriorityBadgeClass,
  supportTicketStatusBadgeClass,
  supportTicketStatusLabel,
} from "@/lib/support-tickets/display";
import type {
  SupportTicketDetail,
  SupportTicketInternalNote,
  SupportTicketSummary,
} from "@/lib/support-tickets/types";
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
} from "@/lib/support-tickets/types";
import { cn } from "@/lib/utils";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function parseNotes(raw: unknown): SupportTicketInternalNote[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (n): n is SupportTicketInternalNote =>
      Boolean(n) &&
      typeof n === "object" &&
      typeof (n as SupportTicketInternalNote).note === "string"
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(120px,34%)_1fr] gap-x-2 gap-y-1 text-sm">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-all text-xs">{value}</dd>
    </div>
  );
}

export function SupportTicketDetailDrawer({
  summary,
  open,
  onOpenChange,
  onUpdated,
}: {
  summary: SupportTicketSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: () => void;
}) {
  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");
  const [assignedToName, setAssignedToName] = useState("");
  const [resolutionSummary, setResolutionSummary] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [pending, startTransition] = useTransition();

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    setLoadError(null);
    const res = await getSupportTicketAction(id);
    setLoading(false);
    if (!res.ok) {
      setLoadError(res.error);
      setTicket(null);
      return;
    }
    setTicket(res.ticket);
    setStatus(res.ticket.status);
    setPriority(res.ticket.priority);
    setCategory(res.ticket.category);
    setAssignedToName(res.ticket.assignedToName ?? "");
    setResolutionSummary(res.ticket.resolutionSummary ?? "");
  }, []);

  useEffect(() => {
    if (open && summary?.id) {
      void loadDetail(summary.id);
    }
    if (!open) {
      setTicket(null);
      setLoadError(null);
      setSaveError(null);
      setInternalNote("");
    }
  }, [open, summary?.id, loadDetail]);

  function save() {
    if (!summary) return;
    setSaveError(null);
    startTransition(async () => {
      const res = await updateSupportTicketAction(summary.id, {
        status: status as (typeof SUPPORT_TICKET_STATUSES)[number],
        priority: priority as (typeof SUPPORT_TICKET_PRIORITIES)[number],
        category: category as (typeof SUPPORT_TICKET_CATEGORIES)[number],
        assignedToName: assignedToName.trim() || undefined,
        resolutionSummary: resolutionSummary.trim() || undefined,
        internalNote: internalNote.trim() || undefined,
        internalNoteBy: "admin",
      });
      if (!res.ok) {
        setSaveError(res.error);
        return;
      }
      setTicket(res.ticket);
      setInternalNote("");
      onUpdated?.();
    });
  }

  const title = summary ? `Ticket #${summary.ticketNumber}` : "Support ticket";
  const subtitle = summary?.subject ?? summary?.descriptionPreview;

  return (
    <CocDetailViewShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      subtitle={subtitle}
      sheetClassName="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-xl"
      bodyClassName="space-y-4 pb-4"
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading ticket…
        </div>
      ) : null}
      {loadError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {loadError}
        </p>
      ) : null}
      {ticket ? (
        <>
          <div className="flex flex-wrap gap-2">
            <span
              className={cn(
                "inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
                supportTicketStatusBadgeClass(ticket.status)
              )}
            >
              {supportTicketStatusLabel(ticket.status)}
            </span>
            <span
              className={cn(
                "inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
                supportTicketPriorityBadgeClass(ticket.priority)
              )}
            >
              {ticket.priority}
            </span>
            <span className="inline-flex rounded-md border border-border px-2 py-0.5 text-xs font-medium">
              {supportTicketCategoryLabel(ticket.category)}
            </span>
          </div>

          <section className="space-y-2 rounded-lg border border-border bg-card/50 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Description
            </h3>
            <p className="whitespace-pre-wrap text-sm">{ticket.description}</p>
            {ticket.subject ? (
              <p className="text-xs text-muted-foreground">Subject: {ticket.subject}</p>
            ) : null}
          </section>

          <dl className="space-y-2">
            <Field label="Created" value={formatSupportTicketTime(ticket.createdAt)} />
            <Field label="Updated" value={formatSupportTicketTime(ticket.updatedAt)} />
            <Field label="Requester" value={ticket.requesterName ?? ticket.requesterEmail ?? "—"} />
            <Field label="Client" value={ticket.clientAccountId ?? "—"} />
            <Field label="Master client" value={ticket.masterClientAccountId ?? "—"} />
            <Field label="GHL location" value={ticket.subaccountIdGhl ?? "—"} />
            <Field
              label="Related"
              value={
                ticket.relatedEntityType
                  ? `${ticket.relatedEntityType} · ${ticket.relatedEntityId ?? "—"}`
                  : "—"
              }
            />
            <Field label="Page" value={ticket.pagePath ?? "—"} />
            {ticket.pageUrl ? (
              <Field
                label="URL"
                value={
                  <a href={ticket.pageUrl} className="text-primary underline-offset-2 hover:underline">
                    {ticket.pageUrl}
                  </a>
                }
              />
            ) : null}
          </dl>

          {(ticket.queryJson || ticket.contextJson) && (
            <details className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium text-muted-foreground">
                Context JSON
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">
                {JSON.stringify({ queryJson: ticket.queryJson, contextJson: ticket.contextJson }, null, 2)}
              </pre>
            </details>
          )}

          {parseNotes(ticket.internalNotes).length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Internal notes
              </h3>
              <ul className="space-y-2">
                {parseNotes(ticket.internalNotes).map((n, i) => (
                  <li key={`${n.at}-${i}`} className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
                    <div className="text-muted-foreground">
                      {formatSupportTicketTime(n.at)} · {n.by}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{n.note}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-3 rounded-lg border border-border p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Update ticket
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="ticket-status">Status</Label>
                <select
                  id="ticket-status"
                  className={selectClass}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {SUPPORT_TICKET_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {supportTicketStatusLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ticket-priority">Priority</Label>
                <select
                  id="ticket-priority"
                  className={selectClass}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  {SUPPORT_TICKET_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ticket-category">Category</Label>
                <select
                  id="ticket-category"
                  className={selectClass}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {SUPPORT_TICKET_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {supportTicketCategoryLabel(c)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-assigned">Assigned to</Label>
              <Input
                id="ticket-assigned"
                value={assignedToName}
                onChange={(e) => setAssignedToName(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-resolution">Resolution summary</Label>
              <textarea
                id="ticket-resolution"
                rows={2}
                value={resolutionSummary}
                onChange={(e) => setResolutionSummary(e.target.value)}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-note">Add internal note</Label>
              <textarea
                id="ticket-note"
                rows={2}
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            {saveError ? (
              <p className="text-sm text-destructive">{saveError}</p>
            ) : null}
            <Button type="button" disabled={pending} onClick={save}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </section>
        </>
      ) : !loading && !loadError ? (
        <p className="text-sm text-muted-foreground">Select a ticket to view details.</p>
      ) : null}
    </CocDetailViewShell>
  );
}
