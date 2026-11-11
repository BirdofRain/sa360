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
  parseAdminCocSessionToken,
} from "./admin-coc-session.ts";
import { readStaffAdminCocDecision, type StaffAdminCocDecision } from "./staff-admin-coc-access.ts";

export const ADMIN_COC_FORBIDDEN = "Forbidden";

export class AdminCocForbiddenError extends Error {
  readonly status = 403;
  constructor() {
    super(ADMIN_COC_FORBIDDEN);
    this.name = "AdminCocForbiddenError";
  }
}

/**
 * Test-only cookie override. Production handlers never set this.
 * Direct BFF tests use it because `cookies()` throws outside a request.
 */
let testSessionCookie: string | undefined;
let testStaffDecision: StaffAdminCocDecision | undefined;

export function useAdminCocTestSessionCookie(value: string | undefined): void {
  testSessionCookie = value;
}

/** Test-only staff grant decision. Production requests leave this unset and call the API. */
export function useStaffAdminCocTestDecision(value: StaffAdminCocDecision | undefined): void {
  testStaffDecision = value;
}

export type AdminCocAccess =
  | { kind: "admin"; source: "shared_password" | "staff" }
  | { kind: "observer" }
  | { kind: "staff_limited" }
  | { kind: "anonymous" };

/**
 * Shared-password admin and observer sessions stay on the ac1 cookie.
 * A staff admin is a separate live API decision. It is not an ac1 role claim.
 */
export async function readAdminCocAccess(): Promise<AdminCocAccess> {
  if (!isAdminCocPasswordConfigured()) return { kind: "admin", source: "shared_password" };
  const cookie = await readAdminCocSessionCookieValue();
  const role = parseAdminCocSessionToken(cookie)?.role ?? null;
  if (role === ADMIN_COC_ROLE_ADMIN) return { kind: "admin", source: "shared_password" };
  const staff = testStaffDecision ?? (await readStaffAdminCocDecision());
  if (staff === "admin") return { kind: "admin", source: "staff" };
  if (role === ADMIN_COC_ROLE_OBSERVER) return { kind: "observer" };
  if (staff === "limited") return { kind: "staff_limited" };
  return { kind: "anonymous" };
}

export async function readAdminCocSessionCookieValue(): Promise<string | undefined> {
  if (testSessionCookie !== undefined) return testSessionCookie;
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
  const access = await readAdminCocAccess();
  if (access.kind === "admin") return ADMIN_COC_ROLE_ADMIN;
  if (access.kind === "observer") return ADMIN_COC_ROLE_OBSERVER;
  return null;
}

/** Any signed Admin C.O.C. session (admin or observer). Anonymous users redirect to login. */
export async function requireAdminCocSession(): Promise<void> {
  const access = await readAdminCocAccess();
  if (access.kind === "admin" || access.kind === "observer") return;
  if (access.kind === "staff_limited") redirect("/staff");
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

/**
 * 401 when the caller has no Admin C.O.C. session.
 * When `request` is omitted, an observer is denied (403) — privileged handlers
 * that do not pass a URL cannot inherit an allowlist entry.
 * When `request` is present, only an exact allowlisted read returns null.
 */
export async function unauthorizedAdminCocBffResponse(
  request?: Request
): Promise<Response | null> {
  const access = await readAdminCocAccess();
  if (access.kind === "staff_limited") {
    return Response.json({ ok: false, error: ADMIN_COC_FORBIDDEN }, { status: 403 });
  }
  if (access.kind !== "admin" && access.kind !== "observer") {
    return Response.json({ ok: false, error: ADMIN_COC_SIGN_IN_REQUIRED }, { status: 401 });
  }
  const role = access.kind === "observer" ? ADMIN_COC_ROLE_OBSERVER : ADMIN_COC_ROLE_ADMIN;
  if (role !== ADMIN_COC_ROLE_OBSERVER) return null;
  if (!request) {
    return Response.json({ ok: false, error: ADMIN_COC_FORBIDDEN }, { status: 403 });
  }
  let pathname = "";
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return Response.json({ ok: false, error: ADMIN_COC_FORBIDDEN }, { status: 403 });
  }
  if (isObserverBffReadAllowed(request.method, pathname)) return null;
  return Response.json({ ok: false, error: ADMIN_COC_FORBIDDEN }, { status: 403 });
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
    const request = args.find((arg): arg is Request => arg instanceof Request);
    const denied = await unauthorizedAdminCocBffResponse(request);
    if (denied) return denied;
    return handler(...args);
  };
}

export async function adminCocAdminApiUnauthorized(): Promise<{
  ok: false;
  status: number;
  body: string;
} | null> {
  const access = await readAdminCocAccess();
  if (access.kind === "admin" || access.kind === "observer") return null;
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
