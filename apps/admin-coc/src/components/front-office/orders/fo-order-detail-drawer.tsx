"use client";

import { useState } from "react";

import { CocDetailViewShell } from "@/components/CocDetailViewShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FoOrderReviewActions } from "@/components/front-office/orders/fo-order-review-actions";
import {
  ORDER_STATUS_DISPLAY,
  PAYMENT_CONFIRMATION_DISPLAY,
  formatDateTime,
} from "@/lib/front-office/display";
import {
  resolvePaymentConfirmationStatus,
  reviewQueueLabel,
} from "@/lib/front-office/order-review";
import type { LeadOrder, LeadOrderStatus } from "@/lib/front-office/types";
import { FoStatusPill } from "../shared/fo-status-pill";

const ADMIN_STATUSES: LeadOrderStatus[] = [
  "submitted",
  "needs_setup",
  "needs_compliance",
  "ready",
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
  requestImpl,
}: {
  order: LeadOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
  onUpdated?: (order: LeadOrder) => void;
  requestImpl?: typeof fetch;
}) {
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!order) return null;

  const statusKey = order.status ?? order.adminStatus;
  const status = ORDER_STATUS_DISPLAY[statusKey] ?? ORDER_STATUS_DISPLAY.submitted;
  const payment = resolvePaymentConfirmationStatus(order.paymentConfirmationStatus);
  const paymentDisplay = PAYMENT_CONFIRMATION_DISPLAY[payment];
  const queueLabel = reviewQueueLabel(order);

  async function handleAdminSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveError(null);
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
      return;
    }
    setSaveError(data.error ?? "The order could not be updated. Refresh and try again.");
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
          {queueLabel ? (
            <FoStatusPill
              label={queueLabel}
              className="bg-slate-900 text-white border-slate-900"
            />
          ) : null}
          <FoStatusPill label={status.label} className={status.className} />
          <FoStatusPill label={paymentDisplay.label} className={paymentDisplay.className} />
        </div>

        <dl className="grid gap-2 sm:grid-cols-2" data-testid="fo-order-review-fields">
          <Detail label="Client" value={order.clientName} />
          <Detail label="Order number" value={order.orderNumber} />
          <Detail label="Niche / lead type" value={order.productType ? `${order.niche} · ${order.productType}` : order.niche} />
          <Detail label="Quantity" value={order.volume.toLocaleString()} />
          <Detail label="States" value={order.state} />
          <Detail label="Campaign" value={order.campaignType} />
          <Detail label="CRM / product" value={order.crmPackage} />
          <Detail label="AI/Voice" value={order.aiVoiceAddon ? "Yes" : "No"} />
          <Detail label="Destination" value={order.deliveryDestination} />
          <Detail
            label="Submitted"
            value={formatDateTime(order.submittedAt ?? order.createdAt)}
          />
          <Detail label="Payment confirmation" value={paymentDisplay.label} />
          <Detail label="Order status" value={status.label} />
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

        {isAdmin ? (
          <FoOrderReviewActions
            order={order}
            onUpdated={onUpdated}
            requestImpl={requestImpl}
          />
        ) : null}

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          {order.fulfillmentSummary ??
            (isAdmin
              ? "Fulfillment starts after Fulfillment Ops activates this approved order."
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
            {saveError ? (
              <p className="text-xs text-red-700" role="alert">
                {saveError}
              </p>
            ) : null}
            <Button type="submit" size="sm" variant="outline">
              Save notes
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
