import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_COC_SESSION_COOKIE } from "./admin-coc-auth.ts";
import {
  ADMIN_COC_SIGN_IN_REQUIRED,
  isAdminCocSessionAuthorized,
} from "./admin-coc-session.ts";

export async function readAdminCocSessionCookieValue(): Promise<string | undefined> {
  try {
    const store = await cookies();
    return store.get(ADMIN_COC_SESSION_COOKIE)?.value;
  } catch {
    return undefined;
  }
}

/**
 * Shared authorization for privileged Admin C.O.C. server actions and BFF
 * handlers. Does not consult the request pathname — posting a Server Action
 * through `/login` cannot satisfy this check.
 */
export async function requireAdminCocSession(): Promise<void> {
  const cookie = await readAdminCocSessionCookieValue();
  if (isAdminCocSessionAuthorized(cookie)) return;
  redirect("/login");
}

export async function unauthorizedAdminCocBffResponse(): Promise<Response | null> {
  const cookie = await readAdminCocSessionCookieValue();
  if (isAdminCocSessionAuthorized(cookie)) return null;
  return Response.json({ ok: false, error: ADMIN_COC_SIGN_IN_REQUIRED }, { status: 401 });
}

export function withAdminCocBff<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const denied = await unauthorizedAdminCocBffResponse();
    if (denied) return denied;
    return handler(...args);
  };
}

export async function adminCocAdminApiUnauthorized(): Promise<{
  ok: false;
  status: number;
  body: string;
} | null> {
  const cookie = await readAdminCocSessionCookieValue();
  if (isAdminCocSessionAuthorized(cookie)) return null;
  return { ok: false, status: 401, body: ADMIN_COC_SIGN_IN_REQUIRED };
}
