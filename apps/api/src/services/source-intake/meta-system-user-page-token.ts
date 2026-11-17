import { createHmac } from "node:crypto";

import { DEFAULT_GRAPH_API_VERSION } from "../../lib/meta-webhook.js";
import { redactMetaSecretText } from "../../lib/meta-token-encryption.js";
import { readFacebookId } from "./facebook-form-association.js";

/**
 * Exchange one System User token for the Page access token Meta issues for a
 * single Page. Page endpoints (`leadgen_forms`, `subscribed_apps`, `/{leadgen-id}`)
 * reject the system user token with OAuth error 190. The Page token is taken
 * only from the `/me/accounts` row whose id is exactly the requested Page.
 * It is never stored, logged, or borrowed from another Page.
 */

const RATE_LIMIT_CODES = new Set([
  "4",
  "17",
  "32",
  "613",
  "80000",
  "80001",
  "80002",
  "80003",
  "80004",
  "80005",
  "80006",
  "80008",
  "80009",
  "80014",
]);
const PERMISSION_CODES = new Set(["10", "190", "200"]);
const MAX_PAGES = 8;
const PAGE_LIMIT = 50;

export const SYSTEM_USER_PAGE_ACCOUNT_FIELDS = "id,name,tasks,access_token";

type FetchLike = typeof fetch;

export type SystemUserPageAccount = {
  id: string;
  name: string | null;
  tasks: string[];
  /** In-memory only. Never serialize, log, or return from an admin route. */
  accessToken: string | null;
};

export type SystemUserAccountsList = {
  /** True when at least one `/me/accounts` page was read, including an empty 200. */
  ok: boolean;
  pages: SystemUserPageAccount[];
  truncated: boolean;
  rateLimited: boolean;
  permissionDenied: boolean;
  retryable: boolean;
  graphCode: string | null;
  httpStatus: number;
  diagnostic: string | null;
};

export type SystemUserPageTokenExchange =
  | { ok: true; pageId: string; accessToken: string }
  | {
      ok: false;
      reason: "page_token_missing" | "missing_permission" | "page_token_exchange_unavailable";
      retryable: boolean;
      diagnostic: string;
      graphCode: string | null;
      httpStatus: number;
    };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 40) : [];
}

function pageAccessToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 20 ? trimmed : null;
}

function graphError(body: unknown): { code: string | null; message: string | null } {
  const error = asRecord(asRecord(body)?.error);
  if (!error) return { code: null, message: null };
  const code = error.code;
  return {
    code: typeof code === "number" || typeof code === "string" ? String(code) : null,
    message: asString(error.message),
  };
}

function isPermissionCode(code: string): boolean {
  if (PERMISSION_CODES.has(code)) return true;
  const n = Number(code);
  return Number.isInteger(n) && n >= 200 && n <= 299;
}

async function graphGet(input: {
  token: string;
  appSecret: string | null;
  version: string;
  params: URLSearchParams;
  fetchImpl: FetchLike;
}): Promise<{ status: number; body: unknown }> {
  const params = new URLSearchParams(input.params);
  if (input.appSecret) {
    params.set("appsecret_proof", createHmac("sha256", input.appSecret).update(input.token, "utf8").digest("hex"));
  }
  const query = params.toString();
  const url = `https://graph.facebook.com/${input.version}/me/accounts${query ? `?${query}` : ""}`;
  try {
    const response = await input.fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${input.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json().catch(() => null)) as unknown;
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

function accountFromRow(value: unknown): SystemUserPageAccount | null {
  const row = asRecord(value);
  const parsed = readFacebookId(row?.id);
  if (!parsed.ok) return null;
  return {
    id: parsed.value,
    name: asString(row?.name),
    tasks: stringList(row?.tasks),
    accessToken: pageAccessToken(row?.access_token),
  };
}

export async function listSystemUserPageAccounts(input: {
  systemUserToken: string;
  appSecret: string | null;
  graphApiVersion?: string;
  fetchImpl?: FetchLike;
}): Promise<SystemUserAccountsList> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const version = input.graphApiVersion ?? DEFAULT_GRAPH_API_VERSION;
  const secrets = [input.systemUserToken, input.appSecret];
  const pages: SystemUserPageAccount[] = [];
  let after: string | null = null;
  let sawSuccess = false;
  let truncated = false;
  let rateLimited = false;
  let permissionDenied = false;
  let retryable = false;
  let graphCode: string | null = null;
  let httpStatus = 0;
  let diagnostic: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      fields: SYSTEM_USER_PAGE_ACCOUNT_FIELDS,
      limit: String(PAGE_LIMIT),
    });
    if (after) params.set("after", after);
    const result = await graphGet({
      token: input.systemUserToken,
      appSecret: input.appSecret,
      version,
      params,
      fetchImpl,
    });
    httpStatus = result.status;
    const error = graphError(result.body);
    graphCode = error.code;
    if (error.code && RATE_LIMIT_CODES.has(error.code)) {
      rateLimited = true;
      retryable = true;
      diagnostic = redactMetaSecretText(
        `Meta rate-limited /me/accounts (code ${error.code}). Page tokens already read were kept. No other Page token is substituted.`,
        secrets
      );
      break;
    }
    if (error.code && isPermissionCode(error.code)) {
      permissionDenied = true;
      diagnostic = redactMetaSecretText(
        `Meta refused /me/accounts (code ${error.code}). ${error.message ?? "The system user token cannot list Page access tokens."} Page endpoints were not called with the system user token.`,
        secrets
      );
      break;
    }
    if (!result.status || result.status >= 500 || result.status === 429) {
      retryable = true;
      diagnostic = redactMetaSecretText(
        `Meta /me/accounts could not be completed (status ${result.status}). Page endpoints were not called with the system user token.`,
        secrets
      );
      break;
    }
    if (result.status >= 400) {
      diagnostic = redactMetaSecretText(
        `Meta /me/accounts failed (status ${result.status}${error.code ? `, code ${error.code}` : ""}). Page endpoints were not called with the system user token.`,
        secrets
      );
      break;
    }
    sawSuccess = true;
    const record = asRecord(result.body);
    const batch = Array.isArray(record?.data) ? record.data : [];
    for (const item of batch) {
      const account = accountFromRow(item);
      if (account) pages.push(account);
    }
    const nextAfter = asString(asRecord(asRecord(record?.paging)?.cursors)?.after);
    const hasNext = Boolean(asRecord(record?.paging)?.next);
    if (!hasNext || !nextAfter || nextAfter === after) {
      after = null;
      break;
    }
    after = nextAfter;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  if (after) truncated = true;
  if (truncated && !diagnostic) {
    diagnostic = "Stopped pagination for /me/accounts at the page cap. Pages past the cap were not assigned another Page's token.";
  }
  return {
    ok: sawSuccess,
    pages,
    truncated,
    rateLimited,
    permissionDenied,
    retryable,
    graphCode,
    httpStatus,
    diagnostic,
  };
}

