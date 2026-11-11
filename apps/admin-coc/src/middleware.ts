import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_COC_SESSION_COOKIE } from "@/lib/admin-coc-auth";
import { resolveAdminCocRouteGate } from "@/lib/admin-coc-route-gate";
import {
  fetchStaffAdminCocDecision,
  readStaffAdminCocOrigin,
  STAFF_ADMIN_COC_SESSION_COOKIE,
  type StaffAdminCocDecision,
} from "@/lib/staff-admin-coc-decision";
import { ADMIN_COC_ROLE_ADMIN } from "@/lib/admin-coc-observer-access";
import { parseAdminCocSessionTokenEdge } from "@/lib/admin-coc-session-edge";
import {
  isMetaReviewHttpPath,
  metaReviewCacheControlHeaders,
} from "@/lib/meta-reviewer-access";
import { META_REVIEWER_SESSION_COOKIE } from "@/lib/meta-reviewer-auth";
import { verifyMetaReviewerSessionTokenEdge } from "@/lib/meta-reviewer-session-edge";
import {
  AGENT_WORKSPACE_EMBED_CSP_HEADER,
  getContentSecurityPolicyForAgentWorkspaceEmbed,
} from "@/lib/agent-workspace-embed-security";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session-cookie";
import { verifyPortalSessionTokenEdge } from "@/lib/client-portal/portal-session-edge";
import { isFrontOfficeDevPreview } from "@/lib/front-office/auth-edge";

function isClientPortalLiveConfigured(): boolean {
  const base =
    process.env.NEXT_PUBLIC_SA360_API_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  const key = process.env.CLIENT_PORTAL_API_KEY?.trim();
  return Boolean(base && key);
}

function applyAuthenticatedCacheHeaders(response: NextResponse, pathname: string, reviewer: boolean) {
  if (!reviewer && !isMetaReviewHttpPath(pathname)) return response;
  for (const [key, value] of Object.entries(metaReviewCacheControlHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get(CLIENT_PORTAL_SESSION_COOKIE)?.value;
  const hasValidPortalSession = await verifyPortalSessionTokenEdge(session);
  const adminSessionRole = await parseAdminCocSessionTokenEdge(
    request.cookies.get(ADMIN_COC_SESSION_COOKIE)?.value
  );
  const hasAdminSession = adminSessionRole === ADMIN_COC_ROLE_ADMIN;
  const hasMetaReviewerSession = await verifyMetaReviewerSessionTokenEdge(
    request.cookies.get(META_REVIEWER_SESSION_COOKIE)?.value
  );
  const staffDecision = hasAdminSession
    ? "anonymous"
    : await readMiddlewareStaffDecision(request.cookies.get(STAFF_ADMIN_COC_SESSION_COOKIE)?.value);

  const decision = resolveAdminCocRouteGate({
    pathname,
    search: request.nextUrl.search,
    forwardedHost: request.headers.get("x-forwarded-host"),
    host: request.headers.get("host"),
    method: request.method,
    adminPasswordConfigured: Boolean(process.env.ADMIN_COC_PASSWORD?.trim()),
    hasAdminSession,
    adminSessionRole,
    hasMetaReviewerSession,
    staffAccess: staffAccessFromDecision(staffDecision),
    hasValidPortalSession,
    clientPortalLiveConfigured: isClientPortalLiveConfigured(),
    frontOfficeDevPreview: isFrontOfficeDevPreview(request),
    portalAccessQuery:
      pathname === "/portal" && request.nextUrl.searchParams.has("access"),
  });

  switch (decision.kind) {
    case "rewrite": {
      const url = request.nextUrl.clone();
      url.pathname = decision.pathname;
      return NextResponse.rewrite(url);
    }
    case "not-found":
      return new NextResponse("Not Found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    case "unauthorized":
      return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
    case "forbidden":
      if (decision.surface === "api") {
        return applyAuthenticatedCacheHeaders(
          NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }),
          pathname,
          hasMetaReviewerSession
        );
      }
      if (decision.surface === "reviewer") {
        return applyAuthenticatedCacheHeaders(
          new NextResponse("Forbidden", {
            status: 403,
            headers: { "content-type": "text/plain; charset=utf-8" },
          }),
          pathname,
          hasMetaReviewerSession
        );
      }
      return new NextResponse("Forbidden — read-only observer", {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    case "redirect": {
      const target = new URL(decision.pathname, request.url);
      if (decision.next) target.searchParams.set("next", decision.next);
      return applyAuthenticatedCacheHeaders(
        NextResponse.redirect(target),
        pathname,
        hasMetaReviewerSession
      );
    }
    case "allow": {
      const res = NextResponse.next();
      if (decision.attachAgentWorkspaceCsp) {
        res.headers.set(
          AGENT_WORKSPACE_EMBED_CSP_HEADER,
          getContentSecurityPolicyForAgentWorkspaceEmbed()
        );
      }
      return applyAuthenticatedCacheHeaders(res, pathname, hasMetaReviewerSession);
    }
  }
}

function staffAccessFromDecision(decision: StaffAdminCocDecision): "admin" | "limited" | "none" {
  if (decision === "admin") return "admin";
  if (decision === "limited") return "limited";
  return "none";
}

/**
 * Routing hint only. Pages, server actions, and BFF handlers repeat the
 * authorize call. A missing or rejected check does not grant admin access.
 * The shared-password admin session skips this call.
 */
async function readMiddlewareStaffDecision(sessionToken: string | undefined): Promise<StaffAdminCocDecision> {
  if (!sessionToken) return "anonymous";
  const origin = readStaffAdminCocOrigin(
    process.env.SA360_API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SA360_API_BASE_URL
  );
  const serviceSecret = process.env.SA360_STAFF_GOOGLE_SERVICE_SECRET ?? "";
  if (!origin || serviceSecret.length < 32 || /\s/u.test(serviceSecret)) return "anonymous";
  return fetchStaffAdminCocDecision({ origin, serviceSecret, sessionToken });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
