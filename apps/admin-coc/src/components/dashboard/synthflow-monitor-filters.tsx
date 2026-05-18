"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { FormEvent } from "react";

import type { SynthflowMonitorUrlQuery } from "@/lib/synthflow-monitor-query";
import {
  datetimeLocalStringToIso,
  isoStringToDatetimeLocalValue,
} from "@/lib/date-local";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function SynthflowMonitorFilters({ initial }: { initial: SynthflowMonitorUrlQuery }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function onApply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("tab");

    const kc = String(fd.get("kc") ?? "").trim();
    if (kc === "true" || kc === "false") next.set("kc", kc);
    else next.delete("kc");

    const ls = String(fd.get("ls") ?? "").trim();
    if (ls) next.set("ls", ls);
    else next.delete("ls");

    const mb = String(fd.get("mb") ?? "").trim();
    if (mb) next.set("mb", mb);
    else next.delete("mb");

    const client = String(fd.get("client") ?? "").trim();
    if (client) next.set("client", client);
    else next.delete("client");

    const fromIso = datetimeLocalStringToIso(String(fd.get("from") ?? ""));
    if (fromIso) next.set("from", fromIso);
    else next.delete("from");

    const toIso = datetimeLocalStringToIso(String(fd.get("to") ?? ""));
    if (toIso) next.set("to", toIso);
    else next.delete("to");

    const td = String(fd.get("td") ?? "").trim();
    if (td === "only" || td === "hide") next.set("td", td);
    else next.delete("td");

    const qs = next.toString();
    router.push(qs ? `/synthflow?${qs}` : "/synthflow");
  }

  function onClear() {
    router.push("/synthflow");
  }

  return (
    <form
      onSubmit={onApply}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
    >
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid w-full max-w-[160px] gap-2">
          <Label htmlFor="sf-kc">Known caller</Label>
          <select id="sf-kc" name="kc" className={selectClass} defaultValue={initial.knownCaller ?? ""}>
            <option value="">Any</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div className="grid w-full max-w-[200px] gap-2">
          <Label htmlFor="sf-td">Test / dev rows</Label>
          <select id="sf-td" name="td" className={selectClass} defaultValue={initial.testDev ?? ""}>
            <option value="">Show all</option>
            <option value="only">Test/dev only</option>
            <option value="hide">Hide test/dev</option>
          </select>
        </div>
        <div className="grid min-w-[140px] flex-1 gap-2">
          <Label htmlFor="sf-ls">lookupStatus</Label>
          <Input id="sf-ls" name="ls" placeholder="e.g. lookup_ok" defaultValue={initial.lookupStatus ?? ""} />
        </div>
        <div className="grid min-w-[140px] flex-1 gap-2">
          <Label htmlFor="sf-mb">matchedBy</Label>
          <Input id="sf-mb" name="mb" placeholder="index / …" defaultValue={initial.matchedBy ?? ""} />
        </div>
        <div className="grid min-w-[180px] flex-1 gap-2">
          <Label htmlFor="sf-client">Client account</Label>
          <Input
            id="sf-client"
            name="client"
            placeholder="client_account_id"
            defaultValue={initial.clientAccountId ?? ""}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid min-w-[200px] gap-2">
          <Label htmlFor="sf-from">From (received)</Label>
          <Input
            id="sf-from"
            name="from"
            type="datetime-local"
            defaultValue={isoStringToDatetimeLocalValue(initial.from)}
          />
        </div>
        <div className="grid min-w-[200px] gap-2">
          <Label htmlFor="sf-to">To (received)</Label>
          <Input id="sf-to" name="to" type="datetime-local" defaultValue={isoStringToDatetimeLocalValue(initial.to)} />
        </div>
        <div className="flex gap-2 pb-0.5">
          <Button type="submit">Apply filters</Button>
          <Button type="button" variant="outline" onClick={onClear}>
            Clear filters
          </Button>
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Known caller, lookupStatus, matchedBy, client, and dates map to admin API query params.{" "}
        <span className="font-mono">Test / dev rows</span> filters this page client-side (after fetch) using heuristics
        like <span className="font-mono">+1555…</span> numbers and model IDs containing <span className="font-mono">test</span>.
      </p>
    </form>
  );
}