/**
 * Choose the access token on the account row with this exact Page id.
 * A missing row or a row without `access_token` fails closed.
 */
export function selectExactPageAccessToken(
  pages: SystemUserPageAccount[],
  pageId: string
): { ok: true; pageId: string; accessToken: string } | { ok: false; reason: "page_token_missing"; diagnostic: string } {
  const requested = readFacebookId(pageId);
  if (!requested.ok) {
    return {
      ok: false,
      reason: "page_token_missing",
      diagnostic:
        "The notification Page id is not a numeric Facebook Page id, so no Page access token was selected.",
    };
  }
  const matches = pages.filter((page) => page.id === requested.value);
  const withToken = matches.find((page) => page.accessToken);
  if (withToken?.accessToken) {
    return { ok: true, pageId: requested.value, accessToken: withToken.accessToken };
  }
  if (matches.length > 0) {
    return {
      ok: false,
      reason: "page_token_missing",
      diagnostic: `Meta listed Page ${requested.value} on /me/accounts but did not return a Page access token for it. The system user token and every other Page token were not used.`,
    };
  }
  return {
    ok: false,
    reason: "page_token_missing",
    diagnostic: `Meta did not list Page ${requested.value} on /me/accounts. No other Page's access token was used.`,
  };
}

export async function exchangeSystemUserPageToken(input: {
  systemUserToken: string;
  pageId: string;
  appSecret: string | null;
  graphApiVersion?: string;
  fetchImpl?: FetchLike;
}): Promise<SystemUserPageTokenExchange> {
  const list = await listSystemUserPageAccounts(input);
  const secrets = [input.systemUserToken, input.appSecret, ...list.pages.map((page) => page.accessToken)];
  const selected = selectExactPageAccessToken(list.pages, input.pageId);
  if (selected.ok) {
    const requested = readFacebookId(input.pageId);
    if (!requested.ok || selected.pageId !== requested.value) {
      return {
        ok: false,
        reason: "page_token_missing",
        retryable: false,
        diagnostic: `No Page access token matched Page ${input.pageId}. A token for a different Page was not used.`,
        graphCode: null,
        httpStatus: list.httpStatus,
      };
    }
    return selected;
  }
  if (list.permissionDenied && !list.pages.some((page) => page.accessToken)) {
    return {
      ok: false,
      reason: "missing_permission",
      retryable: false,
      diagnostic: redactMetaSecretText(
        list.diagnostic ??
          "Meta refused to list Page access tokens for this system user. The system user token was not used on the Page endpoint.",
        secrets
      ),
      graphCode: list.graphCode,
      httpStatus: list.httpStatus,
    };
  }
  if (list.retryable && !selected.ok) {
    return {
      ok: false,
      reason: "page_token_exchange_unavailable",
      retryable: true,
      diagnostic: redactMetaSecretText(
        list.diagnostic ??
          "Meta /me/accounts was temporarily unavailable, so no Page access token was selected.",
        secrets
      ),
      graphCode: list.graphCode,
      httpStatus: list.httpStatus,
    };
  }
  if (!list.ok) {
    return {
      ok: false,
      reason: "page_token_exchange_unavailable",
      retryable: false,
      diagnostic: redactMetaSecretText(
        list.diagnostic ?? "Meta /me/accounts failed, so no Page access token was selected.",
        secrets
      ),
      graphCode: list.graphCode,
      httpStatus: list.httpStatus,
    };
  }
  const truncated = list.truncated
    ? " Pagination stopped before the end of /me/accounts, and a token from a Page that was listed was not reused."
    : "";
  return {
    ok: false,
    reason: "page_token_missing",
    retryable: false,
    diagnostic: redactMetaSecretText(`${selected.diagnostic}${truncated}`, secrets),
    graphCode: null,
    httpStatus: list.httpStatus,
  };
}
