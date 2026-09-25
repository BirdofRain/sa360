"use server";

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_COC_SESSION_COOKIE,
  getAdminCocObserverPassword,
  getAdminCocPassword,
  isAdminCocObserverLoginAvailable,
  isAdminCocSessionIssuanceReady,
} from "@/lib/admin-coc-auth";
import {
  ADMIN_COC_ROLE_ADMIN,
  ADMIN_COC_ROLE_OBSERVER,
  observerLandingPath,
  type AdminCocRole,
} from "@/lib/admin-coc-observer-access";
import {
  ADMIN_COC_SESSION_SECRET_REQUIRED,
  adminCocSessionCookieClearOptions,
  adminCocSessionCookieOptions,
  createAdminCocSessionToken,
} from "@/lib/admin-coc-session";

function timingSafeStringEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function safeNextPath(raw: FormDataEntryValue | null): string {
  if (typeof raw !== "string") return "/";
  const v = raw.trim();
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\")) return "/";
  return v;
}

/**
 * Server action invoked by the login form. On success sets a signed, expiring
 * session cookie and redirects to the originally requested path (or `/`).
 */
export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  const expected = getAdminCocPassword();
  if (!expected) {
    return { error: "Admin password is not configured on the server." };
  }
  if (!isAdminCocSessionIssuanceReady()) {
    return { error: ADMIN_COC_SESSION_SECRET_REQUIRED };
  }

  const provided = String(formData.get("password") ?? "");
  const observerPassword = getAdminCocObserverPassword();
  const observerAvailable = isAdminCocObserverLoginAvailable();
  let role: AdminCocRole | null = null;
  if (provided && timingSafeStringEqual(provided, expected)) {
    role = ADMIN_COC_ROLE_ADMIN;
  } else if (
    observerAvailable &&
    observerPassword &&
    provided &&
    timingSafeStringEqual(provided, observerPassword)
  ) {
    role = ADMIN_COC_ROLE_OBSERVER;
  }
  if (!role) {
    return { error: "Incorrect password." };
  }

  const token = createAdminCocSessionToken(undefined, undefined, role);
  if (!token) {
    return { error: ADMIN_COC_SESSION_SECRET_REQUIRED };
  }

  const requested = safeNextPath(formData.get("next"));
  const next = role === ADMIN_COC_ROLE_OBSERVER ? observerLandingPath(requested) : requested;
  const store = await cookies();
  store.set(adminCocSessionCookieOptions(token));
  redirect(next);
}

export async function logoutAction() {
  const store = await cookies();
  store.set(adminCocSessionCookieClearOptions());
  store.delete(ADMIN_COC_SESSION_COOKIE);
  redirect("/login");
}
