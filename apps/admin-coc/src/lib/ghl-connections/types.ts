export type GhlLocationConnectionItem = {
  id: string;
  clientAccountId: string | null;
  locationId: string;
  locationName: string | null;
  companyId: string | null;
  userId: string | null;
  appId: string | null;
  authMode: string;
  connectionStatus: string;
  tokenExpiresAt: string;
  scopes: string[];
  lastProbeAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GhlOAuthPendingInstallItem = {
  id: string;
  clientAccountId: string | null;
  companyId: string | null;
  userId: string | null;
  userType: string | null;
  appId: string | null;
  versionId: string | null;
  status: string;
  tokenExpiresAt: string;
  scopes: string[];
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GhlConnectionsListResponse = {
  ok: boolean;
  count: number;
  items: GhlLocationConnectionItem[];
};

export type GhlOAuthPendingInstallsResponse = {
  ok: boolean;
  count: number;
  items: GhlOAuthPendingInstallItem[];
};

export type GhlOAuthStartConfigDebug = {
  hasClientId: boolean;
  hasRedirectUri: boolean;
  hasScopes: boolean;
  hasVersionId: boolean;
  authorizeUrlIncludesVersionId: boolean;
};

export type GhlOAuthStartResponse = {
  ok: boolean;
  authorizeUrl: string;
  state: string;
  config?: GhlOAuthStartConfigDebug;
};

export type GhlOAuthTokenResponseSafeShape = {
  userType: string | null;
  companyIdPresent: boolean;
  locationIdPresent: boolean;
  userIdPresent: boolean;
  scopePresent: boolean;
  tokenTypePresent: boolean;
  expiresInPresent: boolean;
  appIdPresent: boolean;
};

export type GhlOAuthDebugSnapshot = {
  at: string;
  requestId: string;
  hasCode: boolean;
  hasState: boolean;
  stateValid: boolean | null;
  tokenExchangeStatusCode: number | null;
  tokenExchangeError: string | null;
  databaseWriteOk: boolean | null;
  redirectTarget: string;
  outcome: string;
  tokenResponseShape: GhlOAuthTokenResponseSafeShape | null;
  tokenLevel: "location" | "company_or_agency" | "unknown" | null;
  pendingInstallId: string | null;
};

export type GhlMarketplaceWebhookSafeSnapshot = {
  at: string;
  eventType: string | null;
  appIdPresent: boolean;
  versionIdPresent: boolean;
  installTypePresent: boolean;
  locationIdPresent: boolean;
  companyIdPresent: boolean;
  userIdPresent: boolean;
  timestampPresent: boolean;
  webhookIdPresent: boolean;
  handled: boolean;
  reconcileNote: string | null;
};

export type GhlOAuthDebugResponse = {
  ok: boolean;
  latest: GhlOAuthDebugSnapshot | null;
  latestInstallWebhook: GhlMarketplaceWebhookSafeSnapshot | null;
  marketplaceWebhookUrl?: string;
  config?: GhlOAuthStartConfigDebug;
};

export type GhlConnectionProbeResponse = {
  ok: boolean;
  connection: GhlLocationConnectionItem;
  detail: string;
};
