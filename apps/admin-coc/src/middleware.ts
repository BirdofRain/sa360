import { NextResponse, type NextRequest } from "next/server";

import {
  ADMIN_COC_SESSION_COOKIE,
  ADMIN_COC_SESSION_VALUE,
} from "@/lib/admin-coc-auth";
import { resolveAdminCocRouteGate } from "@/lib/admin-coc-route-gate";
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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get(CLIENT_PORTAL_SESSION_COOKIE)?.value;
  const hasValidPortalSession = await verifyPortalSessionTokenEdge(session);

  const decision = resolveAdminCocRouteGate({
    pathname,
    search: request.nextUrl.search,
    forwardedHost: request.headers.get("x-forwarded-host"),
    host: request.headers.get("host"),
    adminPasswordConfigured: Boolean(process.env.ADMIN_COC_PASSWORD?.trim()),
    hasAdminSession:
      request.cookies.get(ADMIN_COC_SESSION_COOKIE)?.value === ADMIN_COC_SESSION_VALUE,
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
    case "redirect": {
      const target = new URL(decision.pathname, request.url);
      if (decision.next) target.searchParams.set("next", decision.next);
      return NextResponse.redirect(target);
    }
    case "allow": {
      const res = NextResponse.next();
      if (decision.attachAgentWorkspaceCsp) {
        res.headers.set(
          AGENT_WORKSPACE_EMBED_CSP_HEADER,
          getContentSecurityPolicyForAgentWorkspaceEmbed()
        );
      }
      return res;
    }
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
