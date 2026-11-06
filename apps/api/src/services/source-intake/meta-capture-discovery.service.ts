import { createHmac } from "node:crypto";

import { DEFAULT_GRAPH_API_VERSION } from "../../lib/meta-webhook.js";
import { redactMetaSecretText } from "../../lib/meta-token-encryption.js";
import { readFacebookId } from "./facebook-form-association.js";

/**
 * Read-only Graph inventory for one stored credential.
 * Never requests lead field data. Never writes clients or associations.
 * Callers must keep this behind SA360_META_CAPTURE_INVENTORY_ENABLED.
 */

const RATE_LIMIT_CODES = new Set(["4", "17", "32", "613", "80000", "80001", "80002", "80003", "80004", "80005", "80006", "80008", "80009", "80014"]);
const PERMISSION_CODES = new Set(["10", "200", "190"]);
const MAX_PAGES = 8;
const PAGE_LIMIT = 50;

export type MetaDiscoverySection<T> = {
  items: T[];
  truncated: boolean;
  rateLimited: boolean;
  permissionDenied: boolean;
  diagnostic: string | null;
};

export type MetaDiscoveredPage = {
  id: string;
  name: string | null;
  tasks: string[];
};

export type MetaDiscoveredForm = {
  pageId: string;
  id: string;
  name: string | null;
  status: string | null;
};

export type MetaDiscoveredAdAccount = {
  id: string;
  name: string | null;
  accountId: string | null;
  businessId: string | null;
  businessName: string | null;
};

export type MetaDiscoveredCampaign = {
  adAccountId: string;
  id: string;
  name: string | null;
  objective: string | null;
  effectiveStatus: string | null;
};

export type MetaDiscoveredSubscription = {
  pageId: string;
  appId: string | null;
  appName: string | null;
  subscribedFields: string[];
  leadgenSubscribed: boolean;
};

export type MetaTokenDiagnostic = {
  checked: boolean;
  isValid: boolean | null;
  expiresAt: string | null;
  scopes: string[];
  type: string | null;
  appId: string | null;
  appIdMatches: boolean | null;
  diagnostic: string | null;
};

export type MetaCaptureDiscovery = {
  credentialId: string;
  graphApiVersion: string;
  token: MetaTokenDiagnostic;
  pages: MetaDiscoverySection<MetaDiscoveredPage>;
  forms: MetaDiscoverySection<MetaDiscoveredForm>;
  adAccounts: MetaDiscoverySection<MetaDiscoveredAdAccount>;
  campaigns: MetaDiscoverySection<MetaDiscoveredCampaign>;
  subscriptions: MetaDiscoverySection<MetaDiscoveredSubscription>;
};

type FetchLike = typeof fetch;

type GraphPage = {
  data: unknown[];
  after: string | null;
  rateLimited: boolean;
  permissionDenied: boolean;
  diagnostic: string | null;
  httpStatus: number;
};

function emptySection<T>(): MetaDiscoverySection<T> {
  return { items: [], truncated: false, rateLimited: false, permissionDenied: false, diagnostic: null };
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

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 40) : [];
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

