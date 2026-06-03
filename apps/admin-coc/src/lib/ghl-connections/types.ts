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

export type GhlConnectionsListResponse = {
  ok: boolean;
  count: number;
  items: GhlLocationConnectionItem[];
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
};

export type GhlOAuthDebugResponse = {
  ok: boolean;
  latest: GhlOAuthDebugSnapshot | null;
  config?: GhlOAuthStartConfigDebug;
};

export type GhlConnectionProbeResponse = {
  ok: boolean;
  connection: GhlLocationConnectionItem;
  detail: string;
};
