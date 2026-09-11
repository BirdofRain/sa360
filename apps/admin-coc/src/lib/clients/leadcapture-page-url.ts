/**
 * Operator-preview identity for LeadCapture source association.
 *
 * Semantics MUST match apps/api/src/services/source-intake/leadcapture-parent-url.ts
 * (#135). This module is preview/copy only — association still goes through the
 * Admin API, which remains the source of truth. Do not invent a second identity rule.
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

export function normalizeLeadCapturePageUrlOrSlug(
  value: unknown
): NormalizedLeadCaptureParentUrl | null {
  const raw = trimOrUndefined(value);
  if (!raw) return null;
  const fromUrl = normalizeLeadCaptureParentUrl(raw);
  if (fromUrl) return fromUrl;
  if (!looksLikeHostedPageSlug(raw)) return null;
  return normalizeLeadCaptureParentUrl(`https://${LEADCAPTURE_HOSTED_PAGE_HOST}/p/${raw}`);
}

export const LEADCAPTURE_SOURCES_HELPER_PRIMARY =
  "Paste the full LeadCapture page URL. For standard my.leadcapture.io pages, you may also enter only the page slug.";

export const LEADCAPTURE_SOURCES_CUSTOM_DOMAIN_REQUIRED =
  "Custom-domain pages must use the full URL.";

export const LEADCAPTURE_SOURCES_STANDARD_EXAMPLE_SLUG = "dn_omzoj";
export const LEADCAPTURE_SOURCES_STANDARD_EXAMPLE_URL = "https://my.leadcapture.io/p/dn_omzoj";
export const LEADCAPTURE_SOURCES_CUSTOM_EXAMPLE_URL =
  "https://healthcareworker.familylegacyprotection.com/learn-andru-duranso";

export const LEADCAPTURE_SLUG_PREVIEW_LABEL = "This slug will be associated as:";
export const LEADCAPTURE_URL_PREVIEW_LABEL = "Source identity:";
export const LEADCAPTURE_CUSTOM_DOMAIN_SLUG_USE_FULL_URL =
  "Use the full page URL to associate that source.";
export const LEADCAPTURE_CUSTOM_DOMAIN_SLUG_MULTIPLE_HOSTS =
  "Observed sources with this slug already exist on more than one host. Use the full page URL.";

export type LeadCaptureAssociatePreview =
  | { kind: "empty" }
  | { kind: "unrecognized" }
  | {
      kind: "slug";
      parentUrlKey: string;
      pageSlug: string;
    }
  | {
      kind: "url";
      parentUrlKey: string;
      hostname: string;
      pageSlug: string | null;
    };

export function previewLeadCaptureAssociateInput(value: string): LeadCaptureAssociatePreview {
  const trimmed = value.trim();
  if (!trimmed) return { kind: "empty" };
  const normalized = normalizeLeadCapturePageUrlOrSlug(trimmed);
  if (!normalized) return { kind: "unrecognized" };
  if (looksLikeHostedPageSlug(trimmed)) {
    return {
      kind: "slug",
      parentUrlKey: normalized.parentUrlKey,
      pageSlug: normalized.pageSlug ?? trimmed,
    };
  }
  return {
    kind: "url",
    parentUrlKey: normalized.parentUrlKey,
    hostname: normalized.hostname,
    pageSlug: normalized.pageSlug,
  };
}

/**
 * Surfaces custom-domain SourceFunnels already loaded on this client (confirmed
 * or suggested). Does not query globally, auto-substitute, or fuzzy-match.
 * A slug-filtered observed lookup would need a new Admin API — out of scope.
 */
export function customDomainHostsForPageSlug(
  pageSlug: string,
  items: Array<{ pageSlug: string | null; parentUrlKey: string | null }>
): string[] {
  const needle = pageSlug.trim().toLowerCase();
  if (!needle) return [];
  const hosts = new Set<string>();
  for (const item of items) {
    if ((item.pageSlug ?? "").trim().toLowerCase() !== needle) continue;
    const key = item.parentUrlKey?.trim();
    if (!key) continue;
    const parsed = normalizeLeadCaptureParentUrl(`https://${key}`);
    if (!parsed) continue;
    if (parsed.hostname === LEADCAPTURE_HOSTED_PAGE_HOST) continue;
    hosts.add(parsed.hostname);
  }
  return [...hosts].sort();
}
