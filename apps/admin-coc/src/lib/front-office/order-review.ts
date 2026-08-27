import {
  PAYMENT_CONFIRMATION_DISPLAY,
  REVIEW_QUEUE_DISPLAY,
} from "./display";
import type {
  LeadOrder,
  LeadOrderPaymentConfirmationStatus,
  LeadOrderStatus,
} from "./types";

export const DEFAULT_PAYMENT_CONFIRMATION_STATUS: LeadOrderPaymentConfirmationStatus =
  "pending_confirmation";

export const FULFILLMENT_OPS_HREF = "/fulfillment-ops";

export type ReviewQueueKey =
  | "submitted_payment_pending"
  | "submitted_payment_confirmed"
  | "submitted_payment_not_required"
  | "approved_ready";

export type ReviewQueueFilter = "all" | "review" | ReviewQueueKey;

export type ReviewAction =
  | "confirm-payment"
  | "mark-payment-not-required"
  | "approve"
  | "confirm-and-approve";

export type ReviewMutationResult = {
  ok: boolean;
  order?: LeadOrder;
  status?: number;
  error?: string;
  code?: string;
  reasons?: string[];
};

export type CombinedReviewOutcome =
  | "approved"
  | "already_approved"
  | "confirm_failed"
  | "payment_confirmed_approval_failed";

const APPROVED_OR_LATER: ReadonlySet<LeadOrderStatus> = new Set([
  "ready",
  "active",
  "paused",
  "completed",
]);

const APPROVABLE_FROM: ReadonlySet<LeadOrderStatus> = new Set([
  "draft",
  "submitted",
  "needs_setup",
  "needs_compliance",
  "ready",
]);

export function resolvePaymentConfirmationStatus(
  value: LeadOrderPaymentConfirmationStatus | string | null | undefined
): LeadOrderPaymentConfirmationStatus {
  if (value === "confirmed" || value === "not_required" || value === "pending_confirmation") {
    return value;
  }
  return DEFAULT_PAYMENT_CONFIRMATION_STATUS;
}

export function paymentAllowsApproval(
  payment: LeadOrderPaymentConfirmationStatus
): boolean {
  return payment === "confirmed" || payment === "not_required";
}

export function orderStatusOf(order: Pick<LeadOrder, "status" | "adminStatus">): LeadOrderStatus {
  return (order.status ?? order.adminStatus) as LeadOrderStatus;
}

export function resolveReviewQueueKey(order: LeadOrder): ReviewQueueKey | null {
  const status = orderStatusOf(order);
  const payment = resolvePaymentConfirmationStatus(order.paymentConfirmationStatus);
  if (status === "ready") return "approved_ready";
  if (status !== "submitted") return null;
  if (payment === "confirmed") return "submitted_payment_confirmed";
  if (payment === "not_required") return "submitted_payment_not_required";
  return "submitted_payment_pending";
}

export function reviewQueueLabel(order: LeadOrder): string | null {
  const key = resolveReviewQueueKey(order);
  return key ? REVIEW_QUEUE_DISPLAY[key].label : null;
}

export function reviewQueueClassName(order: LeadOrder): string | null {
  const key = resolveReviewQueueKey(order);
  return key ? REVIEW_QUEUE_DISPLAY[key].className : null;
}

export function paymentLabel(order: LeadOrder): string {
  return PAYMENT_CONFIRMATION_DISPLAY[
    resolvePaymentConfirmationStatus(order.paymentConfirmationStatus)
  ].label;
}

export function matchesReviewQueueFilter(order: LeadOrder, filter: ReviewQueueFilter): boolean {
  if (filter === "all") return true;
  const key = resolveReviewQueueKey(order);
  if (filter === "review") return key != null;
  return key === filter;
}

export function fulfillmentOpsHref(orderId?: string): string {
  if (!orderId) return FULFILLMENT_OPS_HREF;
  return `${FULFILLMENT_OPS_HREF}?orderId=${encodeURIComponent(orderId)}`;
}

