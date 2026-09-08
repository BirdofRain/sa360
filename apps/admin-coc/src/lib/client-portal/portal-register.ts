import type { PortalClientContextResponse } from "../client-portal-api/portal-context.ts";
import type { PortalSessionCreateInput } from "./portal-session.ts";

export const PORTAL_REGISTER_GENERIC_ERROR =
  "We could not create your account. If you already have one, sign in.";
export const PORTAL_REGISTER_NOT_CONFIGURED =
  "Account creation is not available right now. Please try again later.";
export const PUBLIC_PLACE_ORDER_HREF = "/portal/orders/new";

export type PortalRegisterApiSuccess = {
  portalSessionEpoch: number;
  status: string;
  context: PortalClientContextResponse;
};

export function portalSessionFromRegisterResponse(
  data: PortalRegisterApiSuccess
): PortalSessionCreateInput | null {
  const clientAccountId = data.context.clientAccountId?.trim();
  const portalLoginEmail = data.context.portalLoginEmail?.trim();
  if (!clientAccountId || !portalLoginEmail) return null;
  if (!data.context.portalEnabled) return null;
  return {
    clientAccountId,
    clientDisplayName: data.context.clientDisplayName,
    portalDisplayName: data.context.portalDisplayName,
    portalLoginEmail,
    portalSessionEpoch: data.portalSessionEpoch,
  };
}

export function publicRegisterErrorCopy(error: string | undefined, status: number): string {
  const raw = error?.trim() ?? "";
  if (status === 429 || /too many attempts/i.test(raw)) {
    return "Too many attempts. Try again later.";
  }
  if (status === 403 || /not available from this site/i.test(raw)) {
    return "Registration is not available from this site.";
  }
  if (/10 to 128 characters/i.test(raw)) {
    return raw;
  }
  if (/passwords do not match/i.test(raw)) {
    return raw;
  }
  return PORTAL_REGISTER_GENERIC_ERROR;
}
