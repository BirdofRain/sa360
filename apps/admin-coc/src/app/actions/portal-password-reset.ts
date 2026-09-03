"use server";

import { headers } from "next/headers";

import { postPortalPasswordResetRequest } from "@/lib/client-portal-api/portal-context";
import {
  PORTAL_PASSWORD_RESET_GENERIC,
  portalForgotPasswordEmailValue,
} from "@/lib/client-portal/portal-password-reset-flow";

function clientIpFromRequestHeaders(h: Headers): string {
  const forwarded = h.get("x-forwarded-for");
  if (forwarded?.trim()) {
    return forwarded.split(",")[0]!.trim().slice(0, 128);
  }
  const realIp = h.get("x-real-ip");
  if (realIp?.trim()) {
    return realIp.trim().slice(0, 128);
  }
  return "unknown";
}

export async function portalPasswordResetRequestAction(
  _prev: { submitted?: boolean } | undefined,
  formData: FormData
): Promise<{ submitted: true; message: string }> {
  const email = portalForgotPasswordEmailValue(formData);
  const h = await headers();
  await postPortalPasswordResetRequest(email, clientIpFromRequestHeaders(h));
  return { submitted: true, message: PORTAL_PASSWORD_RESET_GENERIC };
}
