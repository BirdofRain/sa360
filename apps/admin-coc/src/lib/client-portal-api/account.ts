import { getSa360PublicApiBaseUrl } from "../sa360-public-api-base-url.ts";
import {
  parsePortalAccountProfile,
  type PortalAccountProfile,
  type PortalAccountProfilePayload,
} from "../client-portal/account-profile.ts";
import { CLIENT_PORTAL_KEY_HEADER, getClientPortalApiKey } from "./keys.ts";

type FetchFailure = { ok: false; status: number; body: string };
type FetchSuccess<T> = { ok: true; data: T };
type FetchResult<T> = FetchSuccess<T> | FetchFailure;

async function fetchAccountJson<T>(
  path: string,
  init?: RequestInit
): Promise<FetchResult<T>> {
  const baseUrl = getSa360PublicApiBaseUrl();
  const apiKey = getClientPortalApiKey();
  if (!baseUrl || !apiKey) {
    return { ok: false, status: 0, body: "Client portal API not configured" };
  }
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        [CLIENT_PORTAL_KEY_HEADER]: apiKey,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, body: text };
    return { ok: true, data: JSON.parse(text) as T };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return { ok: false, status: 0, body: msg };
  }
}

function tenantQuery(clientAccountId: string): string {
  return new URLSearchParams({ clientAccountId }).toString();
}

function parseAccountResponse(
  raw: unknown
): PortalAccountProfile | null {
  if (!raw || typeof raw !== "object") return null;
  return parsePortalAccountProfile((raw as { account?: unknown }).account ?? raw);
}

export async function fetchClientAccountProfile(opts: {
  clientAccountId: string;
}): Promise<{ account: PortalAccountProfile | null; error: string | null; status: number }> {
  const res = await fetchAccountJson<unknown>(
    `/client/v1/account?${tenantQuery(opts.clientAccountId)}`
  );
  if (!res.ok) return { account: null, error: res.body, status: res.status };
  return { account: parseAccountResponse(res.data), error: null, status: 200 };
}

export async function patchClientAccountProfile(opts: {
  clientAccountId: string;
  body: PortalAccountProfilePayload;
}): Promise<{ account: PortalAccountProfile | null; error: string | null; status: number }> {
  const res = await fetchAccountJson<unknown>(
    `/client/v1/account?${tenantQuery(opts.clientAccountId)}`,
    { method: "PATCH", body: JSON.stringify(opts.body) }
  );
  if (!res.ok) return { account: null, error: res.body, status: res.status };
  return { account: parseAccountResponse(res.data), error: null, status: 200 };
}

export async function completeClientAccountOnboarding(opts: {
  clientAccountId: string;
  body: PortalAccountProfilePayload;
}): Promise<{
  account: PortalAccountProfile | null;
  error: string | null;
  status: number;
  missingFields: string[];
}> {
  const res = await fetchAccountJson<unknown>(
    `/client/v1/account/complete-onboarding?${tenantQuery(opts.clientAccountId)}`,
    { method: "POST", body: JSON.stringify(opts.body) }
  );
  if (!res.ok) {
    let missingFields: string[] = [];
    let account: PortalAccountProfile | null = null;
    try {
      const parsed = JSON.parse(res.body) as {
        missingFields?: unknown;
        account?: unknown;
      };
      missingFields = Array.isArray(parsed.missingFields)
        ? parsed.missingFields.filter((value): value is string => typeof value === "string")
        : [];
      account = parsePortalAccountProfile(parsed.account);
    } catch {
      missingFields = [];
    }
    return { account, error: res.body, status: res.status, missingFields };
  }
  return {
    account: parseAccountResponse(res.data),
    error: null,
    status: 200,
    missingFields: [],
  };
}
