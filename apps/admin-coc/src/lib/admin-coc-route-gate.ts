/**
 * Host + auth routing for admin-coc. Middleware is a thin NextResponse wrapper
 * around this module so the matrix can be unit-tested without NextRequest.
 *
 * Surfaces:
 * - Public marketing hosts (`SA360_PUBLIC_MARKETING_HOSTS`): 404 Admin C.O.C.
 * - Customer `/portal` and `/api/client-portal`: portal session
 * - Front Office: admin cookie, portal session, or explicit dev preview
 * - Remaining admin/operator routes: Admin C.O.C. password cookie
 *
 * `/action-center`, `/agent-workspace`, and `/api/agent-workspace/*` are
 * operator surfaces and use the Admin C.O.C. cookie — they are not public.
 * GHL iframe embedding still gets `frame-ancestors` CSP after a successful
 * admin allow; it does not skip the password gate.
 */

import { isUnauthenticatedPortalPath } from "./client-portal/portal-public-paths.ts";
import { isFrontOfficePath } from "./front-office/auth-edge.ts";
import {
  shouldBlockAdminOnPublicMarketingHost,
  shouldRewriteRootToPublicLanding,
} from "./public-site/marketing-hosts.ts";
import {
  isPublicMarketingPath,
  isPublicOnboardingPath,
  PUBLIC_MARKETING_LANDING_PATH,
  PUBLIC_REGISTER_PATH,
} from "./public-site/marketing-paths.ts";

export type AdminCocRouteGateInput = {
  pathname: string;
  search?: string;
  forwardedHost?: string | null;
  host?: string | null;
  marketingHostsEnv?: string | null;
  adminPasswordConfigured: boolean;
  hasAdminSession: boolean;
  hasValidPortalSession: boolean;
  clientPortalLiveConfigured: boolean;
  frontOfficeDevPreview: boolean;
  portalAccessQuery: boolean;
};

export type AdminCocRouteGateDecision =
  | { kind: "rewrite"; pathname: string }
  | { kind: "not-found" }
  | { kind: "allow"; attachAgentWorkspaceCsp: boolean }
  | { kind: "redirect"; pathname: string; next?: string }
  | { kind: "unauthorized" };

function requestedPath(pathname: string, search: string | undefined): string {
  return `${pathname}${search ?? ""}`;
}

export function isAgentWorkspaceDocumentPath(pathname: string): boolean {
  return pathname === "/agent-workspace" || pathname.startsWith("/agent-workspace/");
}

export function isAdminCocOAuthCallbackPath(pathname: string): boolean {
  return (
    pathname === "/integrations/oauth/callback" ||
    pathname === "/integrations/ghl/oauth/callback"
  );
}

export function isAdminCocLoginPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/");
}

/** DigitalOcean / platform liveness. Must not require an operator session. */
export function isAdminCocHealthPath(pathname: string): boolean {
  return pathname === "/api/health" || pathname === "/health";
}

function isClientPortalPath(pathname: string): boolean {
  return pathname === "/portal" || pathname.startsWith("/portal/");
}

function isClientPortalBffPath(pathname: string): boolean {
  return pathname === "/api/client-portal" || pathname.startsWith("/api/client-portal/");
}

function isAdminApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isFrontOfficeLoginChooserPath(pathname: string): boolean {
  return (
    pathname === "/front-office/login-chooser" ||
    pathname.startsWith("/front-office/login-chooser/")
  );
}

function allow(attachAgentWorkspaceCsp = false): AdminCocRouteGateDecision {
  return { kind: "allow", attachAgentWorkspaceCsp };
}

function resolvePortalGate(input: AdminCocRouteGateInput): AdminCocRouteGateDecision | null {
  const { pathname } = input;
  if (!isClientPortalPath(pathname) && !isClientPortalBffPath(pathname)) return null;
  if (!input.clientPortalLiveConfigured) return allow();
  if (isUnauthenticatedPortalPath(pathname)) return allow();
  if (input.hasValidPortalSession) return allow();
  if (pathname === "/portal" && input.portalAccessQuery) return allow();
  if (isClientPortalBffPath(pathname)) return { kind: "unauthorized" };

  const requested = requestedPath(pathname, input.search);
  return {
    kind: "redirect",
    pathname: "/portal/login",
    next: requested && requested !== "/portal/login" ? requested : undefined,
  };
}

function resolveFrontOfficeGate(input: AdminCocRouteGateInput): AdminCocRouteGateDecision | null {
  const { pathname } = input;
  if (!isFrontOfficePath(pathname)) return null;
  if (isFrontOfficeLoginChooserPath(pathname)) return allow();

  const authenticated =
    input.hasAdminSession || input.hasValidPortalSession || input.frontOfficeDevPreview;
  if (authenticated) return allow();

  if (pathname.startsWith("/api/front-office")) return { kind: "unauthorized" };

  const requested = requestedPath(pathname, input.search);
  return {
    kind: "redirect",
    pathname: "/front-office/login-chooser",
    next: requested && requested !== "/front-office/login-chooser" ? requested : undefined,
  };
}

function resolveAdminPasswordGate(input: AdminCocRouteGateInput): AdminCocRouteGateDecision {
  const { pathname } = input;
  const attachAgentWorkspaceCsp = isAgentWorkspaceDocumentPath(pathname);

  if (isPublicOnboardingPath(pathname)) {
    if (input.clientPortalLiveConfigured && !input.hasValidPortalSession) {
      return { kind: "redirect", pathname: PUBLIC_REGISTER_PATH };
    }
    return allow();
  }

  if (isPublicMarketingPath(pathname)) return allow();
  if (isAdminCocLoginPath(pathname)) return allow();
  if (isAdminCocHealthPath(pathname)) return allow();
  if (isAdminCocOAuthCallbackPath(pathname)) return allow();

  if (!input.adminPasswordConfigured) return allow(attachAgentWorkspaceCsp);
  if (input.hasAdminSession) return allow(attachAgentWorkspaceCsp);

  if (isAdminApiPath(pathname)) return { kind: "unauthorized" };

  const requested = requestedPath(pathname, input.search);
  return {
    kind: "redirect",
    pathname: "/login",
    next: requested && requested !== "/" ? requested : undefined,
  };
}

/**
 * Fail closed for unknown admin/operator routes when the password gate is on.
 * Public marketing, portal, Front Office chooser, login, and OAuth callbacks stay reachable.
 */
export function resolveAdminCocRouteGate(
  input: AdminCocRouteGateInput
): AdminCocRouteGateDecision {
  const hostInput = {
    pathname: input.pathname,
    forwardedHost: input.forwardedHost,
    host: input.host,
    envRaw: input.marketingHostsEnv,
  };

  if (shouldRewriteRootToPublicLanding(hostInput)) {
    return { kind: "rewrite", pathname: PUBLIC_MARKETING_LANDING_PATH };
  }
  if (shouldBlockAdminOnPublicMarketingHost(hostInput)) {
    return { kind: "not-found" };
  }

  const portal = resolvePortalGate(input);
  if (portal) return portal;

  const frontOffice = resolveFrontOfficeGate(input);
  if (frontOffice) return frontOffice;

  return resolveAdminPasswordGate(input);
}
