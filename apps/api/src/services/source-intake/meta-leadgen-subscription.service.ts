import { createHmac } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import { DEFAULT_GRAPH_API_VERSION } from "../../lib/meta-webhook.js";
import {
  decryptMetaToken,
  isMetaTokenEncryptionConfigured,
  redactMetaSecretText,
} from "../../lib/meta-token-encryption.js";
import { readFacebookId } from "./facebook-form-association.js";
import {
  listSystemUserPageAccounts,
  selectExactPageAccessToken,
  type SystemUserAccountsList,
} from "./meta-system-user-page-token.js";

/**
 * Admin-only leadgen webhook subscription for Pages on one stored system-user
 * credential.
 *
 * The Page access token is the `/me/accounts` row whose id equals the grant.
 * Another Page's token and the system-user token are never sent to
 * `/{page-id}/subscribed_apps`. Capture grants, intake, Graph lead fetch,
 * routing, and delivery are not changed.
 *
 * A write is refused unless `SA360_META_LEADGEN_SUBSCRIPTION_WRITES_ENABLED`
 * is true and intake, Graph fetch, routing, and `FACEBOOK_DIRECT_INTAKE_ENABLED`
 * are all false. Success is the following Graph GET, not the POST body.
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
const SUBSCRIPTION_PAGE_CAP = 4;

export const META_LEADGEN_SUBSCRIPTION_SCOPES = ["pages_show_list", "pages_manage_metadata"] as const;
export const META_LEADGEN_SUBSCRIPTION_CONFIRMATION_PREFIX = "SUBSCRIBE LEADGEN";

export function metaLeadgenSubscriptionConfirmation(pageId: string): string {
  return `${META_LEADGEN_SUBSCRIPTION_CONFIRMATION_PREFIX} ${pageId}`;
}

export type MetaLeadgenSubscriptionSettings = {
  writesEnabled: boolean;
  intakeEnabled: boolean;
  graphFetchEnabled: boolean;
  routingEnabled: boolean;
  legacyDirectIntakeEnabled: boolean;
  appSecret: string | null;
  graphApiVersion: string;
  /** `META_APP_ID` when set. It must match the stored credential app id. */
  expectedAppId: string | null;
};

export type StoredMetaSubscriptionCredential = {
  id: string;
  kind: "page_access_token" | "system_user";
  status: "active" | "disabled" | "expired" | "revoked" | "missing_permission";
  appId: string | null;
  expiresAt: Date | null;
  scopes: string[];
  tokenCiphertext: string;
  tokenFingerprint: string;
  pageGrants: Array<{ pageId: string; pageName: string | null; captureEnabled: boolean }>;
};

export type SubscriptionErrorCode =
  | "not_found"
  | "encryption_not_configured"
  | "credential_unreadable"
  | "credential_not_active"
  | "token_expired"
  | "credential_kind_unsupported"
  | "app_id_unavailable"
  | "app_id_unverified"
  | "wrong_app_id"
  | "missing_permission"
  | "rate_limited"
  | "graph_error"
  | "page_not_granted"
  | "page_token_missing"
  | "invalid_page_id"
  | "confirmation_required"
  | "writes_disabled"
  | "production_unsafe"
  | "verification_failed";

export type OtherSubscribedApp = {
  appId: string;
  appName: string | null;
  subscribedFields: string[];
};

export type PageSubscriptionStatus = {
  pageId: string;
  pageName: string | null;
  captureEnabled: boolean;
  subscriptionKnown: boolean;
  sa360LeadgenSubscribed: boolean | null;
  sa360SubscribedFields: string[];
  otherApps: OtherSubscribedApp[];
  error:
    | null
    | "page_token_missing"
    | "missing_permission"
    | "rate_limited"
    | "graph_error"
    | "not_checked"
    | "invalid_page_id";
  diagnostic: string | null;
  graphCode: string | null;
  httpStatus: number | null;
};

export type LeadgenSubscriptionFailure = {
  ok: false;
  error: SubscriptionErrorCode;
  httpStatus: number;
  message: string;
  diagnostic: string | null;
  credentialId: string | null;
  pageId: string | null;
  postSent: boolean;
  verifiedByGet: false;
  captureGrantMutated: false;
  sa360SubscribedFields?: string[];
  otherAppsUnchanged?: boolean;
};

export type LeadgenSubscriptionRead = {
  ok: true;
  credentialId: string;
  credentialKind: "system_user";
  appId: string;
  appIdVerified: true;
  tokenFingerprint: string;
  writesEnabled: boolean;
  productionSafe: boolean;
  captureGrantMutated: false;
  partial: boolean;
  pages: PageSubscriptionStatus[];
};

export type LeadgenSubscriptionWrite = {
  ok: true;
  credentialId: string;
  pageId: string;
  pageName: string | null;
  captureEnabled: boolean;
  captureGrantMutated: false;
  action: "already_subscribed" | "subscribed";
  postSent: boolean;
  verifiedByGet: true;
  subscribedFieldsSent: string[] | null;
  sa360SubscribedFields: string[];
  preservedFields: string[];
  otherAppsUnchanged: true;
  otherApps: OtherSubscribedApp[];
  diagnostic: string | null;
};

type FetchLike = typeof fetch;

type LogImpl = (level: "info" | "warn", message: string, meta: Record<string, unknown>) => void;

export type MetaLeadgenSubscriptionDeps = {
  loadCredentialImpl?: (credentialId: string) => Promise<StoredMetaSubscriptionCredential | null>;
  decryptImpl?: (ciphertext: string) => string;
  fetchImpl?: FetchLike;
  settings?: MetaLeadgenSubscriptionSettings;
  now?: () => Date;
  logImpl?: LogImpl;
};

type GraphHttp = {
  status: number;
  body: unknown;
  ok: boolean;
  rateLimited: boolean;
  permissionDenied: boolean;
  graphCode: string | null;
  diagnostic: string | null;
};

