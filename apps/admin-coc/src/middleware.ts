import { NextResponse, type NextRequest } from "next/server";

import {
  ADMIN_COC_SESSION_COOKIE,
  ADMIN_COC_SESSION_VALUE,
} from "@/lib/admin-coc-auth";
import {
  AGENT_WORKSPACE_EMBED_CSP_HEADER,
  getContentSecurityPolicyForAgentWorkspaceEmbed,
} from "@/lib/agent-workspace-embed-security";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session-cookie";
import { verifyPortalSessionTokenEdge } from "@/lib/client-portal/portal-session-edge";

/**
 * Single-password gate for the admin dashboard.
 *
 * - Skips `/login` and the login server action endpoint.
 * - Skips when `ADMIN_COC_PASSWORD` is unset/empty (dev convenience).
 * - Otherwise requires the `sa360_admin_session` cookie with the canonical marker value.
 *   On failure, redirects to `/login?next=<original path + search>`.
 *
 * Client portal (Phase 3): when live API env is configured, `/portal` and
 * `/api/client-portal/*` require a signed `sa360_client_portal_session` cookie.
 * Mock preview (no `CLIENT_PORTAL_API_KEY`) stays open. `/portal/login` is public.
 *
 * Runs on the Edge runtime; `process.env` is inlined at build time for the env
 * vars referenced here, so reading at runtime is supported in Next 15.
 */

function isClientPortalLiveConfigured(): boolean {
  const base =
    process.env.NEXT_PUBLIC_SA360_API_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  const key = process.env.CLIENT_PORTAL_API_KEY?.trim();
  return Boolean(base && key);
}

async function handleClientPortalAuth(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;
  const isPortalRoute = pathname === "/portal" || pathname.startsWith("/portal/");
  const isPortalBff = pathname.startsWith("/api/client-portal");

  if (!isPortalRoute && !isPortalBff) return null;
  if (!isClientPortalLiveConfigured()) return NextResponse.next();

  if (pathname === "/portal/login" || pathname.startsWith("/portal/login/")) {
    return NextResponse.next();
  }

  const session = request.cookies.get(CLIENT_PORTAL_SESSION_COOKIE)?.value;
  if (await verifyPortalSessionTokenEdge(session)) return NextResponse.next();

  /** Invite link: page validates `?access=` and sets session before live fetch. */
  if (pathname === "/portal" && request.nextUrl.searchParams.has("access")) {
    return NextResponse.next();
  }

  if (isPortalBff) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  const login = new URL("/portal/login", request.url);
  const requested = pathname + request.nextUrl.search;
  if (requested && requested !== "/portal/login") {
    login.searchParams.set("next", requested);
  }
  return NextResponse.redirect(login);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const portalResponse = await handleClientPortalAuth(request);
  if (portalResponse) return portalResponse;

  if (pathname === "/login") return NextResponse.next();

  /** Client portal routes skip admin operator password gate (separate client session). */
  if (pathname === "/portal" || pathname.startsWith("/portal/")) {
    return NextResponse.next();
  }

  /**
   * Embedded Agent Workspace HTML: allow framing from GHL via CSP `frame-ancestors` only on
   * this document route — not on `/api/agent-workspace/*` (JSON fetches) and not on the rest
   * of the admin app (dashboard must stay non-embeddable in random third-party frames).
   */
  if (
    pathname === "/agent-workspace" ||
    pathname.startsWith("/agent-workspace/") ||
    pathname === "/action-center" ||
    pathname.startsWith("/action-center/")
  ) {
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
