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
import {
  isFrontOfficeAuthenticated,
  isFrontOfficePath,
} from "@/lib/front-office/auth-edge";

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

async function handleFrontOfficeAuth(
  request: NextRequest
): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;
  if (!isFrontOfficePath(pathname)) return null;

  if (
    pathname === "/front-office/login-chooser" ||
    pathname.startsWith("/front-office/login-chooser/")
  ) {
    return NextResponse.next();
  }

  if (await isFrontOfficeAuthenticated(request)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/front-office")) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  const chooser = new URL("/front-office/login-chooser", request.url);
  const requested = pathname + request.nextUrl.search;
  if (requested && requested !== "/front-office/login-chooser") {
    chooser.searchParams.set("next", requested);
  }
  return NextResponse.redirect(chooser);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const portalResponse = await handleClientPortalAuth(request);
  if (portalResponse) return portalResponse;

  const frontOfficeResponse = await handleFrontOfficeAuth(request);
  if (frontOfficeResponse) return frontOfficeResponse;

  if (pathname === "/login") return NextResponse.next();

  if (
    pathname === "/integrations/oauth/callback" ||
    pathname === "/integrations/ghl/oauth/callback"
  ) {
    return NextResponse.next();
  }

  if (pathname === "/portal" || pathname.startsWith("/portal/")) {
    return NextResponse.next();
  }

  if (
    pathname === "/front-office" ||
    pathname.startsWith("/front-office/")
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/front-office")) {
    return NextResponse.next();
  }

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

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
