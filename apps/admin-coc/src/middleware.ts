import { NextResponse, type NextRequest } from "next/server";

import {
  ADMIN_COC_SESSION_COOKIE,
  ADMIN_COC_SESSION_VALUE,
} from "@/lib/admin-coc-auth";
import {
  AGENT_WORKSPACE_EMBED_CSP_HEADER,
  getContentSecurityPolicyForAgentWorkspaceEmbed,
} from "@/lib/agent-workspace-embed-security";

/**
 * Single-password gate for the admin dashboard.
 *
 * - Skips `/login` and the login server action endpoint.
 * - Skips when `ADMIN_COC_PASSWORD` is unset/empty (dev convenience).
 * - Otherwise requires the `sa360_admin_session` cookie with the canonical marker value.
 *   On failure, redirects to `/login?next=<original path + search>`.
 *
 * Runs on the Edge runtime; `process.env` is inlined at build time for the env
 * vars referenced here, so reading at runtime is supported in Next 15.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/login") return NextResponse.next();

  /**
   * Embedded Agent Workspace HTML: allow framing from GHL via CSP `frame-ancestors` only on
   * this document route — not on `/api/agent-workspace/*` (JSON fetches) and not on the rest
   * of the admin app (dashboard must stay non-embeddable in random third-party frames).
   */
  if (pathname === "/agent-workspace" || pathname.startsWith("/agent-workspace/")) {
    const res = NextResponse.next();
    res.headers.set(
      AGENT_WORKSPACE_EMBED_CSP_HEADER,
      getContentSecurityPolicyForAgentWorkspaceEmbed()
    );
    return res;
  }

  /** Workspace API proxy: same-origin fetch targets; no embed CSP (not framed as HTML). */
  if (pathname.startsWith("/api/agent-workspace")) {
    return NextResponse.next();
  }

  const expected = process.env.ADMIN_COC_PASSWORD?.trim();
  if (!expected) return NextResponse.next();

  const cookie = request.cookies.get(ADMIN_COC_SESSION_COOKIE);
  if (cookie?.value === ADMIN_COC_SESSION_VALUE) return NextResponse.next();

  const target = new URL("/login", request.url);
  const requested = pathname + request.nextUrl.search;
  if (requested && requested !== "/") {
    target.searchParams.set("next", requested);
  }
  return NextResponse.redirect(target);
}

/**
 * Matcher excludes Next internals (_next), static files, and the favicon so
 * page-shell assets always load even when unauthenticated (the login page
 * needs CSS/fonts to render).
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
