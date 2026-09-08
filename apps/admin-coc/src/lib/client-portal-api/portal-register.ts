import { getSa360PublicApiBaseUrl } from "../sa360-public-api-base-url.ts";
import type { PortalRegisterApiSuccess } from "../client-portal/portal-register.ts";
import { PORTAL_REGISTER_GENERIC_ERROR } from "../client-portal/portal-register.ts";
import { CLIENT_PORTAL_KEY_HEADER, getClientPortalApiKey } from "./keys.ts";

export type PortalRegisterForwardHeaders = {
  origin?: string | null;
  referer?: string | null;
  forwardedHost?: string | null;
  forwardedFor?: string | null;
};

export type PortalRegisterClientResult =
  | { ok: true; data: PortalRegisterApiSuccess }
  | { ok: false; status: number; error: string; code?: string };

export function registerForwardHeadersFromRequest(h: {
  get(name: string): string | null;
}): PortalRegisterForwardHeaders {
  return {
    origin: h.get("origin"),
    referer: h.get("referer"),
    forwardedHost: h.get("x-forwarded-host") ?? h.get("host"),
    forwardedFor: h.get("x-forwarded-for") ?? h.get("x-real-ip"),
  };
}

function errorFromBody(text: string, status: number): PortalRegisterClientResult {
  try {
    const parsed = JSON.parse(text) as { error?: string; code?: string };
    return {
      ok: false,
      status,
      error: typeof parsed.error === "string" ? parsed.error : PORTAL_REGISTER_GENERIC_ERROR,
      code: typeof parsed.code === "string" ? parsed.code : undefined,
    };
  } catch {
    return { ok: false, status, error: PORTAL_REGISTER_GENERIC_ERROR };
  }
}

export async function postPortalRegister(
  input: { agencyName: string; email: string; password: string },
  forward: PortalRegisterForwardHeaders = {}
): Promise<PortalRegisterClientResult> {
  const baseUrl = getSa360PublicApiBaseUrl()?.replace(/\/$/, "");
  const apiKey = getClientPortalApiKey();
  if (!baseUrl || !apiKey) {
    return { ok: false, status: 0, error: PORTAL_REGISTER_GENERIC_ERROR };
  }

  const headers: Record<string, string> = {
    [CLIENT_PORTAL_KEY_HEADER]: apiKey,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (forward.origin?.trim()) headers.origin = forward.origin.trim();
  if (forward.referer?.trim()) headers.referer = forward.referer.trim();
  if (forward.forwardedHost?.trim()) headers["x-forwarded-host"] = forward.forwardedHost.trim();
  if (forward.forwardedFor?.trim()) headers["x-forwarded-for"] = forward.forwardedFor.trim();

  try {
    const res = await fetch(`${baseUrl}/client/v1/portal-register`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agencyName: input.agencyName,
        email: input.email,
        password: input.password,
      }),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) return errorFromBody(text, res.status);
    const json = JSON.parse(text) as PortalRegisterApiSuccess & { ok?: boolean };
    if (!json.context?.clientAccountId || json.status !== "onboarding") {
      return { ok: false, status: 502, error: PORTAL_REGISTER_GENERIC_ERROR };
    }
    return {
      ok: true,
      data: {
        portalSessionEpoch: json.portalSessionEpoch,
        status: json.status,
        context: json.context,
      },
    };
  } catch {
    return { ok: false, status: 0, error: PORTAL_REGISTER_GENERIC_ERROR };
  }
}
