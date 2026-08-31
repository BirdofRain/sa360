"use server";

import { redirect } from "next/navigation";

import { postPortalInviteAccept } from "@/lib/client-portal-api/portal-context";
import {
  evaluateInvitePassword,
  isWellFormedPortalInviteToken,
  PORTAL_INVITE_INVALID,
  PORTAL_INVITE_SUCCESS_LOGIN_PATH,
} from "@/lib/client-portal/portal-invite-flow";

export async function portalInviteAcceptAction(
  _prev: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string }> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!isWellFormedPortalInviteToken(token)) {
    return { error: PORTAL_INVITE_INVALID };
  }

  const policy = evaluateInvitePassword(password);
  if (!policy.ok) {
    return { error: policy.error };
  }

  const result = await postPortalInviteAccept(token, password);
  if (!result.ok) {
    if (result.code === "PASSWORD_INVALID") {
      return { error: result.error };
    }
    return { error: PORTAL_INVITE_INVALID };
  }

  redirect(PORTAL_INVITE_SUCCESS_LOGIN_PATH);
}
