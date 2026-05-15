"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RANGES = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
] as const;

export function AutomationDashboardFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = searchParams.get("range") ?? "7d";
  const clientAccountId = searchParams.get("clientAccountId") ?? "";

  function pushParams(next: URLSearchParams) {
    const qs = next.toString();
    router.push(qs ? `/automation-dashboard?${qs}` : "/automation-dashboard");
  }

  function onRange(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("range", value);
    next.delete("from");
    next.delete("to");
    pushParams(next);
  }

  function onClientSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const next = new URLSearchParams(searchParams.toString());
    const id = String(fd.get("clientAccountId") ?? "").trim();
    if (id) next.set("clientAccountId", id);
    else next.delete("clientAccountId");
    pushParams(next);
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <Button
            key={r.value}
            type="button"
            size="sm"
            variant={range === r.value ? "default" : "outline"}
            onClick={() => onRange(r.value)}
          >
            {r.label}
          </Button>
        ))}
      </div>
      <form onSubmit={onClientSubmit} className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-[220px] gap-1.5">
          <Label htmlFor="ad-client" className="text-xs text-slate-500">
            Client account ID (optional)
          </Label>
          <Input
            id="ad-client"
            name="clientAccountId"
            placeholder="lal_client_0142"
            defaultValue={clientAccountId}
          />
        </div>
        <Button type="submit" size="sm" variant="secondary">
          Apply filter
        </Button>
      </form>
    </div>
  );
}