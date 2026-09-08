"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { evaluatePortalPasswordConfirmation } from "@sa360/shared";

import { portalSignedSessionCookieOptions, CLIENT_PORTAL_ACCESS_COOKIE } from "@/lib/client-portal/access-gate";
import {
  PORTAL_REGISTER_GENERIC_ERROR,
  PORTAL_REGISTER_NOT_CONFIGURED,
  portalSessionFromRegisterResponse,
  publicRegisterErrorCopy,
} from "@/lib/client-portal/portal-register";
import {
  postPortalRegister,
  registerForwardHeadersFromRequest,
} from "@/lib/client-portal-api/portal-register";
import { PUBLIC_SETUP_PATH } from "@/lib/public-site/marketing-paths";
import { isClientPortalApiConfigured } from "@/lib/client-portal-api/keys";

export type PortalRegisterActionState = { error?: string };

export async function portalRegisterAction(
  _prev: PortalRegisterActionState | undefined,
  formData: FormData
): Promise<PortalRegisterActionState> {
  if (!isClientPortalApiConfigured()) {
    return { error: PORTAL_REGISTER_NOT_CONFIGURED };
  }

  const agencyName = String(formData.get("agencyName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (agencyName.length < 2 || agencyName.length > 200 || !email) {
    return { error: PORTAL_REGISTER_GENERIC_ERROR };
  }

  const confirmation = evaluatePortalPasswordConfirmation(password, confirmPassword);
  if (!confirmation.ok) {
    return { error: confirmation.error };
  }

  const headerList = await headers();
  const result = await postPortalRegister(
    { agencyName, email, password },
    registerForwardHeadersFromRequest(headerList)
  );
  if (!result.ok) {
    return { error: publicRegisterErrorCopy(result.error, result.status) };
  }

  const session = portalSessionFromRegisterResponse(result.data);
  const cookieOpts = session ? portalSignedSessionCookieOptions(session) : null;
  if (!cookieOpts) {
    return { error: PORTAL_REGISTER_NOT_CONFIGURED };
  }

  const store = await cookies();
  store.set(cookieOpts);
  store.delete(CLIENT_PORTAL_ACCESS_COOKIE);
  redirect(PUBLIC_SETUP_PATH);
}
