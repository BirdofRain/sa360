/**
 * SA360_OBSERVER permission policy.
 *
 * Default deny. A document, BFF route, or admin-API call is allowed only when
 * it matches an explicit entry below. Prefixes are not used: a future subroute
 * is denied until it is added here.
 *
 * Paths are accepted only when they are already canonical. Dot segments,
 * encodings, backslashes, null bytes, and empty segments are rejected rather
 * than rewritten onto an allowed path.
 *
 * Observer access is global across clients. It is an internal diagnostic role,
 * not a customer or tenant session.
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

/** Existing diagnostic pages. Exact match only — no child routes. */
export const OBSERVER_DOCUMENT_PATHS = [
  "/",
  "/webhooks",
  "/lead-timeline",
  "/automation-dashboard",
  "/synthflow",
  "/lead-fulfillment",
  "/lead-inventory",
  "/source-intake",
  "/routing-dry-run",
  "/delivery-readiness",
] as const;

const OBSERVER_DOCUMENT_PATH_SET = new Set<string>(OBSERVER_DOCUMENT_PATHS);

/** Static admin API GETs. Dynamic resources are separate patterns. */
export const OBSERVER_ADMIN_API_GET_EXACT = [
  "/admin/v1/coc/summary-metrics",
  "/admin/v1/coc/webhook-requests",
  "/admin/v1/coc/lead-timeline",
  "/admin/v1/coc/synthflow-requests",
  "/admin/v1/coc/synthflow-outbound-results",
  "/admin/v1/coc/lead-fulfillment/overview",
  "/admin/v1/automation-dashboard/summary",
  "/admin/v1/automation-dashboard/workflow-progression",
  "/admin/v1/automation-dashboard/appointments",
  "/admin/v1/automation-dashboard/signal-health",
  "/admin/v1/automation-dashboard/accounts",
  "/admin/v1/lead-inventory/summary",
  "/admin/v1/lead-inventory/facets",
  "/admin/v1/lead-inventory/lots",
  "/admin/v1/lead-inventory/review/summary",
  "/admin/v1/lead-inventory/review/items",
  "/admin/v1/source-leads",
  "/admin/v1/routing/dry-run-stats",
  "/admin/v1/routing/dry-run-decisions",
  "/admin/v1/routing/dry-run-master-clients",
  "/admin/v1/delivery-readiness",
  "/admin/v1/delivery-runtime-mode",
] as const;

const OBSERVER_ADMIN_API_GET_EXACT_SET = new Set<string>(OBSERVER_ADMIN_API_GET_EXACT);

/** Static BFF GETs. */
export const OBSERVER_BFF_GET_EXACT = [
  "/api/lead-inventory/review/summary",
  "/api/lead-inventory/review/items",
] as const;

const OBSERVER_BFF_GET_EXACT_SET = new Set<string>(OBSERVER_BFF_GET_EXACT);

/** One path segment: letters, digits, underscore, hyphen. No dots or slashes. */
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function isObserverResourceId(value: string): boolean {
  return RESOURCE_ID.test(value);
}

/**
 * Returns the path only when it is already in canonical form.
 * Query strings are stripped. A trailing slash, encoding, or dot segment
 * returns null so authorization cannot follow a rewritten path.
 */
export function canonicalSecurityPath(input: string): string | null {
  if (typeof input !== "string" || input.length === 0 || input.length > 2048) return null;
  const hashless = input.split("#")[0] ?? input;
  const queryAt = hashless.indexOf("?");
  const rawPath = queryAt >= 0 ? hashless.slice(0, queryAt) : hashless;
  if (rawPath === "/") return "/";
  if (!rawPath.startsWith("/")) return null;
  if (rawPath.includes("\\") || rawPath.includes("\0") || rawPath.includes("%")) return null;
  if (rawPath.includes("//")) return null;
  if (rawPath.length > 1 && rawPath.endsWith("/")) return null;

  const segments = rawPath.split("/");
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i] ?? "";
    if (segment.length === 0 || segment === "." || segment === "..") return null;
  }
  return rawPath;
}

function matchOneId(pathname: string, prefix: string, suffix = ""): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  if (suffix) {
    if (!rest.endsWith(suffix)) return null;
    const id = rest.slice(0, rest.length - suffix.length);
    if (id.includes("/")) return null;
    return isObserverResourceId(id) ? id : null;
  }
  if (rest.includes("/")) return null;
  return isObserverResourceId(rest) ? rest : null;
}

export function isObserverDocumentPath(pathname: string): boolean {
  const canonical = canonicalSecurityPath(pathname);
  if (!canonical) return false;
  return OBSERVER_DOCUMENT_PATH_SET.has(canonical);
}

export function observerLandingPath(nextPath: string | undefined): string {
  if (!nextPath) return OBSERVER_HOME_PATH;
  const pathOnly = nextPath.split("?")[0] ?? nextPath;
  return isObserverDocumentPath(pathOnly) ? nextPath : OBSERVER_HOME_PATH;
}

export function isObserverAdminApiGetAllowed(path: string): boolean {
  const pathname = canonicalSecurityPath(path);
  if (!pathname) return false;
  if (OBSERVER_ADMIN_API_GET_EXACT_SET.has(pathname)) return true;

  if (matchOneId(pathname, "/admin/v1/coc/webhook-requests/")) return true;
  if (matchOneId(pathname, "/admin/v1/coc/synthflow-requests/")) return true;
  if (matchOneId(pathname, "/admin/v1/coc/synthflow-outbound-results/")) return true;
  if (matchOneId(pathname, "/admin/v1/lead-inventory/review/items/")) return true;
  if (matchOneId(pathname, "/admin/v1/source-leads/")) return true;
  if (matchOneId(pathname, "/admin/v1/lead-inventory/review/actions/")) return true;
  if (matchOneId(pathname, "/admin/v1/routing/dry-run-decisions/", "/delivery-plan")) return true;
  if (matchOneId(pathname, "/admin/v1/routing/dry-run-decisions/", "/duplicate-risk")) return true;

  return false;
}

/** BFF routes an observer may call. Method must be GET or HEAD. */
export function isObserverBffReadAllowed(method: string, pathname: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const canonical = canonicalSecurityPath(pathname);
  if (!canonical) return false;
  if (OBSERVER_BFF_GET_EXACT_SET.has(canonical)) return true;
  if (matchOneId(canonical, "/api/lead-inventory/review/items/")) return true;
  if (matchOneId(canonical, "/api/lead-inventory/review/actions/")) return true;
  return false;
}

export function isAdminCocRole(value: unknown): value is AdminCocRole {
  return value === ADMIN_COC_ROLE_ADMIN || value === ADMIN_COC_ROLE_OBSERVER;
}
