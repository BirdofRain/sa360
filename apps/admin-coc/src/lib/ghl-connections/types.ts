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

export type GhlOAuthStartResponse = {
  ok: boolean;
  authorizeUrl: string;
  state: string;
};

export type GhlConnectionProbeResponse = {
  ok: boolean;
  connection: GhlLocationConnectionItem;
  detail: string;
};
