import { STAFF_SIGN_IN_PATH } from "@sa360/shared/staff-sign-in-url";

/**
 * Decide whether this request may start Google OAuth.
 * OAuth state is host-only. A start on any other host than the configured
 * callback origin is sent to that origin's start route before a state cookie
 * is created. Forwarded-host lists are ignored.
 */

export type StaffGoogleStartDecision =
  | { kind: "start" }
  | { kind: "redirect"; location: string }
  | { kind: "unavailable" };

export function decideStaffGoogleStart(input: {
  host: string | null;
  forwardedHost: string | null;
  forwardedProto: string | null;
  requestUrl?: string | null;
  redirectUri: string | null;
}): StaffGoogleStartDecision {
  const callbackOrigin = callbackOriginOf(input.redirectUri);
  if (!callbackOrigin) return { kind: "unavailable" };
  const requestOrigin = publicRequestOrigin(
    input.host || hostFromUrl(input.requestUrl),
    input.forwardedHost,
    input.forwardedProto
  );
  if (!requestOrigin) return { kind: "unavailable" };
  if (requestOrigin === callbackOrigin) return { kind: "start" };
  return { kind: "redirect", location: `${callbackOrigin}${STAFF_SIGN_IN_PATH}` };
}

function hostFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function callbackOriginOf(redirectUri: string | null): string | null {
  if (!redirectUri) return null;
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/staff/google/callback") return null;
  return url.origin;
}

function publicRequestOrigin(
  hostHeader: string | null,
  forwardedHost: string | null,
  forwardedProto: string | null
): string | null {
  const forwarded = singleHost(forwardedHost);
  let host = singleHost(hostHeader);
  if (!host || (forwarded && isLoopback(host) && !isLoopback(forwarded))) host = forwarded;
  if (!host || host.includes("@")) return null;
  const proto = isLoopback(host) ? loopbackProto(forwardedProto) : "https";
  if (!proto) return null;
  try {
    const url = new URL(`${proto}://${host}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function singleHost(value: string | null): string {
  if (!value) return "";
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 1) return "";
  const host = parts[0] ?? "";
  if (!host || host.length > 255 || /[\s/\\]/.test(host)) return "";
  return host;
}

function isLoopback(host: string): boolean {
  const name = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

function loopbackProto(value: string | null): "http" | "https" | null {
  const proto = singleHost(value);
  if (!proto) return "http";
  if (proto === "http" || proto === "https") return proto;
  return null;
}
