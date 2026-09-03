import { getSa360PublicApiBaseUrl } from "../sa360-public-api-base-url.ts";
import { CLIENT_PORTAL_KEY_HEADER, getClientPortalApiKey } from "./keys.ts";

export type PortalClientContextResponse = {
  clientAccountId: string;
  clientDisplayName: string;
  portalDisplayName: string | null;
  portalLoginEmail: string | null;
  portalEnabled: boolean;
  locationName: string | null;
  subaccountIdGhl: string | null;
  primaryNicheKeys: string[];
  primaryProductTypes: string[];
  hasPortalPassword?: boolean;
  portalSessionEpoch?: number;
};

export type PortalLoginApiSuccess = {
  passwordCheck: "customer" | "env_fallback";
  portalSessionEpoch: number;
  context: PortalClientContextResponse;
};

export type PortalSessionAuthStateResponse = {
  clientAccountId: string;
  portalSessionEpoch: number;
  portalEnabled: boolean;
};

type FetchFailure = { ok: false; status: number; body: string };
type FetchSuccess<T> = { ok: true; data: T };
type FetchResult<T> = FetchSuccess<T> | FetchFailure;

function portalApiParts(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = getSa360PublicApiBaseUrl();
  const apiKey = getClientPortalApiKey();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}

export async function fetchPortalClientContext(
  loginEmail: string
): Promise<FetchResult<PortalClientContextResponse>> {
  const parts = portalApiParts();
  if (!parts) {
    return { ok: false, status: 0, body: "Client portal API not configured" };
  }

  const params = new URLSearchParams({
    loginEmail: loginEmail.trim().toLowerCase(),
  });
  const url = `${parts.baseUrl}/client/v1/portal-context?${params.toString()}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        [CLIENT_PORTAL_KEY_HEADER]: parts.apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, body: text };
    }
    const json = JSON.parse(text) as { context: PortalClientContextResponse };
    return { ok: true, data: json.context };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return { ok: false, status: 0, body: msg };
  }
}

export async function postPortalLogin(
  loginEmail: string,
  password: string
): Promise<FetchResult<PortalLoginApiSuccess>> {
  const parts = portalApiParts();
  if (!parts) {
    return { ok: false, status: 0, body: "Client portal API not configured" };
  }

  const url = `${parts.baseUrl}/client/v1/portal-login`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        [CLIENT_PORTAL_KEY_HEADER]: parts.apiKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ loginEmail: loginEmail.trim().toLowerCase(), password }),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, body: text };
    }
    const json = JSON.parse(text) as PortalLoginApiSuccess & { ok?: boolean };
    if (json.passwordCheck !== "customer" && json.passwordCheck !== "env_fallback") {
      return { ok: false, status: 502, body: "Invalid portal login response" };
    }
    return {
      ok: true,
      data: {
        passwordCheck: json.passwordCheck,
        portalSessionEpoch: json.portalSessionEpoch,
        context: json.context,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return { ok: false, status: 0, body: msg };
  }
}

export async function fetchPortalSessionAuthState(
  clientAccountId: string
): Promise<FetchResult<PortalSessionAuthStateResponse>> {
  const parts = portalApiParts();
  if (!parts) {
    return { ok: false, status: 0, body: "Client portal API not configured" };
  }

  const params = new URLSearchParams({ clientAccountId: clientAccountId.trim() });
  const url = `${parts.baseUrl}/client/v1/portal-session-state?${params.toString()}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        [CLIENT_PORTAL_KEY_HEADER]: parts.apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, body: text };
    }
    const json = JSON.parse(text) as PortalSessionAuthStateResponse;
    return { ok: true, data: json };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return { ok: false, status: 0, body: msg };
  }
}

export type PortalInviteApiFailure = { ok: false; status: number; error: string; code?: string };

function inviteErrorFromBody(text: string, status: number): PortalInviteApiFailure {
  try {
    const parsed = JSON.parse(text) as { error?: string; code?: string };
    return {
      ok: false,
      status,
      error: typeof parsed.error === "string" ? parsed.error : "Invite is invalid or expired.",
      code: typeof parsed.code === "string" ? parsed.code : undefined,
    };
  } catch {
    return { ok: false, status, error: "Invite is invalid or expired." };
  }
}

export async function inspectPortalInviteToken(
  token: string
): Promise<{ ok: true } | PortalInviteApiFailure> {
  const parts = portalApiParts();
  if (!parts) {
    return { ok: false, status: 0, error: "Invite is invalid or expired." };
  }
  const url = `${parts.baseUrl}/client/v1/portal-invite/inspect`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        [CLIENT_PORTAL_KEY_HEADER]: parts.apiKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) return inviteErrorFromBody(text, res.status);
    return { ok: true };
  } catch {
    return { ok: false, status: 0, error: "Invite is invalid or expired." };
  }
}

export async function postPortalPasswordResetRequest(
  email: string,
  clientIp?: string
): Promise<{ ok: true }> {
  const parts = portalApiParts();
  if (!parts) {
    return { ok: true };
  }
  const url = `${parts.baseUrl}/client/v1/portal-password-reset/request`;
  try {
    const headers: Record<string, string> = {
      [CLIENT_PORTAL_KEY_HEADER]: parts.apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (clientIp && clientIp !== "unknown") {
      headers["x-forwarded-for"] = clientIp;
    }
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
      cache: "no-store",
    });
  } catch {
    /* Always present the same generic success to the browser. */
  }
  return { ok: true };
}

export async function postPortalInviteAccept(
  token: string,
  password: string
): Promise<{ ok: true } | PortalInviteApiFailure> {
  const parts = portalApiParts();
  if (!parts) {
    return { ok: false, status: 0, error: "Invite is invalid or expired." };
  }
  const url = `${parts.baseUrl}/client/v1/portal-invite/accept`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        [CLIENT_PORTAL_KEY_HEADER]: parts.apiKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token, password }),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) return inviteErrorFromBody(text, res.status);
    return { ok: true };
  } catch {
    return { ok: false, status: 0, error: "Invite is invalid or expired." };
  }
}
