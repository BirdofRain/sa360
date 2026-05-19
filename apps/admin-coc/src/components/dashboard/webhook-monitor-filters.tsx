"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";

import {
  buildWebhookMonitorSearchParams,
  webhookMonitorHref,
  type WebhookMonitorUrlQuery,
} from "@/lib/webhook-monitor-query";
import type { WebhookQuickChip } from "@/lib/webhook-monitor-utils";
import {
  datetimeLocalStringToIso,
  isoStringToDatetimeLocalValue,
} from "@/lib/date-local";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const QUICK_CHIPS: { id: WebhookQuickChip; label: string }[] = [
  { id: "all", label: "All" },
  { id: "stored", label: "Stored / Valid" },
  { id: "errors", label: "Errors" },
  { id: "unauthorized", label: "Unauthorized" },
  { id: "validation_failed", label: "Validation Failed" },
  { id: "last15m", label: "Last 15 minutes" },
  { id: "last1h", label: "Last hour" },
];

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function ChipButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      className={cn("h-8", active && "shadow-sm")}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

export function WebhookMonitorFilters({ initial }: { initial: WebhookMonitorUrlQuery }) {
  const router = useRouter();
  const state: WebhookMonitorUrlQuery = {
    ...initial,
    chip: initial.chip ?? "all",
    sort: initial.sort ?? "desc",
  };

  function navigate(overrides: Partial<WebhookMonitorUrlQuery>) {
    router.push(webhookMonitorHref(state, overrides));
  }

  function onApply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const p = new URLSearchParams();

    const q = String(fd.get("q") ?? "").trim();
    if (q) p.set("q", q);

    const status = String(fd.get("status") ?? "").trim();
    if (status) p.set("status", status);

    const http = String(fd.get("http") ?? "").trim();
    if (http) p.set("http", http);

    const source = String(fd.get("source") ?? "").trim();
    if (source) p.set("source", source);

    const client = String(fd.get("client") ?? "").trim();
    if (client) p.set("client", client);

    const fromLocal = String(fd.get("from") ?? "").trim();
    const fromIso = datetimeLocalStringToIso(fromLocal);
    if (fromIso) p.set("from", fromIso);

    const toLocal = String(fd.get("to") ?? "").trim();
    const toIso = datetimeLocalStringToIso(toLocal);
    if (toIso) p.set("to", toIso);

    const merged = buildWebhookMonitorSearchParams(state);
    for (const [key, value] of p.entries()) {
      merged.set(key, value);
    }

    const qs = merged.toString();
    router.push(qs ? `/webhooks?${qs}` : "/webhooks");
  }

  function onClear() {
    router.push("/webhooks");
  }

  const chip = state.chip ?? "all";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {QUICK_CHIPS.map((c) => (
          <ChipButton
            key={c.id}
            label={c.label}
            active={chip === c.id}
            onClick={() => navigate({ chip: c.id })}
          />
        ))}
      </div>

      <ToggleBar>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={Boolean(state.hideErrors)}
            onChange={(e) => navigate({ hideErrors: e.target.checked })}
          />
          Hide errors
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={Boolean(state.live)}
            onChange={(e) =>
              navigate({
                live: e.target.checked,
                ...(e.target.checked ? { chip: "last15m", sort: "desc" } : {}),
              })
            }
          />
          Live testing mode
        </label>
        {state.live ? (
          <span className="text-xs text-sky-700 dark:text-sky-300">Showing newest webhook calls first</span>
        ) : null}
      </ToggleBar>

      <form onSubmit={onApply} className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid min-w-[200px] flex-1 gap-2">
            <Label htmlFor="wm-q">Search</Label>
            <Input
              id="wm-q"
              name="q"
              placeholder="Name, phone, email, event UUID, client id…"
              defaultValue={state.q ?? ""}
              autoComplete="off"
            />
          </div>
          <div className="grid w-full max-w-[160px] gap-2">
            <Label htmlFor="wm-status">Status</Label>
            <Input
              id="wm-status"
              name="status"
              placeholder="processingStatus"
              defaultValue={state.processingStatus ?? ""}
              autoComplete="off"
            />
          </div>
          <div className="grid w-full max-w-[100px] gap-2">
            <Label htmlFor="wm-http">HTTP</Label>
            <Input
              id="wm-http"
              name="http"
              type="number"
              placeholder="200"
              defaultValue={state.httpStatus ?? ""}
            />
          </div>
          <div className="grid w-full max-w-[220px] gap-2">
            <Label htmlFor="wm-source">Source</Label>
            <select id="wm-source" name="source" className={selectClass} defaultValue={state.source ?? ""}>
              <option value="">Any</option>
              <option value="ghl_lifecycle">ghl_lifecycle</option>
              <option value="synthflow_inbound_lookup">synthflow_inbound_lookup</option>
            </select>
          </div>
          <div className="grid min-w-[180px] flex-1 gap-2">
            <Label htmlFor="wm-client">Client account</Label>
            <Input
              id="wm-client"
              name="client"
              placeholder="Exact client_account_id"
              defaultValue={state.clientAccountId ?? ""}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <DateFromField from={state.from} />
          <DateToField to={state.to} />
          <div className="flex gap-2 pb-0.5">
            <Button type="submit">Apply filters</Button>
            <Button type="button" variant="outline" onClick={onClear}>
              Clear filters
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Status, HTTP, source, client, and date range are sent to the admin API (newest first by default). Search and
          chip filters apply on this page to the loaded rows.
        </p>
      </form>
    </div>
  );
}

function DateFromField({ from }: { from?: string }) {
  return (
    <div className="grid min-w-[200px] gap-2">
      <Label htmlFor="wm-from">From (received)</Label>
      <Input
        id="wm-from"
        name="from"
        type="datetime-local"
        defaultValue={isoStringToDatetimeLocalValue(from)}
      />
    </div>
  );
}

function DateToField({ to }: { to?: string }) {
  return (
    <div className="grid min-w-[200px] gap-2">
      <Label htmlFor="wm-to">To (received)</Label>
      <Input id="wm-to" name="to" type="datetime-local" defaultValue={isoStringToDatetimeLocalValue(to)} />
    </div>
  );
}

function ToggleBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border/80 bg-muted/30 px-3 py-2">
      {children}
    </div>
  );
}
