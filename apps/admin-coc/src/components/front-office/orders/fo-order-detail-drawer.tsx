"use client";

import { CocDetailViewShell } from "@/components/CocDetailViewShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ORDER_STATUS_DISPLAY,
  formatDateTime,
} from "@/lib/front-office/display";
import type { LeadOrder, LeadOrderStatus } from "@/lib/front-office/types";
import { FoStatusPill } from "../shared/fo-status-pill";

const ADMIN_STATUSES: LeadOrderStatus[] = [
  "submitted",
  "needs_setup",
  "needs_compliance",
  "ready",
  "active",
  "paused",
  "completed",
  "canceled",
];

export function FoOrderDetailDrawer({
  order,
  open,
  onOpenChange,
  isAdmin,
  onUpdated,
}: {
  order: LeadOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
  onUpdated?: (order: LeadOrder) => void;
}) {
  if (!order) return null;

  const statusKey = order.status ?? order.adminStatus;
  const status = ORDER_STATUS_DISPLAY[statusKey] ?? ORDER_STATUS_DISPLAY.submitted;

  async function handleAdminSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const res = await fetch(`/api/front-office/orders/${encodeURIComponent(order!.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: form.get("status") || undefined,
        adminNotes: form.get("adminNotes") || undefined,
        routingRuleId: (form.get("routingRuleId") as string) || null,
        campaignId: (form.get("campaignId") as string) || null,
      }),
    });
    const data = await res.json();
    if (data.ok && data.order) {
      onUpdated?.(data.order as LeadOrder);
    }
  }

  return (
    <CocDetailViewShell
      open={open}
      onOpenChange={onOpenChange}
      title={order.orderNumber}
      subtitle={`${order.clientName} · ${order.niche}`}
    >
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <FoStatusPill label={status.label} className={status.className} />
          <span className="text-xs text-slate-500">Created {formatDateTime(order.createdAt)}</span>
        </div>

        <dl className="grid gap-2 sm:grid-cols-2">
          <Detail label="Volume" value={order.volume.toLocaleString()} />
          <Detail label="States" value={order.state} />
          <Detail label="Campaign" value={order.campaignType} />
          <Detail label="CRM" value={order.crmPackage} />
          <Detail label="AI/Voice" value={order.aiVoiceAddon ? "Yes" : "No"} />
          <Detail label="Destination" value={order.deliveryDestination} />
        </dl>

        {order.notes ? (
          <div>
            <p className="text-xs font-medium text-slate-500">Client notes</p>
            <p className="mt-1 text-slate-700">{order.notes}</p>
          </div>
        ) : null}

        {order.setupWarnings?.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-900">Setup / trust warnings</p>
            <ul className="mt-1 list-inside list-disc text-xs text-amber-800">
              {order.setupWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          {order.fulfillmentSummary ??
            (isAdmin
              ? "Lead delivery count linking not wired yet — placeholder for fulfillment tracking."
              : "Fulfillment summary will appear here once your order is active.")}
        </div>

        {isAdmin ? (
          <form className="space-y-3 border-t border-slate-200 pt-4" onSubmit={handleAdminSubmit}>
            <div className="grid gap-1.5">
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue={statusKey}>
                {ADMIN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ORDER_STATUS_DISPLAY[s].label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="adminNotes">Admin notes</Label>
              <Textarea
                id="adminNotes"
                name="adminNotes"
                rows={3}
                defaultValue={order.adminNotes ?? ""}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="routingRuleId">Routing rule ID</Label>
                <Input
                  id="routingRuleId"
                  name="routingRuleId"
                  defaultValue={order.routingRuleId ?? ""}
                  placeholder="Optional"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="campaignId">Campaign ID</Label>
                <Input
                  id="campaignId"
                  name="campaignId"
                  defaultValue={order.campaignId ?? ""}
                  placeholder="Optional"
                />
              </div>
            </div>
            <Button type="submit" size="sm">
              Save changes
            </Button>
          </form>
        ) : null}
      </div>
    </CocDetailViewShell>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}