type SubscribedApp = {
  appId: string;
  appName: string | null;
  subscribedFields: string[];
};

type SubscriptionList = {
  ok: boolean;
  apps: SubscribedApp[];
  truncated: boolean;
  rateLimited: boolean;
  permissionDenied: boolean;
  graphCode: string | null;
  httpStatus: number;
  diagnostic: string | null;
};

type PreparedCredential = {
  record: StoredMetaSubscriptionCredential;
  appId: string;
  accessToken: string;
  secrets: Array<string | null>;
};

type NormalizedGrant = {
  pageId: string;
  pageName: string | null;
  captureEnabled: boolean;
  valid: boolean;
};

function envFlag(name: string): boolean {
  return (process.env[name]?.trim() ?? "").toLowerCase() === "true";
}

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function readMetaLeadgenSubscriptionSettings(): MetaLeadgenSubscriptionSettings {
  return {
    writesEnabled: envFlag("SA360_META_LEADGEN_SUBSCRIPTION_WRITES_ENABLED"),
    intakeEnabled: envFlag("SA360_META_LEAD_ADS_INTAKE_ENABLED"),
    graphFetchEnabled: envFlag("SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED"),
    routingEnabled: envFlag("SA360_META_LEAD_ADS_ROUTING_ENABLED"),
    legacyDirectIntakeEnabled: envFlag("FACEBOOK_DIRECT_INTAKE_ENABLED"),
    appSecret: envValue("META_APP_SECRET"),
    graphApiVersion: envValue("META_GRAPH_API_VERSION") ?? DEFAULT_GRAPH_API_VERSION,
    expectedAppId: envValue("META_APP_ID"),
  };
}

export function isMetaLeadgenSubscriptionProductionSafe(settings: MetaLeadgenSubscriptionSettings): boolean {
  return (
    !settings.intakeEnabled &&
    !settings.graphFetchEnabled &&
    !settings.routingEnabled &&
    !settings.legacyDirectIntakeEnabled
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function scopesOf(value: Prisma.JsonValue | string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const scopes: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && /^[a-z0-9_]{1,64}$/.test(item)) scopes.push(item);
  }
  return scopes;
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

function sameSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every((item) => values.has(item));
}

function fieldsForSubscribe(existing: string[]): string[] {
  const fields: string[] = [];
  for (const field of existing) {
    if (field === "leadgen" || fields.includes(field)) continue;
    fields.push(field);
  }
  fields.push("leadgen");
  return fields;
}

function fail(
  error: SubscriptionErrorCode,
  httpStatus: number,
  message: string,
  extra: {
    credentialId?: string | null;
    pageId?: string | null;
    diagnostic?: string | null;
    postSent?: boolean;
    sa360SubscribedFields?: string[];
    otherAppsUnchanged?: boolean;
  } = {}
): LeadgenSubscriptionFailure {
  return {
    ok: false,
    error,
    httpStatus,
    message,
    diagnostic: extra.diagnostic ?? null,
    credentialId: extra.credentialId ?? null,
    pageId: extra.pageId ?? null,
    postSent: extra.postSent ?? false,
    verifiedByGet: false,
    captureGrantMutated: false,
    ...(extra.sa360SubscribedFields ? { sa360SubscribedFields: extra.sa360SubscribedFields } : {}),
    ...(extra.otherAppsUnchanged !== undefined ? { otherAppsUnchanged: extra.otherAppsUnchanged } : {}),
  };
}

function redactDeep(value: unknown, secrets: Array<string | null | undefined>): unknown {
  if (typeof value === "string") return redactMetaSecretText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, secrets));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "accessToken" || key === "tokenCiphertext" || key === "appsecret_proof" || key === "input_token") {
        continue;
      }
      out[key] = redactDeep(item, secrets);
    }
    return out;
  }
  return value;
}

function containsSecret(value: unknown, secrets: Array<string | null | undefined>): boolean {
  const json = JSON.stringify(value);
  return secrets.some((secret) => Boolean(secret && secret.length >= 8 && json.includes(secret)));
}

function finalize<T>(value: T, secrets: Array<string | null | undefined>): T {
  const redacted = redactDeep(value, secrets) as T;
  if (!containsSecret(redacted, secrets)) return redacted;
  return fail(
    "graph_error",
    502,
    "The Meta subscription result was withheld because it contained credential material.",
    { diagnostic: "Credential material was removed from the subscription result." }
  ) as T;
}

function logSubscription(
  deps: MetaLeadgenSubscriptionDeps,
  level: "info" | "warn",
  message: string,
  meta: Record<string, unknown>,
  secrets: Array<string | null | undefined>
): void {
  const safe = redactDeep(meta, secrets) as Record<string, unknown>;
  const payload = containsSecret(safe, secrets)
    ? { credentialId: meta.credentialId ?? null, pageId: meta.pageId ?? null, action: meta.action ?? null, result: "redacted" }
    : safe;
  if (deps.logImpl) {
    deps.logImpl(level, message, payload);
    return;
  }
  logger[level](message, payload);
}

const credentialSelect = {
  id: true,
  kind: true,
  status: true,
  appId: true,
  expiresAt: true,
  scopes: true,
  tokenCiphertext: true,
  tokenFingerprint: true,
  pageGrants: {
    select: { pageId: true, pageName: true, captureEnabled: true },
    orderBy: { pageId: "asc" as const },
  },
} satisfies Prisma.MetaGraphCredentialSelect;

