import "server-only";

import {
  guardPortalOrderCreateEligibility,
  mapPortalOrderCreateSuccess,
  parsePortalOrderCreateError,
  portalOrderRequestHasForbiddenFields,
  type PortalOrderCreateSuccessView,
} from "../client-portal/portal-order-request.ts";
import { fetchClientAccountProfile } from "./account.ts";
import { createClientLeadOrder } from "./server.ts";

export type PortalOrderCreateFailure = {
  ok: false;
  status: number;
  error: string;
  code?: "ACCOUNT_NOT_READY_TO_ORDER" | "VALIDATION" | "FORBIDDEN_FIELDS" | "API";
};

export type PortalOrderCreateOk = {
  ok: true;
  item: PortalOrderCreateSuccessView;
};

export async function resolvePortalOrderCreateEligibility(opts: {
  clientAccountId: string;
}): Promise<PortalOrderCreateFailure | { ok: true }> {
  const result = await fetchClientAccountProfile({
    clientAccountId: opts.clientAccountId,
  });
  if (result.error || !result.account) {
    return {
      ok: false,
      status: 409,
      code: "ACCOUNT_NOT_READY_TO_ORDER",
      error: "We could not confirm that your account is ready to place an order.",
    };
  }
  const blocked = guardPortalOrderCreateEligibility(result.account);
  if (blocked) return blocked;
  return { ok: true };
}

export async function submitPortalOrderCreate(opts: {
  clientAccountId: string;
  body: Record<string, unknown>;
}): Promise<PortalOrderCreateOk | PortalOrderCreateFailure> {
  if (portalOrderRequestHasForbiddenFields(opts.body)) {
    return {
      ok: false,
      status: 400,
      code: "FORBIDDEN_FIELDS",
      error: "Order request includes fields that customers cannot set.",
    };
  }
  const result = await createClientLeadOrder({
    clientAccountId: opts.clientAccountId,
    body: opts.body,
  });
  if (result.error || !result.item) {
    return {
      ok: false,
      status: result.status || 502,
      code: result.status === 409 ? "ACCOUNT_NOT_READY_TO_ORDER" : "API",
      error: parsePortalOrderCreateError(result.error ?? ""),
    };
  }
  const item = mapPortalOrderCreateSuccess(result.item);
  if (!item) {
    return {
      ok: false,
      status: 502,
      code: "API",
      error: "We could not read the submitted order request.",
    };
  }
  return { ok: true, item };
}
