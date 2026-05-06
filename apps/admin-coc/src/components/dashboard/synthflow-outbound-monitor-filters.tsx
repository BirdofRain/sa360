"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { FormEvent } from "react";

import type { SynthflowOutboundMonitorUrlQuery } from "@/lib/synthflow-outbound-monitor-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function isoToDatetimeLocalValue(iso: string | undefined): string {
  if (!iso?.trim()) return "";
  const d = new Date(iso.trim());
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(local: string): string | undefined {
  const t = local.trim();
  if (!t) return undefined;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function SynthflowOutboundMonitorFilters({ initial }: { initial: SynthflowOutboundMonitorUrlQuery }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function onApply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", "outbound");

    const oor = String(fd.get("oor") ?? "").trim();
    if (oor) next.set("oor", oor);
    else next.delete("oor");

    const obk = String(fd.get("obk") ?? "").trim();
    if (obk === "yes" || obk === "no") next.set("obk", obk);
    else next.delete("obk");

    const ocl = String(fd.get("ocl") ?? "").trim();
    if (ocl) next.set("ocl", ocl);
    else next.delete("ocl");

    const occ = String(fd.get("occ") ?? "").trim();
    if (occ) next.set("occ", occ);
    else next.delete("occ");

    const oci = String(fd.get("oci") ?? "").trim();
    if (oci) next.set("oci", oci);
    else next.delete("oci");

    const omd = String(fd.get("omd") ?? "").trim();
    if (omd) next.set("omd", omd);
    else next.delete("omd");

    const fromIso = datetimeLocalToIso(String(fd.get("from") ?? ""));
    if (fromIso) next.set("from", fromIso);
    else next.delete("from");

    const toIso = datetimeLocalToIso(String(fd.get("to") ?? ""));
    if (toIso) next.set("to", toIso);
    else next.delete("to");

    const qs = next.toString();
    router.push(qs ? `/synthflow?${qs}` : "/synthflow");
  }

  function onClear() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", "outbound");
    ["oor", "obk", "ocl", "occ", "oci", "omd", "from", "to"].forEach((k) => next.delete(k));
    const qs = next.toString();
    router.push(qs ? `/synthflow?${qs}` : "/synthflow");
  }

  const bookedDefault =
    initial.booked === "yes" ? "yes" : initial.booked === "no" ? "no" : "";

  return (
    <form
      onSubmit={onApply}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
    >
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid min-w-[140px] flex-1 gap-2">
          <Label htmlFor="oor">outcome</Label>
          <Input id="oor" name="oor" placeholder="e.g. booked" defaultValue={initial.outcome ?? ""} />
        </div>
        <div className="grid w-full max-w-[180px] gap-2">
          <Label htmlFor="obk">Booked</Label>
          <select id="obk" name="obk" className={selectClass} defaultValue={bookedDefault}>
            <option value="">Any</option>
            <option value="yes">Booked only</option>
            <option value="no">Not booked</option>
          </select>
        </div>
        <div className="grid min-w-[180px] flex-1 gap-2">
          <Label htmlFor="ocl">Client account</Label>
          <Input id="ocl" name="ocl" placeholder="client_account_id" defaultValue={initial.clientAccountId ?? ""} />
        </div>
        <div className="grid min-w-[140px] flex-1 gap-2">
          <Label htmlFor="occ">contactIdGhl</Label>
          <Input id="occ" name="occ" placeholder="GHL contact id" defaultValue={initial.contactIdGhl ?? ""} />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid min-w-[160px] flex-1 gap-2">
          <Label htmlFor="oci">callId</Label>
          <Input id="oci" name="oci" placeholder="Synthflow call id" defaultValue={initial.callId ?? ""} />
        </div>
        <div className="grid min-w-[160px] flex-1 gap-2">
          <Label htmlFor="omd">modelId</Label>
          <Input id="omd" name="omd" placeholder="model id" defaultValue={initial.modelId ?? ""} />
        </div>
        <div className="grid min-w-[200px] gap-2">
          <Label htmlFor="oor-from">From (received)</Label>
          <Input
            id="oor-from"
            name="from"
            type="datetime-local"
            defaultValue={isoToDatetimeLocalValue(initial.from)}
          />
        </div>
        <div className="grid min-w-[200px] gap-2">
          <Label htmlFor="oor-to">To (received)</Label>
          <Input id="oor-to" name="to" type="datetime-local" defaultValue={isoToDatetimeLocalValue(initial.to)} />
        </div>
        <div className="flex gap-2 pb-0.5">
          <Button type="submit">Apply filters</Button>
          <Button type="button" variant="outline" onClick={onClear}>
            Clear outbound filters
          </Button>
        </div>
      </div>
      <p className="text-xs text-slate-400">
        outcome, client, contact, callId, modelId, and dates are sent to the admin API.{" "}
        <span className="font-mono">Booked</span> filters the loaded page in the browser (no API param yet).
      </p>
    </form>
  );
}
