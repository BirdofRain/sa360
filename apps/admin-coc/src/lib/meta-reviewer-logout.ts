/**
 * Same-origin check for POST /meta-review/logout.
 * SameSite=Lax already withholds the cookie on cross-site POST. Origin must
 * still match the forwarded host so a crafted same-site request cannot aim
 * the browser at another host.
 */

export function metaReviewerLogoutOriginAllowed(request: {
  headers: { get(name: string): string | null };
  url?: string;
}): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.username || originUrl.password) return false;
  const hostHeader = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  let host = hostHeader.split(",")[0]?.trim() ?? "";
  if (!host && request.url) {
    try {
      host = new URL(request.url).host;
    } catch {
      host = "";
    }
  }
  if (!host || host !== originUrl.host) return false;
  return originUrl.protocol === "https:" || originUrl.protocol === "http:";
}
