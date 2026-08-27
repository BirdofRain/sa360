import {
  parsePortalLeadListStatus,
  PORTAL_LEAD_LIST_STATUS_QUERY,
  type PortalLeadListStatus,
} from "./portal-lead-list-status.ts";

export function parsePortalLeadId(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v.includes("/") || v.includes("\\") || v.includes("..") || v.length > 128) {
    return null;
  }
  return v;
}

export function portalLeadDetailPath(
  id: string,
  listStatus: PortalLeadListStatus | string = "all"
): string {
  const path = `/portal/leads/${encodeURIComponent(id)}`;
  const status = parsePortalLeadListStatus(
    typeof listStatus === "string" ? listStatus : undefined
  );
  if (status === "all") return path;
  return `${path}?${PORTAL_LEAD_LIST_STATUS_QUERY}=${encodeURIComponent(status)}`;
}

/** Cross-tenant and missing leads both 404 from the API — do not distinguish them. */
export function isPortalLeadNotFoundStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404;
}
