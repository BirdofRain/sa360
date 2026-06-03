import type { GhlOAuthPendingInstall } from "@prisma/client";

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

export function presentGhlOAuthPendingInstall(
  row: GhlOAuthPendingInstall
): GhlOAuthPendingInstallItem {
  const scopes = Array.isArray(row.scopes)
    ? row.scopes.filter((s): s is string => typeof s === "string")
    : [];
  return {
    id: row.id,
    clientAccountId: row.clientAccountId,
    companyId: row.companyId,
    userId: row.userId,
    userType: row.userType,
    appId: row.appId,
    versionId: row.versionId,
    status: row.status,
    tokenExpiresAt: row.tokenExpiresAt.toISOString(),
    scopes,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
