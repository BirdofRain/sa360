/**
 * SA360_OBSERVER permission policy.
 *
 * Default deny: a path or admin-API call is allowed only when it appears here.
 * GET is not treated as safe by itself — each prefix was checked against the
 * handler that uses the Admin C.O.C. API key.
 *
 * Session compatibility (ac1): tokens minted before roles omit `role`. A valid
 * signature with no role is ADMIN. `SA360_OBSERVER` is issued only at login
 * when `ADMIN_COC_OBSERVER_PASSWORD` matches. Unknown role values fail closed.
 */

export const ADMIN_COC_ROLE_ADMIN = "ADMIN" as const;
export const ADMIN_COC_ROLE_OBSERVER = "SA360_OBSERVER" as const;

export type AdminCocRole = typeof ADMIN_COC_ROLE_ADMIN | typeof ADMIN_COC_ROLE_OBSERVER;

export const OBSERVER_HOME_PATH = "/webhooks";

/** Server actions an observer may invoke. Every other privileged action is admin-only. */
export const OBSERVER_READ_SERVER_ACTIONS = [
  "loadWebhookDetailAction",
  "loadLeadTimelineAction",
  "loadSynthflowDetailAction",
  "loadSynthflowOutboundDetailAction",
  "loadSourceLeadDetailAction",
  "loadDeliveryPlanForDecisionAction",
  "loadDeliveryRuntimeModeAction",
] as const;

const OBSERVER_READ_SERVER_ACTION_SET = new Set<string>(OBSERVER_READ_SERVER_ACTIONS);

export function isObserverReadServerAction(name: string): boolean {
  return OBSERVER_READ_SERVER_ACTION_SET.has(name);
}

const DOCUMENT_EXACT = new Set(["/"]);

const DOCUMENT_PREFIXES = [
  "/webhooks",
  "/lead-timeline",
  "/automation-dashboard",
  "/synthflow",
  "/lead-fulfillment",
  "/lead-inventory",
  "/routing-dry-run",
  "/delivery-readiness",
];

export function isObserverDocumentPath(pathname: string): boolean {
  if (DOCUMENT_EXACT.has(pathname)) return true;
  if (pathname === "/source-intake") return true;
  return DOCUMENT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function observerLandingPath(nextPath: string | undefined): string {
  if (!nextPath) return OBSERVER_HOME_PATH;
  const pathOnly = nextPath.split("?")[0] ?? nextPath;
  return isObserverDocumentPath(pathOnly) ? nextPath : OBSERVER_HOME_PATH;
}

function adminApiPathname(path: string): string {
  const raw = path.split("?")[0] ?? path;
  if (!raw.startsWith("/")) return `/${raw}`;
  return raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

/**
 * Admin API GETs an observer session may make with the server-side admin key.
 * Mutations are never allowed. Paths that return secrets, client credentials,
 * OAuth tokens, or fulfillment writes are absent on purpose.
 */
export function isObserverAdminApiGetAllowed(path: string): boolean {
  const pathname = adminApiPathname(path);

  if (pathname === "/admin/v1/coc" || pathname.startsWith("/admin/v1/coc/")) return true;
  if (pathname.startsWith("/admin/v1/automation-dashboard/")) return true;

  if (
    pathname === "/admin/v1/lead-inventory/summary" ||
    pathname === "/admin/v1/lead-inventory/facets" ||
    pathname === "/admin/v1/lead-inventory/lots" ||
    pathname === "/admin/v1/lead-inventory/review/summary" ||
    pathname === "/admin/v1/lead-inventory/review/items" ||
    pathname.startsWith("/admin/v1/lead-inventory/review/items/")
  ) {
    return true;
  }

  const reviewAction = pathname.match(/^\/admin\/v1\/lead-inventory\/review\/actions\/([^/]+)$/);
  if (reviewAction && reviewAction[1] !== "preview" && reviewAction[1] !== "commit") return true;

  if (pathname === "/admin/v1/source-leads") return true;
  if (/^\/admin\/v1\/source-leads\/[^/]+$/.test(pathname)) return true;

  if (
    pathname === "/admin/v1/routing/dry-run-stats" ||
    pathname === "/admin/v1/routing/dry-run-decisions" ||
    pathname === "/admin/v1/routing/dry-run-master-clients" ||
    pathname === "/admin/v1/delivery-readiness" ||
    pathname === "/admin/v1/delivery-runtime-mode"
  ) {
    return true;
  }

  if (/^\/admin\/v1\/routing\/dry-run-decisions\/[^/]+\/delivery-plan$/.test(pathname)) return true;
  if (/^\/admin\/v1\/routing\/dry-run-decisions\/[^/]+\/duplicate-risk$/.test(pathname)) return true;

  return false;
}

/** BFF routes an observer may call. Method must be GET or HEAD. */
export function isObserverBffReadAllowed(method: string, pathname: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;

  if (
    pathname === "/api/lead-inventory/review/summary" ||
    pathname === "/api/lead-inventory/review/items" ||
    /^\/api\/lead-inventory\/review\/items\/[^/]+$/.test(pathname)
  ) {
    return true;
  }

  const reviewAction = pathname.match(/^\/api\/lead-inventory\/review\/actions\/([^/]+)$/);
  return Boolean(reviewAction && reviewAction[1] !== "preview" && reviewAction[1] !== "commit");
}

export function isAdminCocRole(value: unknown): value is AdminCocRole {
  return value === ADMIN_COC_ROLE_ADMIN || value === ADMIN_COC_ROLE_OBSERVER;
}
