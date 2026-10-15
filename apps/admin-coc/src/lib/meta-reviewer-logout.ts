/**
 * Same-origin check for POST /meta-review/logout.
 * SameSite=Lax already withholds the cookie on cross-site POST. Origin must
 * still match the forwarded host so a crafted same-site request cannot aim
 * the browser at another host.
 */

function splitHost(host: string): { name: string; port: string } {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return {
      name: host.slice(1, end).toLowerCase(),
      port: host.slice(end + 1).replace(/^:/, ""),
    };
  }
  const colon = host.lastIndexOf(":");
  if (colon > -1 && /^\d+$/.test(host.slice(colon + 1))) {
    return { name: host.slice(0, colon).toLowerCase(), port: host.slice(colon + 1) };
  }
  return { name: host.toLowerCase(), port: "" };
}

/** Loopback aliases share a machine. Every other host must match exactly. */
function hostsMatch(originHost: string, requestHost: string): boolean {
  if (originHost.toLowerCase() === requestHost.toLowerCase()) return true;
  const origin = splitHost(originHost);
  const request = splitHost(requestHost);
  const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!loopback.has(origin.name) || !loopback.has(request.name)) return false;
  if (origin.port && request.port && origin.port !== request.port) return false;
  return true;
}

export function metaReviewerLogoutOriginAllowed(request: {
  headers: { get(name: string): string | null };
  url?: string;
}): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  // Chrome sends Origin: null for a same-origin form POST when the page uses
  // Referrer-Policy: no-referrer. Sec-Fetch-Site is browser-controlled.
  if (origin === "null") {
    return request.headers.get("sec-fetch-site") === "same-origin";
  }
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.username || originUrl.password) return false;
  if (originUrl.protocol !== "https:" && originUrl.protocol !== "http:") return false;

  const forwarded = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  let host = forwarded.split(",")[0]?.trim() ?? "";
  if (!host && request.url) {
    try {
      host = new URL(request.url).host;
    } catch {
      host = "";
    }
  }
  return Boolean(host) && hostsMatch(originUrl.host, host);
}
