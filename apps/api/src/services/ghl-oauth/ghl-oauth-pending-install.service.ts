import type { Prisma } from "@prisma/client";
import { encryptGhlToken } from "../../lib/ghl-token-encryption.js";
import { getGhlOAuthVersionId } from "../../lib/ghl-oauth-env.js";
import {
  createGhlOAuthPendingInstall,
  deleteGhlOAuthPendingInstall,
  findGhlOAuthPendingInstallById,
  listGhlOAuthPendingInstalls,
  updateGhlOAuthPendingInstall,
} from "../../repositories/ghl-oauth-pending-install.repository.js";
import type { GhlOAuthExchangeResult } from "./ghl-oauth-client.service.js";
import { presentGhlOAuthPendingInstall } from "./ghl-oauth-pending-install.present.js";

export async function persistPendingCompanyOrAgencyGhlOAuthInstall(input: {
  tokens: GhlOAuthExchangeResult;
  clientAccountId?: string | null;
}) {
  const { tokens } = input;
  const data: Prisma.GhlOAuthPendingInstallCreateInput = {
    clientAccountId: input.clientAccountId?.trim() || null,
    companyId: tokens.companyId,
    userId: tokens.userId,
    userType: tokens.userType,
    appId: tokens.appId,
    versionId: getGhlOAuthVersionId() ?? null,
    accessTokenEncrypted: encryptGhlToken(tokens.accessToken),
    refreshTokenEncrypted: encryptGhlToken(tokens.refreshToken),
    tokenExpiresAt: tokens.expiresAt,
    scopes: tokens.scopes.length ? (tokens.scopes as Prisma.InputJsonValue) : undefined,
    status: "pending_location",
    lastError: null,
  };
  const row = await createGhlOAuthPendingInstall(data);
  return presentGhlOAuthPendingInstall(row);
}

export async function listGhlOAuthPendingInstallsPresented(
  opts: Parameters<typeof listGhlOAuthPendingInstalls>[0]
) {
  const rows = await listGhlOAuthPendingInstalls(opts);
  return rows.map(presentGhlOAuthPendingInstall);
}

export async function revokeGhlOAuthPendingInstall(id: string) {
  const row = await findGhlOAuthPendingInstallById(id);
  if (!row) return { notFound: true as const };
  const cleared = encryptGhlToken("");
  const updated = await updateGhlOAuthPendingInstall(id, {
    status: "revoked",
    accessTokenEncrypted: cleared,
    refreshTokenEncrypted: cleared,
    tokenExpiresAt: new Date(0),
    lastError: "Disconnected by operator.",
  });
  return { pending: presentGhlOAuthPendingInstall(updated) };
}

export async function purgeGhlOAuthPendingInstall(id: string) {
  const row = await findGhlOAuthPendingInstallById(id);
  if (!row) return { notFound: true as const };
  await deleteGhlOAuthPendingInstall(id);
  return { purged: true as const };
}
