"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  CLIENT_PORTAL_ACCESS_COOKIE,
  portalSignedSessionCookieOptions,
  portalLoginPath,
} from "@/lib/client-portal/access-gate";
import {
  authenticatePortalLogin,
  isClientPortalLoginConfigured,
} from "@/lib/client-portal/portal-auth";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";
import { PORTAL_LOGIN_NOT_CONFIGURED } from "@/lib/client-portal/portal-login-flow";

function safeNextPath(raw: FormDataEntryValue | null): string {
  if (typeof raw !== "string") return "/portal";
  const v = raw.trim();
  if (!v.startsWith("/portal") || v.startsWith("//") || v.includes("\\")) return "/portal";
  return v;
}

export async function portalLoginAction(
  _prev: { error?: string } | undefined,
  formData: FormData
) {
  if (!isClientPortalLoginConfigured()) {
    return { error: PORTAL_LOGIN_NOT_CONFIGURED };
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const auth = await authenticatePortalLogin(email, password);
  if (!auth.ok) {
    return { error: auth.error };
  }

  const cookieOpts = portalSignedSessionCookieOptions(auth.session);
  if (!cookieOpts) {
    return { error: PORTAL_LOGIN_NOT_CONFIGURED };
  }

  const next = safeNextPath(formData.get("next"));
  const store = await cookies();
  store.set(cookieOpts);
  store.delete(CLIENT_PORTAL_ACCESS_COOKIE);
  redirect(next);
}

export async function portalLogoutAction() {
  const store = await cookies();
  store.delete(CLIENT_PORTAL_SESSION_COOKIE);
  store.delete(CLIENT_PORTAL_ACCESS_COOKIE);
  redirect(portalLoginPath());
}
