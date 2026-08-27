import "server-only";

import {
  guardPortalOrderCreateEligibility,
  mapPortalOrderCreateSuccess,
  parsePortalOrderCreateError,
  portalOrderRequestHasForbiddenFields,
  type PortalOrderCreateSuccessView,
} from "../client-portal/portal-order-request.ts";
import { createClientLeadOrder, fetchPortalClientContext } from "./server.ts";

export type PortalOrderCreateFailure = {
  ok: false;
  status: number;
  error: string;
  code?: "ACCOUNT_NOT_READY" | "VALIDATION" | "FORBIDDEN_FIELDS" | "API";
};

export type PortalOrderCreateOk = {
  ok: true;
  item: PortalOrderCreateSuccessView;
};

export async function resolvePortalOrderCreateEligibility(opts: {
  portalLoginEmail: string | null | undefined;
}): Promise<PortalOrderCreateFailure | { ok: true; context: unknown }> {
  const email = opts.portalLoginEmail?.trim();
  if (!email) return { ok: true, context: null };
  const result = await fetchPortalClientContext(email);
  if (!result.ok) return { ok: true, context: null };
  const blocked = guardPortalOrderCreateEligibility(result.data);
  if (blocked) return blocked;
  return { ok: true, context: result.data };
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
      status: 502,
      code: "API",
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
