"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  buildDeliveryReadinessHref,
  type DeliveryReadinessQuery,
} from "@/lib/delivery-readiness/delivery-readiness-query";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "not_ready", label: "Not ready" },
  { value: "needs_config", label: "Needs config" },
  { value: "ready_for_shadow", label: "Ready for shadow" },
  { value: "ready_for_live", label: "Ready for live" },
  { value: "live_enabled", label: "Live enabled" },
  { value: "blocked", label: "Blocked" },
];

export function DeliveryReadinessFilters({ initial }: { initial: DeliveryReadinessQuery }) {
  const router = useRouter();

  function onApply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    router.push(
      buildDeliveryReadinessHref({
        masterClientAccountId: String(fd.get("masterClientAccountId") ?? "").trim(),
        clientAccountId: String(fd.get("clientAccountId") ?? "").trim(),
        status: String(fd.get("status") ?? "").trim(),
        ruleId: initial.ruleId,
        locationId: initial.locationId,
      })
    );
  }

  return (
    <form onSubmit={onApply} className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid min-w-[220px] flex-1 gap-2">
          <Label htmlFor="dr-master">Master client account ID (optional)</Label>
          <Input
            id="dr-master"
            name="masterClientAccountId"
            defaultValue={initial.masterClientAccountId}
            placeholder="Leave blank to show all"
          />
        </div>
        <div className="grid min-w-[200px] flex-1 gap-2">
          <Label htmlFor="dr-client">Destination client (optional)</Label>
          <Input id="dr-client" name="clientAccountId" defaultValue={initial.clientAccountId} />
        </div>
        <div className="grid w-full max-w-[200px] gap-2">
          <Label htmlFor="dr-status">Readiness status</Label>
          <select id="dr-status" name="status" className={selectClass} defaultValue={initial.status}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">Apply</Button>
      </div>
    </form>
  );
}
