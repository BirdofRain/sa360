"use server";

import { requireAdminCocSession } from "@/lib/admin-coc-session-guard";
import {
  deleteAdminSourceFunnelAssociation,
  fetchAdminClientSourceFunnels,
  postAdminClientSourceFunnel,
  postAdminSourceFunnelConfirm,
  postAdminSourceFunnelReassign,
} from "@/lib/admin-api/source-funnels-server";
import type {
  AssociateSourceFunnelResult,
  ClearSourceFunnelSuccess,
  ConfirmSourceFunnelSuccess,
  ReassignSourceFunnelSuccess,
  SourceFunnelListResponse,
  SourceFunnelOriginConflict,
} from "@/lib/clients/source-funnels";

export async function listClientSourceFunnelsAction(
  clientAccountId: string
): Promise<{ ok: true; items: SourceFunnelListResponse["items"] } | { ok: false; error: string }> {
  await requireAdminCocSession();
  const res = await fetchAdminClientSourceFunnels(clientAccountId);
  if (!res.data) return { ok: false, error: res.error ?? "Failed to load LeadCapture sources." };
  return { ok: true, items: res.data.items };
}

export async function associateClientSourceFunnelAction(
  clientAccountId: string,
  pageUrlOrSlug: string
): Promise<AssociateSourceFunnelResult> {
  await requireAdminCocSession();
  return postAdminClientSourceFunnel(clientAccountId, pageUrlOrSlug);
}

export async function confirmClientSourceFunnelAction(
  sourceFunnelId: string,
  originClientAccountId: string
): Promise<ConfirmSourceFunnelSuccess | SourceFunnelOriginConflict | { ok: false; error: string }> {
  await requireAdminCocSession();
  return postAdminSourceFunnelConfirm(sourceFunnelId, originClientAccountId);
}

export async function reassignClientSourceFunnelAction(
  sourceFunnelId: string,
  originClientAccountId: string
): Promise<ReassignSourceFunnelSuccess | { ok: false; error: string }> {
  await requireAdminCocSession();
  return postAdminSourceFunnelReassign(sourceFunnelId, originClientAccountId);
}

export async function clearClientSourceFunnelAssociationAction(
  sourceFunnelId: string
): Promise<ClearSourceFunnelSuccess | { ok: false; error: string }> {
  await requireAdminCocSession();
  return deleteAdminSourceFunnelAssociation(sourceFunnelId);
}
