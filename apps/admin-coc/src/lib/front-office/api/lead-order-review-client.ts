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

export const FRONT_OFFICE_ORDERS_API = "/api/front-office/orders";
export const COC_ORDERS_API = "/api/coc/orders";

function frontOfficeRoleQuery(): string {
  if (typeof window === "undefined") return "";
  const role = new URLSearchParams(window.location.search).get("role");
  return role ? `?role=${encodeURIComponent(role)}` : "";
}

export function reviewActionPath(
  id: string,
  action: OrderReviewClientAction,
  apiBase: string = FRONT_OFFICE_ORDERS_API
): string {
  const path = `${apiBase}/${encodeURIComponent(id)}/${ACTION_PATH[action]}`;
  return apiBase === FRONT_OFFICE_ORDERS_API ? `${path}${frontOfficeRoleQuery()}` : path;
}

export function reviewDetailPath(id: string, apiBase: string = FRONT_OFFICE_ORDERS_API): string {
  const path = `${apiBase}/${encodeURIComponent(id)}`;
  return apiBase === FRONT_OFFICE_ORDERS_API ? `${path}${frontOfficeRoleQuery()}` : path;
}

export async function postOrderReviewAction(
  id: string,
  action: OrderReviewClientAction,
  requestImpl: typeof fetch = fetch,
  apiBase?: string
): Promise<ReviewMutationResult> {
  try {
    const res = await requestImpl(reviewActionPath(id, action, apiBase), {
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
  requestImpl: typeof fetch = fetch,
  apiBase?: string
): Promise<ReviewMutationResult> {
  try {
    const res = await requestImpl(reviewDetailPath(id, apiBase), {
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
