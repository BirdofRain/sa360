"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";

import type { WebhookMonitorUrlQuery } from "@/lib/webhook-monitor-query";
import {
  datetimeLocalStringToIso,
  isoStringToDatetimeLocalValue,
} from "@/lib/date-local";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function buildSearchParamsFromForm(form: HTMLFormElement): URLSearchParams {
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

  return p;
}

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export function WebhookMonitorFilters({ initial }: { initial: WebhookMonitorUrlQuery }) {
  const router = useRouter();

  function onApply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const p = buildSearchParamsFromForm(form);
    const qs = p.toString();
    router.push(qs ? `/webhooks?${qs}` : "/webhooks");
  }

  function onClear() {
    router.push("/webhooks");
  }

  return (
    <form onSubmit={onApply} className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid min-w-[200px] flex-1 gap-2">
          <Label htmlFor="wm-q">Search</Label>
          <Input
            id="wm-q"
            name="q"
            placeholder="Name, phone, email, event UUID, client id…"
            defaultValue={initial.q ?? ""}
            autoComplete="off"
          />
        </div>
        <div className="grid w-full max-w-[160px] gap-2">
          <Label htmlFor="wm-status">Status</Label>
          <Input
            id="wm-status"
            name="status"
            placeholder="processingStatus"
            defaultValue={initial.processingStatus ?? ""}
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
            defaultValue={initial.httpStatus ?? ""}
          />
        </div>
        <div className="grid w-full max-w-[220px] gap-2">
          <Label htmlFor="wm-source">Source</Label>
          <select
            id="wm-source"
            name="source"
            className={selectClass}
            defaultValue={initial.source ?? ""}
          >
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
            defaultValue={initial.clientAccountId ?? ""}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="grid min-w-[200px] gap-2">
          <Label htmlFor="wm-from">From (received)</Label>
          <Input
            id="wm-from"
            name="from"
            type="datetime-local"
            defaultValue={isoStringToDatetimeLocalValue(initial.from)}
          />
        </div>
        <div className="grid min-w-[200px] gap-2">
          <Label htmlFor="wm-to">To (received)</Label>
          <Input
            id="wm-to"
            name="to"
            type="datetime-local"
            defaultValue={isoStringToDatetimeLocalValue(initial.to)}
          />
        </div>
        <div className="flex gap-2 pb-0.5">
          <Button type="submit">Apply filters</Button>
          <Button type="button" variant="outline" onClick={onClear}>
            Clear filters
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Status, HTTP, source, client, and date range are sent to the admin API. Search applies on this page to the loaded
        rows.
      </p>
    </form>
  );
}
