/**
 * Same-origin check for POST /meta-review/logout.
 * SameSite=Lax already withholds the cookie on cross-site POST. Origin must
 * still match the site that received the request.
 *
 * `Host` is the request target a browser cannot replace. A single
 * `X-Forwarded-Host` is used only when `Host` is absent or is a loopback
 * name, which is how a local proxy exposes the public site. A comma-separated
 * forwarded host is ignored: the first value is caller-controlled when a
 * proxy appends. Non-loopback origins must be https.
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

function isLoopbackName(name: string): boolean {
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

function comparableHost(host: string, protocol: string): string {
  const parts = splitHost(host);
  const defaultPort = protocol === "https:" ? "443" : protocol === "http:" ? "80" : "";
  const port = parts.port === defaultPort ? "" : parts.port;
  return port ? `${parts.name}:${port}` : parts.name;
}

/** Loopback aliases share a machine. Every other host must match exactly. */
function hostsMatch(originHost: string, requestHost: string, protocol: string): boolean {
  const origin = comparableHost(originHost, protocol);
  const request = comparableHost(requestHost, protocol);
  if (origin === request) return true;
  const originParts = splitHost(originHost);
  const requestParts = splitHost(requestHost);
  if (!isLoopbackName(originParts.name) || !isLoopbackName(requestParts.name)) return false;
  if (originParts.port && requestParts.port && originParts.port !== requestParts.port) return false;
  return true;
}

/** One host token. Lists are not a trusted proxy contract. */
function singleHostHeader(value: string | null): string {
  if (!value) return "";
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 1) return "";
  const host = parts[0] ?? "";
  if (!host || host.length > 255 || /[\s/\\]/.test(host)) return "";
  return host;
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
  if (originUrl.protocol !== "https:" && !isLoopbackName(splitHost(originUrl.host).name)) return false;

  const hostHeader = singleHostHeader(request.headers.get("host"));
  const forwarded = singleHostHeader(request.headers.get("x-forwarded-host"));
  let host = hostHeader;
  if (
    !host ||
    (forwarded && isLoopbackName(splitHost(host).name) && !isLoopbackName(splitHost(forwarded).name))
  ) {
    host = forwarded;
  }
  if (!host && request.url) {
    try {
      host = new URL(request.url).host;
    } catch {
      host = "";
    }
  }
  return Boolean(host) && hostsMatch(originUrl.host, host, originUrl.protocol);
}
