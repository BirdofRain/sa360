/**
 * Validate a post-OAuth portal return path.
 *
 * Only internal relative `/portal` paths are allowed. Absolute URLs, protocol-relative
 * hosts, path traversal, percent-encoding tricks, and non-portal paths are rejected
 * so pending-auth `returnTo` cannot become an open redirect. This helper does not
 * perform browser redirects.
 */

const DEFAULT_PORTAL_RETURN_TO = "/portal/account";
const RETURN_TO_ORIGIN = "https://sa360.invalid";

function containsControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isSafePortalPathname(pathname: string): boolean {
  if (!pathname.startsWith("/portal")) return false;
  if (pathname.startsWith("//")) return false;
  if (pathname.includes("//")) return false;
  if (pathname.includes("\\")) return false;
  if (pathname.includes("://")) return false;
  if (pathname.includes("%")) return false;
  const segments = pathname.split("/");
  if (segments.some((segment) => segment === ".." || segment === ".")) return false;
  return pathname === "/portal" || pathname.startsWith("/portal/");
}

/**
 * Returns the sanitized portal path, or `null` when the input is malicious/external.
 * Empty/missing input yields the default `/portal/account`.
 */
export function parseSafePortalReturnTo(
  raw: string | null | undefined,
  fallback = DEFAULT_PORTAL_RETURN_TO
): string | null {
  if (raw == null) return fallback;
  const v = raw.trim();
  if (!v) return fallback;
  if (containsControlChars(v)) return null;
  if (v.includes("%") || v.includes("\\")) return null;

  const lower = v.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("http:") ||
    lower.startsWith("https:") ||
    lower.startsWith("mailto:") ||
    v.startsWith("//") ||
    v.includes("://")
  ) {
    return null;
  }

  if (!v.startsWith("/")) return null;

  let url: URL;
  try {
    url = new URL(v, RETURN_TO_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== RETURN_TO_ORIGIN) return null;
  if (url.username || url.password) return null;

  const pathname = url.pathname;
  const search = url.search;
  if (!isSafePortalPathname(pathname)) return null;
  if (search.includes("://") || search.includes("\\") || search.includes("%")) return null;

  return `${pathname}${search}`;
}

export function assertSafePortalReturnTo(
  raw: string | null | undefined,
  fallback = DEFAULT_PORTAL_RETURN_TO
): string {
  const parsed = parseSafePortalReturnTo(raw, fallback);
  if (!parsed) {
    throw new Error("returnTo must be an internal relative /portal path.");
  }
  return parsed;
}

export const SAFE_PORTAL_RETURN_TO_DEFAULT = DEFAULT_PORTAL_RETURN_TO;
