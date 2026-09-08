/**
 * Host allow-list for public agent registration.
 * Never defaults to a production marketing domain.
 */

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

function hostFromUrlOrHost(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    if (value.includes("://")) {
      return stripPort(new URL(value).host) || null;
    }
  } catch {
    return null;
  }
  return stripPort(value) || null;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

export function parsePublicRegisterAllowedHosts(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const seen = new Set<string>();
  const hosts: string[] = [];
  const add = (raw: string | undefined) => {
    if (!raw?.trim()) return;
    for (const part of raw.split(",")) {
      const host = hostFromUrlOrHost(part);
      if (!host || seen.has(host)) continue;
      seen.add(host);
      hosts.push(host);
    }
  };

  add(env.SA360_PUBLIC_REGISTER_ALLOWED_ORIGINS);
  add(env.SA360_PUBLIC_MARKETING_HOSTS);
  add(env.ADMIN_COC_BASE_URL);
  add(env.SA360_PORTAL_PUBLIC_BASE_URL);
  add(env.CORS_ALLOWED_ORIGINS);
  return hosts;
}

export function requestHostFromRegisterHeaders(input: {
  origin?: string | null;
  referer?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
}): string | null {
  const originHost = input.origin ? hostFromUrlOrHost(input.origin) : null;
  if (originHost) return originHost;
  const refererHost = input.referer ? hostFromUrlOrHost(input.referer) : null;
  if (refererHost) return refererHost;
  const forwarded = (input.forwardedHost || "").split(",")[0]?.trim();
  if (forwarded) {
    const host = stripPort(forwarded);
    if (host) return host;
  }
  if (input.host) {
    const host = stripPort(input.host);
    if (host) return host;
  }
  return null;
}

export function isPublicRegisterOriginAllowed(input: {
  origin?: string | null;
  referer?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const requestHost = requestHostFromRegisterHeaders(input);
  if (!requestHost) return false;
  const allowed = parsePublicRegisterAllowedHosts(input.env ?? process.env);
  if (allowed.length === 0) {
    return LOOPBACK.has(requestHost);
  }
  return allowed.includes(requestHost);
}
