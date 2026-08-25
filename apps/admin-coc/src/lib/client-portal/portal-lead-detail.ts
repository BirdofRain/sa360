export function parsePortalLeadId(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v.includes("/") || v.includes("\\") || v.includes("..") || v.length > 128) {
    return null;
  }
  return v;
}

export function portalLeadDetailPath(id: string): string {
  return `/portal/leads/${encodeURIComponent(id)}`;
}

/** Cross-tenant and missing leads both 404 from the API — do not distinguish them. */
export function isPortalLeadNotFoundStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404;
}
