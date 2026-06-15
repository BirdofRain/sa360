"use server";

import {
  deleteAdminGhlConnection,
  deleteAdminGhlOAuthPendingInstall,
  fetchAdminGhlConnections,
  fetchAdminGhlOAuthPendingInstalls,
  fetchAdminGhlOAuthStart,
  patchAdminGhlConnectionLinkClient,
  postAdminGhlConnectionProbe,
} from "@/lib/admin-api/server";
import type {
  GhlLocationConnectionItem,
  GhlOAuthPendingInstallItem,
} from "@/lib/ghl-connections/types";

export async function loadGhlConnectionsAction(clientAccountId?: string) {
  const res = await fetchAdminGhlConnections(clientAccountId);
  if (!res.data) return { ok: false as const, error: res.error ?? "Failed to load connections." };
  return { ok: true as const, items: res.data.items };
}

export async function startGhlOAuthConnectAction(clientAccountId?: string, returnTo?: string) {
  const res = await fetchAdminGhlOAuthStart(clientAccountId, returnTo);
  if (!res.data?.authorizeUrl) {
    return { ok: false as const, error: res.error ?? "Could not start GHL OAuth." };
  }
  return { ok: true as const, authorizeUrl: res.data.authorizeUrl };
}

export async function probeGhlConnectionAction(id: string) {
  const res = await postAdminGhlConnectionProbe(id);
  if (!res.data) return { ok: false as const, error: res.error ?? "Probe failed." };
  return {
    ok: res.data.ok,
    connection: res.data.connection,
    detail: res.data.detail,
    error: res.data.ok ? undefined : res.data.detail,
  };
}

export async function linkGhlConnectionClientAction(id: string, clientAccountId: string) {
  const res = await patchAdminGhlConnectionLinkClient(id, clientAccountId);
  if (!res.data) return { ok: false as const, error: res.error ?? "Link failed." };
  return { ok: true as const, connection: res.data.connection as GhlLocationConnectionItem };
}

export async function disconnectGhlConnectionAction(id: string) {
  const res = await deleteAdminGhlConnection(id);
  if (!res.data || !("connection" in res.data)) {
    return { ok: false as const, error: res.error ?? "Disconnect failed." };
  }
  return { ok: true as const, connection: res.data.connection as GhlLocationConnectionItem };
}

export async function loadGhlOAuthPendingInstallsAction() {
  const res = await fetchAdminGhlOAuthPendingInstalls();
  if (!res.data) return { ok: false as const, error: res.error ?? "Failed to load pending installs." };
  return { ok: true as const, items: res.data.items };
}

export async function purgeGhlConnectionAction(id: string) {
  const res = await deleteAdminGhlConnection(id, { purge: true });
  if (!res.data) return { ok: false as const, error: res.error ?? "Purge failed." };
  return { ok: true as const, purged: true as const };
}

export async function dismissGhlOAuthPendingInstallAction(id: string, purge = false) {
  const res = await deleteAdminGhlOAuthPendingInstall(id, { purge });
  if (!res.data) return { ok: false as const, error: res.error ?? "Could not dismiss pending install." };
  return { ok: true as const, purged: Boolean(res.data.purged) };
}
