import "server-only";

import {
  adminFetchJson,
  adminRequestJson,
  formatAdminApiError,
} from "@/lib/admin-api/server";
import {
  mapApiLeadOrderToFrontOffice,
  type ApiLeadOrderRow,
} from "../live/orders-bridge";
import type { LeadOrder } from "../types";

export type LeadOrderReviewActionResult =
  | { ok: true; order: LeadOrder }
  | {
      ok: false;
      status: number;
      error: string;
      code?: string;
      reasons?: string[];
      order?: LeadOrder;
    };

type AdminMutationBody = {
  ok?: boolean;
  item?: unknown;
  error?: string;
  reasons?: string[];
};

function asAdminFailure(res: { status: number; body: string }) {
  return { ok: false as const, status: res.status, body: res.body };
}

function parseFailure(
  res: { status: number; body: string },
  fallback: string
): LeadOrderReviewActionResult {
  const failure = asAdminFailure(res);
  try {
    const parsed = JSON.parse(res.body) as AdminMutationBody;
    const item = parsed.item
      ? mapApiLeadOrderToFrontOffice(parsed.item as ApiLeadOrderRow)
      : undefined;
    return {
      ok: false,
      status: res.status,
      error: parsed.error ?? formatAdminApiError(failure),
      code: parsed.error,
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : undefined,
      order: item,
    };
  } catch {
    if (res.status === 0 || res.status === 502 || res.status === 503 || res.status === 504) {
      return { ok: false, status: res.status || 503, error: fallback, code: "api_unavailable" };
    }
    return { ok: false, status: res.status, error: formatAdminApiError(failure) };
  }
}

function mapSuccess(item: unknown): LeadOrderReviewActionResult {
  if (!item || typeof item !== "object") {
    return { ok: false, status: 502, error: "Admin API returned no order.", code: "empty_item" };
  }
  return { ok: true, order: mapApiLeadOrderToFrontOffice(item as ApiLeadOrderRow) };
}

export async function fetchLeadOrderForReview(id: string): Promise<LeadOrderReviewActionResult> {
  const res = await adminFetchJson<AdminMutationBody>(
    `/admin/v1/lead-orders/${encodeURIComponent(id)}`
  );
  if (!res.ok) {
    return parseFailure(res, "API unavailable. Refresh and try again.");
  }
  return mapSuccess(res.data.item);
}

export async function confirmLeadOrderPaymentAdmin(
  id: string,
  confirmedBy?: string | null
): Promise<LeadOrderReviewActionResult> {
  const res = await adminRequestJson<AdminMutationBody>(
    "POST",
    `/admin/v1/lead-orders/${encodeURIComponent(id)}/confirm-payment`,
    confirmedBy ? { confirmedBy } : {}
  );
  if (!res.ok) {
    return parseFailure(res, "API unavailable. Refresh and try again.");
  }
  return mapSuccess(res.data.item);
}

export async function markLeadOrderPaymentNotRequiredAdmin(
  id: string,
  confirmedBy?: string | null
): Promise<LeadOrderReviewActionResult> {
  const res = await adminRequestJson<AdminMutationBody>(
    "POST",
    `/admin/v1/lead-orders/${encodeURIComponent(id)}/mark-payment-not-required`,
    confirmedBy ? { confirmedBy } : {}
  );
  if (!res.ok) {
    return parseFailure(res, "API unavailable. Refresh and try again.");
  }
  return mapSuccess(res.data.item);
}

export async function approveLeadOrderAdmin(id: string): Promise<LeadOrderReviewActionResult> {
  const res = await adminRequestJson<AdminMutationBody>(
    "POST",
    `/admin/v1/lead-orders/${encodeURIComponent(id)}/approve`,
    {}
  );
  if (!res.ok) {
    return parseFailure(res, "API unavailable. Refresh and try again.");
  }
  return mapSuccess(res.data.item);
}