async function graphGet(input: {
  path: string;
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
  const url = `https://graph.facebook.com/${input.version}/${input.path}${query ? `?${query}` : ""}`;
  try {
    const response = await input.fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${input.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json().catch(() => null)) as unknown;
    return { status: response.status, body };
  } catch {
    return { status: 0, body: { error: { message: "Meta Graph request could not be completed.", type: "network_error" } } };
  }
}

async function collectPages(input: {
  path: string;
  token: string;
  appSecret: string | null;
  version: string;
  fields: string;
  fetchImpl: FetchLike;
  secrets: Array<string | null>;
}): Promise<GraphPage> {
  const data: unknown[] = [];
  let after: string | null = null;
  let rateLimited = false;
  let permissionDenied = false;
  let diagnostic: string | null = null;
  let httpStatus = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ fields: input.fields, limit: String(PAGE_LIMIT) });
    if (after) params.set("after", after);
    const result = await graphGet({
      path: input.path,
      token: input.token,
      appSecret: input.appSecret,
      version: input.version,
      params,
      fetchImpl: input.fetchImpl,
    });
    httpStatus = result.status;
    const error = graphError(result.body);
    if (error.code && RATE_LIMIT_CODES.has(error.code)) {
      rateLimited = true;
      diagnostic = redactMetaSecretText(
        `Meta rate-limited ${input.path} (code ${error.code}). Partial results were kept.`,
        input.secrets
      );
      break;
    }
    if (error.code && (PERMISSION_CODES.has(error.code) || (result.status === 400 && Number(error.code) >= 200 && Number(error.code) <= 299))) {
      permissionDenied = true;
      diagnostic = redactMetaSecretText(
        `Meta refused ${input.path} (code ${error.code}). ${error.message ?? "Missing permission."}`,
        input.secrets
      );
      break;
    }
    if (!result.status || result.status >= 400) {
      diagnostic = redactMetaSecretText(
        `Meta Graph ${input.path} failed (status ${result.status}${error.code ? `, code ${error.code}` : ""}).`,
        input.secrets
      );
      break;
    }
    const record = asRecord(result.body);
    const batch = Array.isArray(record?.data) ? record.data : [];
    data.push(...batch);
    const nextAfter = asString(asRecord(asRecord(record?.paging)?.cursors)?.after);
    const hasNext = Boolean(asRecord(record?.paging)?.next);
    if (!hasNext || !nextAfter || nextAfter === after) {
      return { data, after: null, rateLimited, permissionDenied, diagnostic, httpStatus };
    }
    after = nextAfter;
  }
  return {
    data,
    after,
    rateLimited,
    permissionDenied,
    diagnostic:
      diagnostic ??
      (after ? redactMetaSecretText(`Stopped pagination for ${input.path} at the page cap.`, input.secrets) : null),
    httpStatus,
  };
}

function sectionFrom<T>(page: GraphPage, mapItem: (value: unknown) => T | null): MetaDiscoverySection<T> {
  return {
    items: page.data.map(mapItem).filter((item): item is T => item !== null),
    truncated: page.after !== null,
    rateLimited: page.rateLimited,
    permissionDenied: page.permissionDenied,
    diagnostic: page.diagnostic,
  };
}

