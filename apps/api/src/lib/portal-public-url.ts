/**
 * Canonical public origin for customer-facing portal links.
 *
 * Same env keys as fulfillment's resolvePortalPublicBaseUrl:
 * SA360_PORTAL_PUBLIC_BASE_URL, then ADMIN_COC_BASE_URL.
 * Returns null when unset — callers must not invent a production hostname.
 */

export function resolvePortalPublicBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const raw =
    env.SA360_PORTAL_PUBLIC_BASE_URL?.trim() || env.ADMIN_COC_BASE_URL?.trim() || "";
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function buildAbsoluteOrRelativePortalUrl(
  path: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = resolvePortalPublicBaseUrl(env);
  return base ? `${base}${normalized}` : normalized;
}
