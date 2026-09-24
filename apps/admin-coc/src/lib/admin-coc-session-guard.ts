import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_COC_SESSION_COOKIE, isAdminCocPasswordConfigured } from "./admin-coc-auth.ts";
import {
  ADMIN_COC_ROLE_ADMIN,
  ADMIN_COC_ROLE_OBSERVER,
  isObserverAdminApiGetAllowed,
  isObserverBffReadAllowed,
  type AdminCocRole,
} from "./admin-coc-observer-access.ts";
import {
  ADMIN_COC_SIGN_IN_REQUIRED,
  isAdminCocSessionAuthorized,
  parseAdminCocSessionToken,
} from "./admin-coc-session.ts";

export const ADMIN_COC_FORBIDDEN = "Forbidden";

export class AdminCocForbiddenError extends Error {
  readonly status = 403;
  constructor() {
    super(ADMIN_COC_FORBIDDEN);
    this.name = "AdminCocForbiddenError";
  }
}

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
/**
 * Local-dev fail-open (password unset) is ADMIN. A signed token without `role`
 * is ADMIN. Observer exists only on an explicit SA360_OBSERVER claim.
 */
export async function readAdminCocSessionRole(): Promise<AdminCocRole | null> {
  if (!isAdminCocPasswordConfigured()) return ADMIN_COC_ROLE_ADMIN;
  const cookie = await readAdminCocSessionCookieValue();
  return parseAdminCocSessionToken(cookie)?.role ?? null;
}

/** Any signed Admin C.O.C. session (admin or observer). Anonymous users redirect to login. */
export async function requireAdminCocSession(): Promise<void> {
  const cookie = await readAdminCocSessionCookieValue();
  if (isAdminCocSessionAuthorized(cookie)) return;
  redirect("/login");
}

/** Read actions on the observer allowlist. Same gate as `requireAdminCocSession`. */
export async function requireAdminCocReadSession(): Promise<void> {
  await requireAdminCocSession();
}

/** Mutations and privileged surfaces. Observers receive a 403 error, not a login redirect. */
export async function requireAdminCocAdminSession(): Promise<void> {
  await requireAdminCocSession();
  const role = await readAdminCocSessionRole();
  if (role === ADMIN_COC_ROLE_ADMIN) return;
  throw new AdminCocForbiddenError();
}

export async function unauthorizedAdminCocBffResponse(): Promise<Response | null> {
  const cookie = await readAdminCocSessionCookieValue();
  if (isAdminCocSessionAuthorized(cookie)) return null;
  return Response.json({ ok: false, error: ADMIN_COC_SIGN_IN_REQUIRED }, { status: 401 });
}

/** 403 when an observer calls a BFF route that is not an approved read. */
export async function forbiddenObserverAdminCocBffResponse(
  method: string,
  pathname: string
): Promise<Response | null> {
  const role = await readAdminCocSessionRole();
  if (role !== ADMIN_COC_ROLE_OBSERVER) return null;
  if (isObserverBffReadAllowed(method, pathname)) return null;
  return Response.json({ ok: false, error: ADMIN_COC_FORBIDDEN }, { status: 403 });
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

/**
 * Blocks an observer from using the server-side admin API key except for
 * allowlisted GETs. Call this before attaching `x-sa360-admin-key`.
 */
export async function observerAdminApiKeyDenied(
  method: string,
  path: string
): Promise<{ ok: false; status: number; body: string } | null> {
  const role = await readAdminCocSessionRole();
  if (role !== ADMIN_COC_ROLE_OBSERVER) return null;
  if (method === "GET" && isObserverAdminApiGetAllowed(path)) return null;
  return { ok: false, status: 403, body: ADMIN_COC_FORBIDDEN };
}
