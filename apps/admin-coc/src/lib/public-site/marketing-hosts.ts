/**
 * Optional public-hostname rewrite. Never defaults to a production domain.
 * Operators set SA360_PUBLIC_MARKETING_HOSTS after DNS is pointed at admin-coc.
 */

export const PUBLIC_MARKETING_HOSTS_ENV = "SA360_PUBLIC_MARKETING_HOSTS";

function stripPort(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end > 0) return trimmed.slice(1, end);
  }
  const colon = trimmed.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(trimmed.slice(colon + 1))) {
    return trimmed.slice(0, colon);
  }
  return trimmed;
}

export function parsePublicMarketingHosts(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const hosts: string[] = [];
  for (const part of raw.split(",")) {
    const host = stripPort(part);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    hosts.push(host);
  }
  return hosts;
}

export function normalizeRequestHost(
  forwardedHost: string | null | undefined,
  host: string | null | undefined
): string | null {
  const raw = (forwardedHost || host || "").split(",")[0]?.trim() ?? "";
  const normalized = stripPort(raw);
  return normalized || null;
}

export function isPublicMarketingHost(
  requestHost: string | null,
  envRaw: string | undefined | null = process.env[PUBLIC_MARKETING_HOSTS_ENV]
): boolean {
  if (!requestHost) return false;
  const allowed = parsePublicMarketingHosts(envRaw);
  if (allowed.length === 0) return false;
  return allowed.includes(requestHost);
}

export function shouldRewriteRootToPublicLanding(input: {
  pathname: string;
  forwardedHost?: string | null;
  host?: string | null;
  envRaw?: string | null;
}): boolean {
  if (input.pathname !== "/") return false;
  const requestHost = normalizeRequestHost(input.forwardedHost, input.host);
  return isPublicMarketingHost(requestHost, input.envRaw);
}
