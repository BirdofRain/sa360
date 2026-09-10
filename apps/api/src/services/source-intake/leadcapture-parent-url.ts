/**
 * Deterministic LeadCapture parent_url normalization.
 *
 * Canonical identity is hostname (lowercased) + meaningful pathname.
 * Query strings (including ?v=) and fragments are never part of identity.
 * pageSlug is the last path segment — operator convenience only, not globally unique.
 */

export const LEADCAPTURE_HOSTED_PAGE_HOST = "my.leadcapture.io";

const PAGE_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/i;

export type NormalizedLeadCaptureParentUrl = {
  parentUrlKey: string;
  pageSlug: string | null;
  hostname: string;
  pathname: string;
};

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePathname(pathname: string): string | null {
  let path = pathname.trim();
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1) {
    path = path.replace(/\/+$/, "");
  }
  if (path === "" || path === "/") return null;
  return path;
}

function pageSlugFromPathname(pathname: string): string | null {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const last = segments.at(-1)?.trim() ?? "";
  return last.length > 0 ? last : null;
}

function fromParsedUrl(url: URL): NormalizedLeadCaptureParentUrl | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const hostname = url.hostname.trim().toLowerCase();
  if (!hostname) return null;
  const pathname = normalizePathname(url.pathname);
  if (!pathname) return null;
  return {
    parentUrlKey: `${hostname}${pathname}`,
    pageSlug: pageSlugFromPathname(pathname),
    hostname,
    pathname,
  };
}

/**
 * Normalize a provider parent_url into a stable parentUrlKey.
 * Rejects relative URLs, non-http(s) schemes, and root-only / empty paths.
 */
export function normalizeLeadCaptureParentUrl(
  value: unknown
): NormalizedLeadCaptureParentUrl | null {
  const raw = trimOrUndefined(value);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return fromParsedUrl(url);
}

function looksLikeHostedPageSlug(value: string): boolean {
  if (value.includes("/") || value.includes(".") || value.includes("?") || value.includes("#")) {
    return false;
  }
  return PAGE_SLUG_RE.test(value);
}

/**
 * Operator input: full http(s) URL or a standard LeadCapture hosted page slug.
 * Slug-only values become my.leadcapture.io/p/{slug}.
 * Does not infer a ClientAccount from the URL.
 */
export function normalizeLeadCapturePageUrlOrSlug(
  value: unknown
): NormalizedLeadCaptureParentUrl | null {
  const raw = trimOrUndefined(value);
  if (!raw) return null;
  const fromUrl = normalizeLeadCaptureParentUrl(raw);
  if (fromUrl) return fromUrl;
  if (!looksLikeHostedPageSlug(raw)) return null;
  return normalizeLeadCaptureParentUrl(
    `https://${LEADCAPTURE_HOSTED_PAGE_HOST}/p/${raw}`
  );
}
