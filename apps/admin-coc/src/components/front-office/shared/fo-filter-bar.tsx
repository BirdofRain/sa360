"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export function FoFilterBar({
  campaigns,
  clients,
  dateRanges,
}: {
  campaigns: string[];
  clients: string[];
  dateRanges: { key: string; label: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid min-w-[140px] gap-1">
        <Label className="text-xs text-slate-500">Campaign</Label>
        <Select
          value={searchParams.get("campaign") ?? ""}
          onChange={(e) => update("campaign", e.target.value)}
        >
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid min-w-[140px] gap-1">
        <Label className="text-xs text-slate-500">Client</Label>
        <Select
          value={searchParams.get("client") ?? ""}
          onChange={(e) => update("client", e.target.value)}
        >
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid min-w-[140px] gap-1">
        <Label className="text-xs text-slate-500">Date range</Label>
        <Select
          value={searchParams.get("range") ?? "7d"}
          onChange={(e) => update("range", e.target.value)}
        >
          {dateRanges.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
