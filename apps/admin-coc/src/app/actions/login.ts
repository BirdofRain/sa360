"use server";

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_COC_SESSION_COOKIE,
  ADMIN_COC_SESSION_MAX_AGE_SECONDS,
  ADMIN_COC_SESSION_VALUE,
  getAdminCocPassword,
} from "@/lib/admin-coc-auth";

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
 * Server action invoked by the login form. On success sets the session
 * cookie and redirects to the originally requested path (or `/`).
 */
export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  const expected = getAdminCocPassword();
  if (!expected) {
    return { error: "Admin password is not configured on the server." };
  }

  const provided = String(formData.get("password") ?? "");
  if (!provided || !timingSafeStringEqual(provided, expected)) {
    return { error: "Incorrect password." };
  }

  const next = safeNextPath(formData.get("next"));

  const store = await cookies();
  store.set({
    name: ADMIN_COC_SESSION_COOKIE,
    value: ADMIN_COC_SESSION_VALUE,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_COC_SESSION_MAX_AGE_SECONDS,
  });

  redirect(next);
}

export async function logoutAction() {
  const store = await cookies();
  store.delete(ADMIN_COC_SESSION_COOKIE);
  redirect("/login");
}