export async function discoverMetaAuthorizedAssets(input: {
  credentialId: string;
  accessToken: string;
  appSecret: string | null;
  appId: string | null;
  graphApiVersion?: string;
  pageIds: string[];
  fetchImpl?: FetchLike;
}): Promise<MetaCaptureDiscovery> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const version = input.graphApiVersion ?? DEFAULT_GRAPH_API_VERSION;
  const secrets = [input.accessToken, input.appSecret];
  const token = await diagnoseToken(input, version, fetchImpl, secrets);
  const pages = await discoverPages(input, version, fetchImpl, secrets);
  const pageIds = [
    ...new Set([
      ...input.pageIds.filter((id) => readFacebookId(id).ok),
      ...pages.items.map((page) => page.id),
    ]),
  ].slice(0, 25);
  const forms = emptySection<MetaDiscoveredForm>();
  const subscriptions = emptySection<MetaDiscoveredSubscription>();
  for (const pageId of pageIds) {
    if (forms.rateLimited || subscriptions.rateLimited) break;
    const formPage = await collectPages({
      path: `${pageId}/leadgen_forms`,
      token: input.accessToken,
      appSecret: input.appSecret,
      version,
      fields: "id,name,status",
      fetchImpl,
      secrets,
    });
    const formSection = sectionFrom(formPage, (value) => {
      const row = asRecord(value);
      const id = asString(row?.id);
      const parsed = id ? readFacebookId(id) : null;
      if (!parsed?.ok) return null;
      return { pageId, id: parsed.value, name: asString(row?.name), status: asString(row?.status) };
    });
    forms.items.push(...formSection.items);
    forms.truncated = forms.truncated || formSection.truncated;
    forms.rateLimited = forms.rateLimited || formSection.rateLimited;
    forms.permissionDenied = forms.permissionDenied || formSection.permissionDenied;
    forms.diagnostic = forms.diagnostic ?? formSection.diagnostic;
    if (formSection.rateLimited) break;
    const subscriptionPage = await collectPages({
      path: `${pageId}/subscribed_apps`,
      token: input.accessToken,
      appSecret: input.appSecret,
      version,
      fields: "id,name,subscribed_fields",
      fetchImpl,
      secrets,
    });
    const subscriptionSection = sectionFrom(subscriptionPage, (value) => {
      const row = asRecord(value);
      const fields = stringList(row?.subscribed_fields);
      return {
        pageId,
        appId: asString(row?.id),
        appName: asString(row?.name),
        subscribedFields: fields,
        leadgenSubscribed: fields.includes("leadgen"),
      };
    });
    subscriptions.items.push(...subscriptionSection.items);
    subscriptions.truncated = subscriptions.truncated || subscriptionSection.truncated;
    subscriptions.rateLimited = subscriptions.rateLimited || subscriptionSection.rateLimited;
    subscriptions.permissionDenied = subscriptions.permissionDenied || subscriptionSection.permissionDenied;
    subscriptions.diagnostic = subscriptions.diagnostic ?? subscriptionSection.diagnostic;
  }
  const adAccounts = await discoverAdAccounts(input, version, fetchImpl, secrets, forms.rateLimited);
  const campaigns = emptySection<MetaDiscoveredCampaign>();
  if (!adAccounts.rateLimited && !forms.rateLimited) {
    for (const account of adAccounts.items.slice(0, 10)) {
      const campaignPage = await collectPages({
        path: `act_${account.accountId ?? account.id}/campaigns`,
        token: input.accessToken,
        appSecret: input.appSecret,
        version,
        fields: "id,name,objective,effective_status",
        fetchImpl,
        secrets,
      });
      const campaignSection = sectionFrom(campaignPage, (value) => {
        const row = asRecord(value);
        const id = asString(row?.id);
        if (!id) return null;
        return {
          adAccountId: account.accountId ?? account.id,
          id,
          name: asString(row?.name),
          objective: asString(row?.objective),
          effectiveStatus: asString(row?.effective_status),
        };
      });
      campaigns.items.push(...campaignSection.items);
      campaigns.truncated = campaigns.truncated || campaignSection.truncated;
      campaigns.rateLimited = campaigns.rateLimited || campaignSection.rateLimited;
      campaigns.permissionDenied = campaigns.permissionDenied || campaignSection.permissionDenied;
      campaigns.diagnostic = campaigns.diagnostic ?? campaignSection.diagnostic;
      if (campaignSection.rateLimited) break;
    }
  }
  return {
    credentialId: input.credentialId,
    graphApiVersion: version,
    token,
    pages,
    forms,
    adAccounts,
    campaigns,
    subscriptions,
  };
}

