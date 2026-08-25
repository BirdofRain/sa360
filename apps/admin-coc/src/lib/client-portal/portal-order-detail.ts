export function parsePortalOrderId(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v.includes("/") || v.includes("\\") || v.includes("..") || v.length > 128) {
    return null;
  }
  return v;
}

/** Cross-tenant and missing orders both 404 from the API — do not distinguish them. */
export function isPortalOrderNotFoundStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404;
}