async function defaultLoadCredential(credentialId: string): Promise<StoredMetaSubscriptionCredential | null> {
  const row = await prisma.metaGraphCredential.findUnique({
    where: { id: credentialId },
    select: credentialSelect,
  });
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    appId: row.appId,
    expiresAt: row.expiresAt,
    scopes: scopesOf(row.scopes),
    tokenCiphertext: row.tokenCiphertext,
    tokenFingerprint: row.tokenFingerprint,
    pageGrants: row.pageGrants.map((grant) => ({
      pageId: grant.pageId,
      pageName: grant.pageName,
      captureEnabled: grant.captureEnabled,
    })),
  };
}

function normalizedGrants(record: StoredMetaSubscriptionCredential): NormalizedGrant[] {
  const grants: NormalizedGrant[] = [];
  const seen = new Set<string>();
  const sorted = [...record.pageGrants].sort((left, right) => left.pageId.localeCompare(right.pageId));
  for (const grant of sorted) {
    const parsed = readFacebookId(grant.pageId);
    const pageId = parsed.ok ? parsed.value : grant.pageId.trim().slice(0, 32);
    if (seen.has(pageId)) continue;
    seen.add(pageId);
    grants.push({
      pageId,
      pageName: grant.pageName,
      captureEnabled: grant.captureEnabled,
      valid: parsed.ok,
    });
  }
  return grants;
}

async function prepareCredential(
  credentialId: string,
  deps: MetaLeadgenSubscriptionDeps,
  settings: MetaLeadgenSubscriptionSettings
): Promise<{ ok: true; prepared: PreparedCredential; grants: NormalizedGrant[] } | { ok: false; failure: LeadgenSubscriptionFailure }> {
  const load = deps.loadCredentialImpl ?? defaultLoadCredential;
  const record = await load(credentialId);
  if (!record || record.id !== credentialId) {
    return {
      ok: false,
      failure: fail("not_found", 404, "The Meta credential was not found.", { credentialId }),
    };
  }
  const credentialRef = { credentialId: record.id };
  if (record.kind !== "system_user") {
    return {
      ok: false,
      failure: fail(
        "credential_kind_unsupported",
        409,
        "Leadgen subscription management uses the stored system-user credential and exchanges a Page token per Page.",
        credentialRef
      ),
    };
  }
  if (record.status !== "active") {
    return {
      ok: false,
      failure: fail(
        "credential_not_active",
        409,
        `The Meta credential status is ${record.status}. Graph was not called.`,
        credentialRef
      ),
    };
  }
  const now = (deps.now ?? (() => new Date()))();
  if (record.expiresAt && record.expiresAt.getTime() <= now.getTime()) {
    return {
      ok: false,
      failure: fail(
        "token_expired",
        409,
        `The Meta credential expired at ${record.expiresAt.toISOString()}. Graph was not called.`,
        credentialRef
      ),
    };
  }
  const appId = readFacebookId(record.appId);
  if (!appId.ok) {
    return {
      ok: false,
      failure: fail(
        "app_id_unavailable",
        409,
        "The stored credential has no numeric Meta app id, so the SA360 subscription cannot be identified.",
        credentialRef
      ),
    };
  }
  if (settings.expectedAppId && settings.expectedAppId !== appId.value) {
    return {
      ok: false,
      failure: fail(
        "wrong_app_id",
        409,
        "META_APP_ID does not match the app id stored on this credential. Graph was not called.",
        credentialRef
      ),
    };
  }
  const missingStored = META_LEADGEN_SUBSCRIPTION_SCOPES.filter((scope) => !record.scopes.includes(scope));
  if (record.scopes.length > 0 && missingStored.length > 0) {
    return {
      ok: false,
      failure: fail(
        "missing_permission",
        403,
        `The stored credential is missing ${missingStored.join(", ")}. Graph was not called.`,
        credentialRef
      ),
    };
  }
  if (!deps.decryptImpl && !isMetaTokenEncryptionConfigured()) {
    return {
      ok: false,
      failure: fail(
        "encryption_not_configured",
        503,
        "META_TOKEN_ENCRYPTION_KEY is not configured. The stored credential was not decrypted.",
        credentialRef
      ),
    };
  }
  let accessToken: string;
  try {
    accessToken = (deps.decryptImpl ?? decryptMetaToken)(record.tokenCiphertext);
  } catch {
    return {
      ok: false,
      failure: fail(
        "credential_unreadable",
        409,
        "The stored Meta credential could not be decrypted. Graph was not called.",
        credentialRef
      ),
    };
  }
  if (typeof accessToken !== "string" || accessToken.trim().length < 20) {
    return {
      ok: false,
      failure: fail(
        "credential_unreadable",
        409,
        "The stored Meta credential did not yield a usable token. Graph was not called.",
        credentialRef
      ),
    };
  }
  return {
    ok: true,
    prepared: {
      record,
      appId: appId.value,
      accessToken: accessToken.trim(),
      secrets: [accessToken.trim(), settings.appSecret],
    },
    grants: normalizedGrants(record),
  };
}