export function availableReviewActions(order: LeadOrder): ReviewAction[] {
  const status = orderStatusOf(order);
  const payment = resolvePaymentConfirmationStatus(order.paymentConfirmationStatus);
  if (status === "canceled") return [];

  const actions: ReviewAction[] = [];
  const canApproveStatus = APPROVABLE_FROM.has(status) && !APPROVED_OR_LATER.has(status);

  if (payment === "pending_confirmation") {
    if (canApproveStatus) actions.push("confirm-and-approve");
    actions.push("confirm-payment");
    actions.push("mark-payment-not-required");
  }

  if (paymentAllowsApproval(payment) && canApproveStatus) {
    actions.push("approve");
  }

  return actions;
}

export function mapReviewApiError(input: {
  status?: number;
  error?: string;
  code?: string;
  reasons?: string[];
}): string {
  const code = input.code ?? input.error;
  const reasons = input.reasons ?? [];
  const joined = [code, ...reasons].filter(Boolean).join(" ");

  if (input.status === 0 || input.status === 502 || input.status === 503 || input.status === 504) {
    return "API unavailable. Refresh and try again.";
  }

  if (
    code === "payment_confirmation_required" ||
    reasons.includes("payment_confirmation_required")
  ) {
    return "Payment must be confirmed or marked not required before approval.";
  }
  if (reasons.includes("order_canceled") || joined.includes("order_canceled")) {
    return "This order is canceled and cannot be approved.";
  }
  if (code === "order_not_approvable" || reasons.includes("order_not_approvable")) {
    return "This order cannot be approved in its current status.";
  }
  if (
    code === "submitted_cannot_activate" ||
    reasons.includes("submitted_cannot_activate")
  ) {
    return "Submitted orders cannot be activated here. Approve first, then use Fulfillment Ops.";
  }
  if (code === "activation_requires_ready" || reasons.includes("activation_requires_ready")) {
    return "Activation requires an approved (ready) order. Use Fulfillment Ops after approval.";
  }
  if (input.status === 409) {
    return input.error
      ? `This order cannot be updated (${input.error}). Refresh to see the current state.`
      : "This order cannot be updated in its current state. Refresh and try again.";
  }
  if (input.error && input.error.trim()) return input.error;
  return "The order could not be updated. Refresh and try again.";
}

export async function runConfirmAndApprove(opts: {
  confirm: () => Promise<ReviewMutationResult>;
  approve: () => Promise<ReviewMutationResult>;
}): Promise<{
  outcome: CombinedReviewOutcome;
  order?: LeadOrder;
  message: string;
  status?: number;
  code?: string;
  reasons?: string[];
}> {
  const confirmed = await opts.confirm();
  if (!confirmed.ok) {
    return {
      outcome: "confirm_failed",
      order: confirmed.order,
      message: mapReviewApiError(confirmed),
      status: confirmed.status,
      code: confirmed.code,
      reasons: confirmed.reasons,
    };
  }

  const approved = await opts.approve();
  if (!approved.ok) {
    return {
      outcome: "payment_confirmed_approval_failed",
      order: approved.order ?? confirmed.order,
      message: `Payment confirmed, approval failed. ${mapReviewApiError(approved)}`,
      status: approved.status,
      code: approved.code,
      reasons: approved.reasons,
    };
  }

  const status = approved.order ? orderStatusOf(approved.order) : undefined;
  if (status && APPROVED_OR_LATER.has(status) && status !== "ready") {
    return {
      outcome: "already_approved",
      order: approved.order,
      message: "This order is already approved.",
    };
  }

  return {
    outcome: status === "ready" ? "approved" : "already_approved",
    order: approved.order ?? confirmed.order,
    message:
      status === "ready"
        ? "Approved — ready for fulfillment"
        : "This order is already approved.",
  };
}

export function approvedReadyCopy(): string {
  return "Approved — ready for fulfillment";
}

export function hasActivateShortcut(labels: string[]): boolean {
  return labels.some((label) => /^activate$/i.test(label.trim()));
}
