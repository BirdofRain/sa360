import type { LeadOrderStatus } from "./lead-order.types.js";

export const LEAD_ORDER_PAYMENT_CONFIRMATION_STATUSES = [
  "pending_confirmation",
  "confirmed",
  "not_required",
] as const;

export type LeadOrderPaymentConfirmationStatus =
  (typeof LEAD_ORDER_PAYMENT_CONFIRMATION_STATUSES)[number];

export const DEFAULT_LEAD_ORDER_PAYMENT_CONFIRMATION_STATUS: LeadOrderPaymentConfirmationStatus =
  "pending_confirmation";

export type LeadOrderLifecycleFailure = {
  ok: false;
  error: string;
  reasons: string[];
};

export type LeadOrderLifecycleOk = { ok: true };

export type LeadOrderLifecycleCheck = LeadOrderLifecycleOk | LeadOrderLifecycleFailure;

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

const ACTIVATABLE_FROM: ReadonlySet<LeadOrderStatus> = new Set(["ready", "paused", "active"]);

export function isLeadOrderPaymentConfirmationStatus(
  value: unknown
): value is LeadOrderPaymentConfirmationStatus {
  return (
    typeof value === "string" &&
    (LEAD_ORDER_PAYMENT_CONFIRMATION_STATUSES as readonly string[]).includes(value)
  );
}

export function paymentAllowsApproval(
  payment: LeadOrderPaymentConfirmationStatus
): boolean {
  return payment === "confirmed" || payment === "not_required";
}

export function resolvePaymentConfirmationStatus(
  value: unknown
): LeadOrderPaymentConfirmationStatus {
  return isLeadOrderPaymentConfirmationStatus(value)
    ? value
    : DEFAULT_LEAD_ORDER_PAYMENT_CONFIRMATION_STATUS;
}

export function assertCanApproveOrder(input: {
  status: LeadOrderStatus;
  paymentConfirmationStatus: LeadOrderPaymentConfirmationStatus;
}): LeadOrderLifecycleCheck {
  if (!paymentAllowsApproval(input.paymentConfirmationStatus)) {
    return {
      ok: false,
      error: "payment_confirmation_required",
      reasons: ["payment_confirmation_required"],
    };
  }
  if (input.status === "canceled") {
    return {
      ok: false,
      error: "order_not_approvable",
      reasons: ["order_canceled"],
    };
  }
  if (APPROVABLE_FROM.has(input.status) || APPROVED_OR_LATER.has(input.status)) {
    return { ok: true };
  }
  return {
    ok: false,
    error: "order_not_approvable",
    reasons: ["order_not_approvable"],
  };
}

export function assertCanActivateOrder(input: {
  status: LeadOrderStatus;
}): LeadOrderLifecycleCheck {
  if (input.status === "submitted") {
    return {
      ok: false,
      error: "submitted_cannot_activate",
      reasons: ["submitted_cannot_activate", "activation_requires_ready"],
    };
  }
  if (ACTIVATABLE_FROM.has(input.status)) {
    return { ok: true };
  }
  return {
    ok: false,
    error: "activation_requires_ready",
    reasons: ["activation_requires_ready"],
  };
}

export function assertCanCreateWithStatus(input: {
  status: LeadOrderStatus;
}): LeadOrderLifecycleCheck {
  if (input.status === "active") {
    return {
      ok: false,
      error: "submitted_cannot_activate",
      reasons: ["submitted_cannot_activate", "activation_requires_ready"],
    };
  }
  if (input.status === "ready") {
    return {
      ok: false,
      error: "payment_confirmation_required",
      reasons: ["payment_confirmation_required", "create_cannot_skip_approval"],
    };
  }
  return { ok: true };
}

export function isAlreadyApprovedStatus(status: LeadOrderStatus): boolean {
  return APPROVED_OR_LATER.has(status);
}