async function diagnoseToken(
  input: { accessToken: string; appSecret: string | null; appId: string | null },
  version: string,
  fetchImpl: FetchLike,
  secrets: Array<string | null | undefined>
): Promise<MetaTokenDiagnostic> {
  if (!input.appId || !input.appSecret) {
    return {
      checked: false,
      isValid: null,
      expiresAt: null,
      scopes: [],
      type: null,
      appId: null,
      appIdMatches: null,
      diagnostic: "debug_token was skipped because the credential app id or META_APP_SECRET is not set.",
    };
  }
  const appToken = `${input.appId}|${input.appSecret}`;
  const result = await graphGet({
    path: "debug_token",
    token: appToken,
    appSecret: null,
    version,
    params: new URLSearchParams({ input_token: input.accessToken }),
    fetchImpl,
  });
  const data = asRecord(asRecord(result.body)?.data);
  const error = graphError(result.body);
  if (!data) {
    return {
      checked: true,
      isValid: null,
      expiresAt: null,
      scopes: [],
      type: null,
      appId: null,
      appIdMatches: null,
      diagnostic: redactMetaSecretText(
        `debug_token failed (status ${result.status}${error.code ? `, code ${error.code}` : ""}).`,
        [...secrets, appToken]
      ),
    };
  }
  const expires = data.expires_at;
  const expiresAt =
    typeof expires === "number" && expires > 0 ? new Date(expires * 1000).toISOString() : null;
  const appId = asString(data.app_id);
  return {
    checked: true,
    isValid: data.is_valid === true,
    expiresAt,
    scopes: stringList(data.scopes),
    type: asString(data.type),
    appId,
    appIdMatches: appId ? appId === input.appId : null,
    diagnostic: data.is_valid === true ? null : "debug_token reported the credential is not valid.",
  };
}

async function discoverPages(
  input: { accessToken: string; appSecret: string | null; pageIds: string[] },
  version: string,
  fetchImpl: FetchLike,
  secrets: Array<string | null>
): Promise<MetaDiscoverySection<MetaDiscoveredPage>> {
  const listed = await collectPages({
    path: "me/accounts",
    token: input.accessToken,
    appSecret: input.appSecret,
    version,
    fields: "id,name,tasks",
    fetchImpl,
    secrets,
  });
  const section = sectionFrom(listed, (value) => {
    const row = asRecord(value);
    const id = asString(row?.id);
    const parsed = id ? readFacebookId(id) : null;
    if (!parsed?.ok) return null;
    return { id: parsed.value, name: asString(row?.name), tasks: stringList(row?.tasks) };
  });
  if (section.items.length > 0 || section.permissionDenied || section.rateLimited) return section;
  for (const pageId of input.pageIds) {
    const parsed = readFacebookId(pageId);
    if (!parsed.ok) continue;
    const one = await graphGet({
      path: parsed.value,
      token: input.accessToken,
      appSecret: input.appSecret,
      version,
      params: new URLSearchParams({ fields: "id,name" }),
      fetchImpl,
    });
    const row = asRecord(one.body);
    const id = asString(row?.id);
    const idParsed = id ? readFacebookId(id) : null;
    if (idParsed?.ok) {
      section.items.push({ id: idParsed.value, name: asString(row?.name), tasks: [] });
    }
  }
  return section;
}

async function discoverAdAccounts(
  input: { accessToken: string; appSecret: string | null },
  version: string,
  fetchImpl: FetchLike,
  secrets: Array<string | null>,
  alreadyLimited: boolean
): Promise<MetaDiscoverySection<MetaDiscoveredAdAccount>> {
  if (alreadyLimited) {
    return {
      items: [],
      truncated: false,
      rateLimited: true,
      permissionDenied: false,
      diagnostic: "Ad account discovery was skipped because an earlier call was rate-limited.",
    };
  }
  const listed = await collectPages({
    path: "me/adaccounts",
    token: input.accessToken,
    appSecret: input.appSecret,
    version,
    fields: "id,name,account_id,business",
    fetchImpl,
    secrets,
  });
  return sectionFrom(listed, (value) => {
    const row = asRecord(value);
    const id = asString(row?.id)?.replace(/^act_/, "") ?? null;
    if (!id) return null;
    const business = asRecord(row?.business);
    return {
      id,
      name: asString(row?.name),
      accountId: asString(row?.account_id) ?? id,
      businessId: asString(business?.id),
      businessName: asString(business?.name),
    };
  });
}

export function discoveryContainsSecret(value: unknown, secret: string): boolean {
  return JSON.stringify(value).includes(secret);
}