async function graphRequest(input: {
  method: "GET" | "POST";
  path: string;
  token: string;
  appSecret: string | null;
  version: string;
  params: URLSearchParams;
  fetchImpl: FetchLike;
  secrets: Array<string | null>;
  proof: boolean;
}): Promise<GraphHttp> {
  const params = new URLSearchParams(input.params);
  if (input.proof && input.appSecret) {
    params.set("appsecret_proof", createHmac("sha256", input.appSecret).update(input.token, "utf8").digest("hex"));
  }
  const query = params.toString();
  const url = `https://graph.facebook.com/${input.version}/${input.path}${query ? `?${query}` : ""}`;
  try {
    const response = await input.fetchImpl(url, {
      method: input.method,
      headers: { Authorization: `Bearer ${input.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json().catch(() => null)) as unknown;
    return classifyGraph(input.path, response.status, body, input.secrets);
  } catch {
    return {
      status: 0,
      body: null,
      ok: false,
      rateLimited: false,
      permissionDenied: false,
      graphCode: null,
      diagnostic: redactMetaSecretText(
        `Meta Graph ${input.path} could not be completed.`,
        input.secrets
      ),
    };
  }
}

function classifyGraph(path: string, status: number, body: unknown, secrets: Array<string | null>): GraphHttp {
  const error = graphError(body);
  const rateLimited = status === 429 || Boolean(error.code && RATE_LIMIT_CODES.has(error.code));
  const permissionDenied = Boolean(error.code && isPermissionCode(error.code));
  const ok = status >= 200 && status < 300 && !error.code && body !== null;
  return {
    status,
    body,
    ok,
    rateLimited,
    permissionDenied,
    graphCode: error.code,
    diagnostic: ok
      ? null
      : redactMetaSecretText(
          `Meta Graph ${path} failed (status ${status}${error.code ? `, code ${error.code}` : ""}). ${error.message ?? "Graph returned an error."}`,
          secrets
        ),
  };
}

async function assertLiveApp(input: {
  prepared: PreparedCredential;
  settings: MetaLeadgenSubscriptionSettings;
  fetchImpl: FetchLike;
}): Promise<{ ok: true } | { ok: false; failure: LeadgenSubscriptionFailure }> {
  if (!input.settings.appSecret) {
    return {
      ok: false,
      failure: fail(
        "app_id_unverified",
        409,
        "META_APP_SECRET is required before reading or changing Page subscriptions. Graph Page endpoints were not called.",
        { credentialId: input.prepared.record.id }
      ),
    };
  }
  const appToken = `${input.prepared.appId}|${input.settings.appSecret}`;
  input.prepared.secrets.push(appToken);
  const result = await graphRequest({
    method: "GET",
    path: "debug_token",
    token: appToken,
    appSecret: null,
    version: input.settings.graphApiVersion,
    params: new URLSearchParams({ input_token: input.prepared.accessToken }),
    fetchImpl: input.fetchImpl,
    secrets: input.prepared.secrets,
    proof: false,
  });
  const credentialId = input.prepared.record.id;
  if (result.rateLimited) {
    return {
      ok: false,
      failure: fail("rate_limited", 429, "Meta rate-limited debug_token. Page endpoints were not called.", {
        credentialId,
        diagnostic: result.diagnostic,
      }),
    };
  }
  if (result.permissionDenied) {
    return {
      ok: false,
      failure: fail("missing_permission", 403, "Meta refused debug_token. Page endpoints were not called.", {
        credentialId,
        diagnostic: result.diagnostic,
      }),
    };
  }
  const data = asRecord(asRecord(result.body)?.data);
  if (!result.ok || !data) {
    return {
      ok: false,
      failure: fail("graph_error", result.status >= 400 && result.status < 500 ? result.status : 502, "debug_token did not verify the credential. Page endpoints were not called.", {
        credentialId,
        diagnostic: result.diagnostic,
      }),
    };
  }
  if (data.is_valid !== true) {
    return {
      ok: false,
      failure: fail("credential_not_active", 409, "debug_token reported the credential is not valid. Page endpoints were not called.", {
        credentialId,
      }),
    };
  }
  const liveAppId = asString(data.app_id);
  if (!liveAppId || liveAppId !== input.prepared.appId) {
    return {
      ok: false,
      failure: fail(
        "wrong_app_id",
        409,
        "debug_token app id does not match the app id stored on this credential. Page endpoints were not called.",
        { credentialId }
      ),
    };
  }
  const expires = data.expires_at;
  if (typeof expires === "number" && expires > 0 && expires * 1000 <= Date.now()) {
    return {
      ok: false,
      failure: fail("token_expired", 409, "debug_token reported the credential is expired. Page endpoints were not called.", {
        credentialId,
      }),
    };
  }
  const scopes = scopesOf(Array.isArray(data.scopes) ? data.scopes : []);
  const missing = META_LEADGEN_SUBSCRIPTION_SCOPES.filter((scope) => !scopes.includes(scope));
  if (missing.length > 0) {
    return {
      ok: false,
      failure: fail(
        "missing_permission",
        403,
        `debug_token is missing ${missing.join(", ")}. Page endpoints were not called.`,
        { credentialId }
      ),
    };
  }
  return { ok: true };
}

function pageTokenError(
  accounts: SystemUserAccountsList,
  pageId: string,
  systemToken: string
): { ok: true; accessToken: string } | { ok: false; error: "page_token_missing" | "not_checked"; diagnostic: string } {
  const listIncomplete = accounts.rateLimited || accounts.truncated || accounts.permissionDenied;
  const selected = selectExactPageAccessToken(accounts.pages, pageId);
  if (!selected.ok || selected.pageId !== pageId) {
    if (listIncomplete) {
      return {
        ok: false,
        error: "not_checked",
        diagnostic:
          accounts.diagnostic ??
          `Page ${pageId} was not checked because /me/accounts did not finish. Another Page's token was not used.`,
      };
    }
    return {
      ok: false,
      error: "page_token_missing",
      diagnostic: selected.ok
        ? `No Page access token matched Page ${pageId}. A token for a different Page was not used.`
        : selected.diagnostic,
    };
  }
  const owners = accounts.pages.filter((page) => page.accessToken && page.accessToken === selected.accessToken).map((page) => page.id);
  if (owners.length !== 1 || owners[0] !== pageId) {
    return {
      ok: false,
      error: "page_token_missing",
      diagnostic: `The access token returned for Page ${pageId} was not unique to that Page. No Page endpoint was called.`,
    };
  }
  if (selected.accessToken === systemToken) {
    const row = accounts.pages.find((page) => page.id === pageId && page.accessToken === systemToken);
    if (!row) {
      return {
        ok: false,
        error: "page_token_missing",
        diagnostic: `Refused to use the system user token on Page ${pageId}.`,
      };
    }
  }
  return { ok: true, accessToken: selected.accessToken };
}

function parseSubscribedApp(value: unknown, secrets: Array<string | null>): SubscribedApp | "unsafe" | null {
  const row = asRecord(value);
  const parsed = readFacebookId(row?.id);
  if (!parsed.ok) {
    const raw = asString(row?.id);
    if (raw && raw.length >= 20) return "unsafe";
    return null;
  }
  const name = asString(row?.name);
  const fields = Array.isArray(row?.subscribed_fields)
    ? row.subscribed_fields.filter((item): item is string => typeof item === "string" && /^[a-z0-9_]{1,64}$/.test(item)).slice(0, 40)
    : [];
  const app: SubscribedApp = {
    appId: parsed.value,
    appName: name ? redactMetaSecretText(name, secrets).slice(0, 120) : null,
    subscribedFields: fields,
  };
  if (containsSecret(app, secrets)) return "unsafe";
  return app;
}

async function listSubscribedApps(input: {
  pageId: string;
  pageToken: string;
  settings: MetaLeadgenSubscriptionSettings;
  fetchImpl: FetchLike;
  secrets: Array<string | null>;
}): Promise<SubscriptionList> {
  const apps: SubscribedApp[] = [];
  let after: string | null = null;
  let httpStatus = 0;
  for (let page = 0; page < SUBSCRIPTION_PAGE_CAP; page += 1) {
    const params = new URLSearchParams({ fields: "id,name,subscribed_fields", limit: "50" });
    if (after) params.set("after", after);
    const result = await graphRequest({
      method: "GET",
      path: `${input.pageId}/subscribed_apps`,
      token: input.pageToken,
      appSecret: input.settings.appSecret,
      version: input.settings.graphApiVersion,
      params,
      fetchImpl: input.fetchImpl,
      secrets: input.secrets,
      proof: true,
    });
    httpStatus = result.status;
    if (!result.ok) {
      return {
        ok: false,
        apps,
        truncated: false,
        rateLimited: result.rateLimited,
        permissionDenied: result.permissionDenied,
        graphCode: result.graphCode,
        httpStatus,
        diagnostic: result.diagnostic,
      };
    }
    const record = asRecord(result.body);
    const batch = Array.isArray(record?.data) ? record.data : [];
    for (const item of batch) {
      const parsed = parseSubscribedApp(item, input.secrets);
      if (parsed === "unsafe") {
        return {
          ok: false,
          apps: [],
          truncated: false,
          rateLimited: false,
          permissionDenied: false,
          graphCode: null,
          httpStatus,
          diagnostic: "A subscribed-app row was withheld because it contained credential material.",
        };
      }
      if (parsed) apps.push(parsed);
    }
    const nextAfter = asString(asRecord(asRecord(record?.paging)?.cursors)?.after);
    const hasNext = Boolean(asRecord(record?.paging)?.next);
    if (!hasNext || !nextAfter || nextAfter === after) {
      return {
        ok: true,
        apps,
        truncated: false,
        rateLimited: false,
        permissionDenied: false,
        graphCode: null,
        httpStatus,
        diagnostic: null,
      };
    }
    after = nextAfter;
  }
  return {
    ok: false,
    apps,
    truncated: true,
    rateLimited: false,
    permissionDenied: false,
    graphCode: null,
    httpStatus,
    diagnostic: `Stopped pagination for ${input.pageId}/subscribed_apps before the list finished. Subscription status was not inferred.`,
  };
}

function statusFromList(grant: NormalizedGrant, list: SubscriptionList, appId: string): PageSubscriptionStatus {
  if (!list.ok || list.truncated) {
    const error = list.rateLimited ? "rate_limited" : list.permissionDenied ? "missing_permission" : "graph_error";
    return unknownPage(grant, error, list.diagnostic, list.graphCode, list.httpStatus || null);
  }
  const ours = list.apps.find((app) => app.appId === appId) ?? null;
  const fields = ours?.subscribedFields ?? [];
  return {
    pageId: grant.pageId,
    pageName: grant.pageName,
    captureEnabled: grant.captureEnabled,
    subscriptionKnown: true,
    sa360LeadgenSubscribed: fields.includes("leadgen"),
    sa360SubscribedFields: fields,
    otherApps: list.apps
      .filter((app) => app.appId !== appId)
      .map((app) => ({ appId: app.appId, appName: app.appName, subscribedFields: app.subscribedFields })),
    error: null,
    diagnostic: null,
    graphCode: null,
    httpStatus: list.httpStatus,
  };
}

function unknownPage(
  grant: NormalizedGrant,
  error: Exclude<PageSubscriptionStatus["error"], null>,
  diagnostic: string | null,
  graphCode: string | null,
  httpStatus: number | null
): PageSubscriptionStatus {
  return {
    pageId: grant.pageId,
    pageName: grant.pageName,
    captureEnabled: grant.captureEnabled,
    subscriptionKnown: false,
    sa360LeadgenSubscribed: null,
    sa360SubscribedFields: [],
    otherApps: [],
    error,
    diagnostic,
    graphCode,
    httpStatus,
  };
}

function otherAppsUnchanged(before: SubscribedApp[], after: SubscribedApp[], appId: string): boolean {
  const snapshot = (apps: SubscribedApp[]) =>
    apps
      .filter((app) => app.appId !== appId)
      .map((app) => ({ appId: app.appId, fields: [...app.subscribedFields].sort() }))
      .sort((left, right) => left.appId.localeCompare(right.appId));
  const left = snapshot(before);
  const right = snapshot(after);
  if (left.length !== right.length) return false;
  return left.every(
    (app, index) => app.appId === right[index]?.appId && sameSet(app.fields, right[index]?.fields ?? [])
  );
}

async function openAccounts(input: {
  prepared: PreparedCredential;
  settings: MetaLeadgenSubscriptionSettings;
  fetchImpl: FetchLike;
}): Promise<{ ok: true; accounts: SystemUserAccountsList } | { ok: false; failure: LeadgenSubscriptionFailure }> {
  const verified = await assertLiveApp(input);
  if (!verified.ok) return verified;
  const accounts = await listSystemUserPageAccounts({
    systemUserToken: input.prepared.accessToken,
    appSecret: input.settings.appSecret,
    graphApiVersion: input.settings.graphApiVersion,
    fetchImpl: input.fetchImpl,
  });
  for (const page of accounts.pages) input.prepared.secrets.push(page.accessToken);
  const credentialId = input.prepared.record.id;
  if (accounts.permissionDenied && !accounts.ok) {
    return {
      ok: false,
      failure: fail("missing_permission", 403, "Meta refused /me/accounts. Page subscriptions were not read with the system user token.", {
        credentialId,
        diagnostic: accounts.diagnostic,
      }),
    };
  }
  if ((accounts.rateLimited || accounts.retryable) && !accounts.ok) {
    return {
      ok: false,
      failure: fail(
        accounts.rateLimited ? "rate_limited" : "graph_error",
        accounts.rateLimited ? 429 : 502,
        "Meta /me/accounts did not finish. Page subscriptions were not read.",
        { credentialId, diagnostic: accounts.diagnostic }
      ),
    };
  }
  if (!accounts.ok) {
    return {
      ok: false,
      failure: fail("graph_error", accounts.httpStatus >= 400 && accounts.httpStatus < 500 ? accounts.httpStatus : 502, "Meta /me/accounts failed. Page subscriptions were not read.", {
        credentialId,
        diagnostic: accounts.diagnostic,
      }),
    };
  }
  return { ok: true, accounts };
}

export async function readMetaLeadgenSubscriptions(
  credentialId: string,
  deps: MetaLeadgenSubscriptionDeps = {}
): Promise<LeadgenSubscriptionRead | LeadgenSubscriptionFailure> {
  const settings = deps.settings ?? readMetaLeadgenSubscriptionSettings();
  const preparedResult = await prepareCredential(credentialId, deps, settings);
  if (!preparedResult.ok) {
    logSubscription(deps, "warn", "meta_leadgen_subscription.refused", {
      credentialId,
      pageId: null,
      action: "read",
      result: preparedResult.failure.error,
      diagnostic: preparedResult.failure.diagnostic,
    }, []);
    return preparedResult.failure;
  }
  const { prepared, grants } = preparedResult;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const opened = await openAccounts({ prepared, settings, fetchImpl });
  if (!opened.ok) {
    logSubscription(deps, "warn", "meta_leadgen_subscription.refused", {
      credentialId: prepared.record.id,
      pageId: null,
      action: "read",
      result: opened.failure.error,
      diagnostic: opened.failure.diagnostic,
      graphCode: null,
    }, prepared.secrets);
    return finalize(opened.failure, prepared.secrets);
  }
  const pages: PageSubscriptionStatus[] = [];
  let stopForRateLimit = false;
  for (const grant of grants) {
    if (stopForRateLimit) {
      const status = unknownPage(
        grant,
        "not_checked",
        "This Page was not checked because an earlier Page hit a Meta rate limit. Another Page's token was not used.",
        opened.accounts.graphCode,
        null
      );
      pages.push(status);
      logSubscription(deps, "warn", "meta_leadgen_subscription.page", pageLog(prepared.record.id, "read", status), prepared.secrets);
      continue;
    }
    if (!grant.valid) {
      const status = unknownPage(grant, "invalid_page_id", "The stored Page grant id is not a numeric Facebook Page id.", null, null);
      pages.push(status);
      logSubscription(deps, "warn", "meta_leadgen_subscription.page", pageLog(prepared.record.id, "read", status), prepared.secrets);
      continue;
    }
    const token = pageTokenError(opened.accounts, grant.pageId, prepared.accessToken);
    if (!token.ok) {
      const status = unknownPage(grant, token.error, token.diagnostic, opened.accounts.graphCode, opened.accounts.httpStatus || null);
      pages.push(status);
      logSubscription(deps, "warn", "meta_leadgen_subscription.page", pageLog(prepared.record.id, "read", status), prepared.secrets);
      continue;
    }
    const list = await listSubscribedApps({
      pageId: grant.pageId,
      pageToken: token.accessToken,
      settings,
      fetchImpl,
      secrets: prepared.secrets,
    });
    const status = statusFromList(grant, list, prepared.appId);
    pages.push(status);
    if (list.rateLimited) stopForRateLimit = true;
    logSubscription(
      deps,
      status.subscriptionKnown ? "info" : "warn",
      "meta_leadgen_subscription.page",
      pageLog(prepared.record.id, "read", status),
      prepared.secrets
    );
  }
  return finalize(
    {
      ok: true as const,
      credentialId: prepared.record.id,
      credentialKind: "system_user" as const,
      appId: prepared.appId,
      appIdVerified: true as const,
      tokenFingerprint: prepared.record.tokenFingerprint,
      writesEnabled: settings.writesEnabled,
      productionSafe: isMetaLeadgenSubscriptionProductionSafe(settings),
      captureGrantMutated: false as const,
      partial: pages.some((page) => !page.subscriptionKnown),
      pages,
    },
    prepared.secrets
  );
}

function pageLog(credentialId: string, action: string, status: PageSubscriptionStatus): Record<string, unknown> {
  return {
    credentialId,
    pageId: status.pageId,
    action,
    result: status.error ?? (status.sa360LeadgenSubscribed ? "leadgen_subscribed" : "leadgen_absent"),
    diagnostic: status.diagnostic,
    graphCode: status.graphCode,
    httpStatus: status.httpStatus,
    captureEnabled: status.captureEnabled,
  };
}

async function postLeadgen(input: {
  pageId: string;
  pageToken: string;
  fields: string[];
  settings: MetaLeadgenSubscriptionSettings;
  fetchImpl: FetchLike;
  secrets: Array<string | null>;
}): Promise<GraphHttp> {
  const result = await graphRequest({
    method: "POST",
    path: `${input.pageId}/subscribed_apps`,
    token: input.pageToken,
    appSecret: input.settings.appSecret,
    version: input.settings.graphApiVersion,
    params: new URLSearchParams({ subscribed_fields: input.fields.join(",") }),
    fetchImpl: input.fetchImpl,
    secrets: input.secrets,
    proof: true,
  });
  const success = asRecord(result.body)?.success;
  if (result.ok && success === false) {
    return {
      ...result,
      ok: false,
      diagnostic: redactMetaSecretText(
        `Meta Graph ${input.pageId}/subscribed_apps returned success=false.`,
        input.secrets
      ),
    };
  }
  return result;
}

export async function subscribeMetaLeadgenPage(
  input: { credentialId: string; pageId: string; confirmationText: string },
  deps: MetaLeadgenSubscriptionDeps = {}
): Promise<LeadgenSubscriptionWrite | LeadgenSubscriptionFailure> {
  const settings = deps.settings ?? readMetaLeadgenSubscriptionSettings();
  const page = readFacebookId(input.pageId);
  if (!page.ok) {
    return fail("invalid_page_id", 400, "Page ID must be a numeric Facebook Page id.", { credentialId: input.credentialId });
  }
  const pageId = page.value;
  if (input.confirmationText.trim() !== metaLeadgenSubscriptionConfirmation(pageId)) {
    logSubscription(deps, "warn", "meta_leadgen_subscription.refused", {
      credentialId: input.credentialId,
      pageId,
      action: "subscribe",
      result: "confirmation_required",
      diagnostic: null,
    }, []);
    return fail(
      "confirmation_required",
      400,
      `Type "${metaLeadgenSubscriptionConfirmation(pageId)}" exactly to subscribe this Page.`,
      { credentialId: input.credentialId, pageId }
    );
  }
  if (!settings.writesEnabled) {
    logSubscription(deps, "warn", "meta_leadgen_subscription.refused", {
      credentialId: input.credentialId,
      pageId,
      action: "subscribe",
      result: "writes_disabled",
      diagnostic: null,
    }, []);
    return fail(
      "writes_disabled",
      409,
      "Leadgen subscription writes are disabled. Set SA360_META_LEADGEN_SUBSCRIPTION_WRITES_ENABLED=true for an approved Page, then turn it off again.",
      { credentialId: input.credentialId, pageId }
    );
  }
  if (!isMetaLeadgenSubscriptionProductionSafe(settings)) {
    logSubscription(deps, "warn", "meta_leadgen_subscription.refused", {
      credentialId: input.credentialId,
      pageId,
      action: "subscribe",
      result: "production_unsafe",
      diagnostic: null,
    }, []);
    return fail(
      "production_unsafe",
      409,
      "Subscription writes require SA360_META_LEAD_ADS_INTAKE_ENABLED, SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED, SA360_META_LEAD_ADS_ROUTING_ENABLED, and FACEBOOK_DIRECT_INTAKE_ENABLED to stay disabled.",
      { credentialId: input.credentialId, pageId }
    );
  }
  const preparedResult = await prepareCredential(input.credentialId, deps, settings);
  if (!preparedResult.ok) {
    logSubscription(deps, "warn", "meta_leadgen_subscription.refused", {
      credentialId: input.credentialId,
      pageId,
      action: "subscribe",
      result: preparedResult.failure.error,
      diagnostic: preparedResult.failure.diagnostic,
    }, []);
    return { ...preparedResult.failure, pageId };
  }
  const { prepared, grants } = preparedResult;
  const grant = grants.find((item) => item.valid && item.pageId === pageId);
  if (!grant) {
    const failure = fail(
      "page_not_granted",
      404,
      `Page ${pageId} has no capture grant on this credential. Another credential was not used.`,
      { credentialId: prepared.record.id, pageId }
    );
    logSubscription(deps, "warn", "meta_leadgen_subscription.refused", {
      credentialId: prepared.record.id,
      pageId,
      action: "subscribe",
      result: "page_not_granted",
      diagnostic: failure.diagnostic,
    }, prepared.secrets);
    return finalize(failure, prepared.secrets);
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const opened = await openAccounts({ prepared, settings, fetchImpl });
  if (!opened.ok) {
    logSubscription(deps, "warn", "meta_leadgen_subscription.refused", {
      credentialId: prepared.record.id,
      pageId,
      action: "subscribe",
      result: opened.failure.error,
      diagnostic: opened.failure.diagnostic,
    }, prepared.secrets);
    return finalize({ ...opened.failure, pageId }, prepared.secrets);
  }
  const token = pageTokenError(opened.accounts, pageId, prepared.accessToken);
  if (!token.ok) {
    const failure = fail(token.error === "not_checked" ? "graph_error" : "page_token_missing", token.error === "not_checked" ? 502 : 409, token.diagnostic, {
      credentialId: prepared.record.id,
      pageId,
      diagnostic: token.diagnostic,
    });
    logSubscription(deps, "warn", "meta_leadgen_subscription.page", {
      credentialId: prepared.record.id,
      pageId,
      action: "subscribe",
      result: failure.error,
      diagnostic: token.diagnostic,
    }, prepared.secrets);
    return finalize(failure, prepared.secrets);
  }
  const before = await listSubscribedApps({
    pageId,
    pageToken: token.accessToken,
    settings,
    fetchImpl,
    secrets: prepared.secrets,
  });
  if (!before.ok) {
    const error = before.rateLimited ? "rate_limited" : before.permissionDenied ? "missing_permission" : "graph_error";
    const failure = fail(
      error,
      before.rateLimited ? 429 : before.permissionDenied ? 403 : 502,
      before.diagnostic ?? "The current subscription list could not be read. No subscription POST was sent.",
      { credentialId: prepared.record.id, pageId, diagnostic: before.diagnostic }
    );
    logSubscription(deps, "warn", "meta_leadgen_subscription.page", {
      credentialId: prepared.record.id,
      pageId,
      action: "subscribe",
      result: error,
      diagnostic: before.diagnostic,
      graphCode: before.graphCode,
      httpStatus: before.httpStatus,
    }, prepared.secrets);
    return finalize(failure, prepared.secrets);
  }
  const ours = before.apps.find((app) => app.appId === prepared.appId) ?? null;
  const existingFields = ours?.subscribedFields ?? [];
  if (existingFields.includes("leadgen")) {
    const result: LeadgenSubscriptionWrite = {
      ok: true,
      credentialId: prepared.record.id,
      pageId,
      pageName: grant.pageName,
      captureEnabled: grant.captureEnabled,
      captureGrantMutated: false,
      action: "already_subscribed",
      postSent: false,
      verifiedByGet: true,
      subscribedFieldsSent: null,
      sa360SubscribedFields: existingFields,
      preservedFields: existingFields.filter((field) => field !== "leadgen"),
      otherAppsUnchanged: true,
      otherApps: before.apps
        .filter((app) => app.appId !== prepared.appId)
        .map((app) => ({ appId: app.appId, appName: app.appName, subscribedFields: app.subscribedFields })),
      diagnostic: "The SA360 app already has leadgen on this Page. No subscription POST was sent.",
    };
    logSubscription(deps, "info", "meta_leadgen_subscription.page", {
      credentialId: prepared.record.id,
      pageId,
      action: "subscribe",
      result: "already_subscribed",
      diagnostic: result.diagnostic,
      postSent: false,
    }, prepared.secrets);
    return finalize(result, prepared.secrets);
  }
  const fields = fieldsForSubscribe(existingFields);
  const posted = await postLeadgen({
    pageId,
    pageToken: token.accessToken,
    fields,
    settings,
    fetchImpl,
    secrets: prepared.secrets,
  });
  if (!posted.ok) {
    const error = posted.rateLimited ? "rate_limited" : posted.permissionDenied ? "missing_permission" : "graph_error";
    const sent = posted.status !== 0;
    const failure = fail(error, posted.rateLimited ? 429 : posted.permissionDenied ? 403 : 502, posted.diagnostic ?? "The subscription POST failed. Success was not reported.", {
      credentialId: prepared.record.id,
      pageId,
      diagnostic: posted.diagnostic,
      postSent: sent,
    });
    logSubscription(deps, "warn", "meta_leadgen_subscription.page", {
      credentialId: prepared.record.id,
      pageId,
      action: "subscribe",
      result: error,
      diagnostic: posted.diagnostic,
      postSent: sent,
      graphCode: posted.graphCode,
      httpStatus: posted.status,
    }, prepared.secrets);
    return finalize(failure, prepared.secrets);
  }
  const after = await listSubscribedApps({
    pageId,
    pageToken: token.accessToken,
    settings,
    fetchImpl,
    secrets: prepared.secrets,
  });
  const afterOurs = after.ok ? after.apps.find((app) => app.appId === prepared.appId) ?? null : null;
  const afterFields = afterOurs?.subscribedFields ?? [];
  const preserved = existingFields.filter((field) => field !== "leadgen");
  const fieldsKept = preserved.every((field) => afterFields.includes(field)) && afterFields.includes("leadgen");
  const othersKept = after.ok && otherAppsUnchanged(before.apps, after.apps, prepared.appId);
  if (!after.ok || !fieldsKept || !othersKept) {
    const error = !after.ok
      ? after.rateLimited
        ? "rate_limited"
        : after.permissionDenied
          ? "missing_permission"
          : "graph_error"
      : "verification_failed";
    const failure = fail(
      error,
      after.rateLimited ? 429 : after.permissionDenied ? 403 : 502,
      after.ok
        ? "The subscription POST completed, and the fresh Graph GET did not confirm the SA360 leadgen field with the previous SA360 fields and the other apps unchanged."
        : "The subscription POST completed, and the fresh Graph GET did not succeed. Success was not reported from the POST.",
      {
        credentialId: prepared.record.id,
        pageId,
        diagnostic: after.diagnostic,
        postSent: true,
        sa360SubscribedFields: afterFields,
        ...(after.ok ? { otherAppsUnchanged: othersKept } : {}),
      }
    );
    logSubscription(deps, "warn", "meta_leadgen_subscription.page", {
      credentialId: prepared.record.id,
      pageId,
      action: "subscribe",
      result: error,
      diagnostic: failure.message,
      postSent: true,
      verifiedByGet: false,
    }, prepared.secrets);
    return finalize(failure, prepared.secrets);
  }
  const result: LeadgenSubscriptionWrite = {
    ok: true,
    credentialId: prepared.record.id,
    pageId,
    pageName: grant.pageName,
    captureEnabled: grant.captureEnabled,
    captureGrantMutated: false,
    action: "subscribed",
    postSent: true,
    verifiedByGet: true,
    subscribedFieldsSent: fields,
    sa360SubscribedFields: afterFields,
    preservedFields: preserved,
    otherAppsUnchanged: true,
    otherApps: after.apps
      .filter((app) => app.appId !== prepared.appId)
      .map((app) => ({ appId: app.appId, appName: app.appName, subscribedFields: app.subscribedFields })),
    diagnostic: null,
  };
  logSubscription(deps, "info", "meta_leadgen_subscription.page", {
    credentialId: prepared.record.id,
    pageId,
    action: "subscribe",
    result: "verified",
    diagnostic: null,
    postSent: true,
    subscribedFieldsSent: fields,
  }, prepared.secrets);
  return finalize(result, prepared.secrets);
}
