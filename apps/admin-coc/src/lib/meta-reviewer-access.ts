/**
 * Path allowlists for the Meta App Reviewer role.
 * Default deny. Document routes and admin-API paths are exact; dynamic ids are numeric.
 */

import { canonicalSecurityPath } from "./admin-coc-observer-access.ts";

const EXACT_READ_PATHS = new Set([
  "/admin/v1/meta-review/preflight",
  "/admin/v1/meta-review/pages",
  "/admin/v1/meta-review/permissions",
]);

const PAGE_READ =
  /^\/admin\/v1\/meta-review\/pages\/([0-9]{1,32})\/(subscription|posts)$/;
const INSIGHTS_READ =
  /^\/admin\/v1\/meta-review\/ad-accounts\/((?:act_)?[0-9]{1,32})\/insights$/;
const SUBSCRIBE_WRITE =
  /^\/admin\/v1\/meta-review\/pages\/([0-9]{1,32})\/subscribe-leadgen$/;

export type MetaReviewApiKind = "read" | "subscribe";

export function classifyMetaReviewApiPath(path: string): MetaReviewApiKind | null {
  const pathname = canonicalSecurityPath(path);
  if (!pathname) return null;
  if (EXACT_READ_PATHS.has(pathname)) return "read";
  if (PAGE_READ.test(pathname) || INSIGHTS_READ.test(pathname)) return "read";
  if (SUBSCRIBE_WRITE.test(pathname)) return "subscribe";
  return null;
}

export function isMetaReviewerWorkspacePath(pathname: string): boolean {
  const canonical = canonicalSecurityPath(pathname);
  return (
    canonical === "/meta-review" ||
    canonical === "/meta-review/login" ||
    canonical === "/meta-review/logout"
  );
}

export function isMetaReviewHttpPath(pathname: string): boolean {
  return pathname === "/meta-review" || pathname.startsWith("/meta-review/");
}

export function metaReviewCacheControlHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex",
  };
}
