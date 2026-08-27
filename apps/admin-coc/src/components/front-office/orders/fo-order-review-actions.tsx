"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  fetchOrderReviewDetail,
  postOrderReviewAction,
  type OrderReviewClientAction,
} from "@/lib/front-office/api/lead-order-review-client";
import {
  approvedReadyCopy,
  availableReviewActions,
  fulfillmentOpsHref,
  mapReviewApiError,
  runConfirmAndApprove,
  type ReviewAction,
} from "@/lib/front-office/order-review";
import type { LeadOrder } from "@/lib/front-office/types";

const ACTION_LABEL: Record<ReviewAction, string> = {
  "confirm-and-approve": "Confirm Payment & Approve",
  "confirm-payment": "Confirm payment",
  "mark-payment-not-required": "Mark payment not required",
  approve: "Approve",
};

export function FoOrderReviewActions({
  order,
  onUpdated,
  requestImpl,
}: {
  order: LeadOrder;
  onUpdated?: (order: LeadOrder) => void;
  requestImpl?: typeof fetch;
}) {
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(
    null
  );
  const actions = availableReviewActions(order);
  const isReady = (order.status ?? order.adminStatus) === "ready";

  async function refreshAfter(next?: LeadOrder) {
    const latest = await fetchOrderReviewDetail(order.id, requestImpl);
    const resolved = latest.ok && latest.order ? latest.order : next;
    if (resolved) onUpdated?.(resolved);
    return resolved;
  }

  async function runSingle(action: OrderReviewClientAction, successMessage: string) {
    setBusy(action);
    setNotice(null);
    const result = await postOrderReviewAction(order.id, action, requestImpl);
    const latest = await refreshAfter(result.order);
    if (!result.ok) {
      setNotice({ tone: "err", text: mapReviewApiError(result) });
    } else {
      const status = latest?.status ?? result.order?.status;
      if (action === "approve" && status === "ready") {
        setNotice({ tone: "ok", text: approvedReadyCopy() });
      } else {
        setNotice({ tone: "ok", text: successMessage });
      }
    }
    setBusy(null);
  }

  async function runCombined() {
    setBusy("confirm-and-approve");
    setNotice(null);
    const result = await runConfirmAndApprove({
      confirm: () => postOrderReviewAction(order.id, "confirm-payment", requestImpl),
      approve: () => postOrderReviewAction(order.id, "approve", requestImpl),
    });
    await refreshAfter(result.order);
    if (result.outcome === "payment_confirmed_approval_failed") {
      setNotice({ tone: "warn", text: result.message });
    } else if (result.outcome === "confirm_failed") {
      setNotice({ tone: "err", text: result.message });
    } else {
      setNotice({ tone: "ok", text: result.message });
    }
    setBusy(null);
  }

  async function handleAction(action: ReviewAction) {
    if (action === "confirm-and-approve") {
      await runCombined();
      return;
    }
    const messages: Record<OrderReviewClientAction, string> = {
      "confirm-payment": "Payment confirmed.",
      "mark-payment-not-required": "Payment marked not required.",
      approve: approvedReadyCopy(),
    };
    await runSingle(action, messages[action]);
  }

  return (
    <div className="space-y-3" data-testid="fo-order-review-actions">
      {isReady ? (
        <div
          className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950"
          data-testid="fo-approved-ready-banner"
        >
          <p className="font-medium">{approvedReadyCopy()}</p>
          <p className="mt-1 text-xs text-violet-800">
            Activation stays in Fulfillment Ops. This order is approved and waiting to be
            activated there.
          </p>
          <a
            href={fulfillmentOpsHref(order.id)}
            className="mt-2 inline-flex text-xs font-medium text-violet-900 underline underline-offset-2"
            data-testid="fo-fulfillment-ops-link"
          >
            Open Fulfillment Ops
          </a>
        </div>
      ) : null}

      {actions.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {actions.map((action) => (
            <Button
              key={action}
              type="button"
              size="sm"
              variant={action === "confirm-and-approve" || action === "approve" ? "default" : "outline"}
              disabled={busy != null}
              data-testid={`fo-review-action-${action}`}
              onClick={() => void handleAction(action)}
            >
              {busy === action ? "Working…" : ACTION_LABEL[action]}
            </Button>
          ))}
        </div>
      ) : null}

      {notice ? (
        <p
          className={
            notice.tone === "ok"
              ? "text-xs text-emerald-800"
              : notice.tone === "warn"
                ? "text-xs text-amber-800"
                : "text-xs text-red-700"
          }
          data-testid="fo-review-notice"
          role="status"
        >
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
