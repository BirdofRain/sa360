import type { LeadOrder } from "../types";
import type { ReviewAction, ReviewMutationResult } from "../order-review";

export type OrderReviewClientAction =
  | "confirm-payment"
  | "mark-payment-not-required"
  | "approve";

const ACTION_PATH: Record<OrderReviewClientAction, string> = {
  "confirm-payment": "confirm-payment",
  "mark-payment-not-required": "mark-payment-not-required",
  approve: "approve",
};

function frontOfficeRoleQuery(): string {
  if (typeof window === "undefined") return "";
  const role = new URLSearchParams(window.location.search).get("role");
  return role ? `?role=${encodeURIComponent(role)}` : "";
}

export function reviewActionPath(id: string, action: OrderReviewClientAction): string {
  return `/api/front-office/orders/${encodeURIComponent(id)}/${ACTION_PATH[action]}${frontOfficeRoleQuery()}`;
}

export function reviewDetailPath(id: string): string {
  return `/api/front-office/orders/${encodeURIComponent(id)}${frontOfficeRoleQuery()}`;
}

export async function postOrderReviewAction(
  id: string,
  action: OrderReviewClientAction,
  requestImpl: typeof fetch = fetch
): Promise<ReviewMutationResult> {
  try {
    const res = await requestImpl(reviewActionPath(id, action), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
    const data = (await res.json().catch(() => ({}))) as ReviewMutationResult & {
      order?: LeadOrder;
    };
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        status: res.status,
        error: data.error,
        code: data.code ?? data.error,
        reasons: data.reasons,
        order: data.order,
      };
    }
    return { ok: true, order: data.order, status: res.status };
  } catch {
    return { ok: false, status: 0, error: "API unavailable. Refresh and try again.", code: "api_unavailable" };
  }
}

export async function fetchOrderReviewDetail(
  id: string,
  requestImpl: typeof fetch = fetch
): Promise<ReviewMutationResult> {
  try {
    const res = await requestImpl(reviewDetailPath(id), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as ReviewMutationResult & {
      order?: LeadOrder;
    };
    if (!res.ok || !data.ok || !data.order) {
      return {
        ok: false,
        status: res.status,
        error: data.error,
        code: data.code ?? data.error,
        reasons: data.reasons,
      };
    }
    return { ok: true, order: data.order, status: res.status };
  } catch {
    return { ok: false, status: 0, error: "API unavailable. Refresh and try again.", code: "api_unavailable" };
  }
}

export function isCombinedReviewAction(action: ReviewAction): action is "confirm-and-approve" {
  return action === "confirm-and-approve";
}
