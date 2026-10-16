import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_COC_ROLE_ADMIN,
  ADMIN_COC_ROLE_OBSERVER,
} from "./admin-coc-observer-access.ts";
import { AdminCocForbiddenError, readAdminCocSessionRole } from "./admin-coc-session-guard.ts";
import { META_REVIEWER_SESSION_COOKIE } from "./meta-reviewer-auth.ts";
import { classifyMetaReviewApiPath } from "./meta-reviewer-access.ts";
import {
  parseMetaReviewerSessionToken,
  type MetaReviewerSessionPayload,
} from "./meta-reviewer-session.ts";

/**
 * Test-only cookie override. Undefined falls through to next/headers.
 * Empty string means the reviewer cookie is absent.
 */
let testSessionCookie: string | undefined;

export function useMetaReviewerTestSessionCookie(value: string | undefined): void {
  testSessionCookie = value;
}

export async function readMetaReviewerSessionCookieValue(): Promise<string | undefined> {
  if (testSessionCookie !== undefined) return testSessionCookie;
  try {
    const store = await cookies();
    return store.get(META_REVIEWER_SESSION_COOKIE)?.value;
  } catch {
    return undefined;
  }
}

export async function readValidMetaReviewerSession(): Promise<MetaReviewerSessionPayload | null> {
  const cookie = await readMetaReviewerSessionCookieValue();
  return parseMetaReviewerSessionToken(cookie);
}

export type MetaReviewAudience = "admin" | "reviewer";

/**
 * Admin operators keep the existing workspace. A valid reviewer session is
 * read-only. Observers stay forbidden. Anonymous operators return to /login;
 * a stale reviewer cookie returns to the reviewer login.
 */
export async function resolveMetaReviewAudience(): Promise<MetaReviewAudience> {
  const adminRole = await readAdminCocSessionRole();
  if (adminRole === ADMIN_COC_ROLE_ADMIN) return "admin";
  const reviewer = await readValidMetaReviewerSession();
  if (reviewer) return "reviewer";
  if (adminRole === ADMIN_COC_ROLE_OBSERVER) throw new AdminCocForbiddenError();
  const raw = await readMetaReviewerSessionCookieValue();
  if (raw) redirect("/meta-review/login");
  redirect("/login");
}

export async function requireMetaReviewReadSession(): Promise<void> {
  await resolveMetaReviewAudience();
}

/**
 * Reviewer sessions cannot mutate, including when the write flag is on.
 * A simultaneous admin session keeps operator rights.
 */
export async function denyMetaReviewerMutation(): Promise<void> {
  const adminRole = await readAdminCocSessionRole();
  if (adminRole === ADMIN_COC_ROLE_ADMIN) return;
  if (await readValidMetaReviewerSession()) throw new AdminCocForbiddenError();
}

/**
 * Gate before the server-only admin API key is attached.
 * Reviewers may only proxy the fixed read paths. Subscription POST stays admin-only.
 * Any other path is denied for every caller of this helper.
 */
export async function metaReviewApiDenied(
  method: string,
  path: string
): Promise<{ ok: false; status: number; body: string } | null> {
  const kind = classifyMetaReviewApiPath(path);
  if (!kind) return { ok: false, status: 403, body: "Forbidden" };

  const adminRole = await readAdminCocSessionRole();
  if (adminRole === ADMIN_COC_ROLE_ADMIN) {
    if (method === "GET" && kind === "read") return null;
    if (method === "POST" && kind === "subscribe") return null;
    return { ok: false, status: 403, body: "Forbidden" };
  }
  if (adminRole === ADMIN_COC_ROLE_OBSERVER) {
    return { ok: false, status: 403, body: "Forbidden" };
  }

  const reviewer = await readValidMetaReviewerSession();
  if (!reviewer) return { ok: false, status: 401, body: "Sign in required" };
  if (method === "GET" && kind === "read") return null;
  return { ok: false, status: 403, body: "Forbidden" };
}
