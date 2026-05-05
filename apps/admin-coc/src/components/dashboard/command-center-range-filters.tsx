"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { FormEvent } from "react";

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

/** Adjusts summary metrics window via `?from=` / `?to=` query params on the Command Center (`/`). */
export function CommandCenterRangeFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get("from") ?? "";
  const toUrl = searchParams.get("to") ?? "";

  function onApply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const fromIso = datetimeLocalToIso(String(fd.get("from") ?? ""));
    const toIso = datetimeLocalToIso(String(fd.get("to") ?? ""));
    const next = new URLSearchParams(searchParams.toString());
    if (fromIso) next.set("from", fromIso);
    else next.delete("from");
    if (toIso) next.set("to", toIso);
    else next.delete("to");
    const qs = next.toString();
    router.push(qs ? `/?${qs}` : "/");
  }

  function onClear() {
    router.push("/");
  }

  return (
    <form
      onSubmit={onApply}
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="grid min-w-[200px] gap-1.5">
        <Label htmlFor="cc-from" className="text-xs text-slate-500">
          Summary from (received)
        </Label>
        <Input
          id="cc-from"
          name="from"
          type="datetime-local"
          defaultValue={isoToDatetimeLocalValue(fromUrl)}
        />
      </div>
      <div className="grid min-w-[200px] gap-1.5">
        <Label htmlFor="cc-to" className="text-xs text-slate-500">
          Summary to (received)
        </Label>
        <Input id="cc-to" name="to" type="datetime-local" defaultValue={isoToDatetimeLocalValue(toUrl)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Apply range
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onClear}>
          Clear range
        </Button>
      </div>
      <p className="w-full text-xs text-slate-400">
        Omit both for API default (~last 7 days through now). “Today” KPIs always use UTC midnight → now on the server.
      </p>
    </form>
  );
}
