import "server-only";

import { adminFetchJson, adminRequestJson } from "@/lib/admin-api/server";
import { formatAdminApiError } from "@/lib/admin-api/admin-api-error";
import {
  LEADCAPTURE_SOURCES_OWNED_ELSEWHERE,
  parseSourceFunnelConflict,
  type AssociateSourceFunnelResult,
  type AssociateSourceFunnelSuccess,
  type ClearSourceFunnelSuccess,
  type ConfirmSourceFunnelSuccess,
  type ReassignSourceFunnelSuccess,
  type SourceFunnelListResponse,
  type SourceFunnelOriginConflict,
} from "@/lib/clients/source-funnels";

export async function fetchAdminClientSourceFunnels(clientAccountId: string): Promise<{
  data: SourceFunnelListResponse | null;
  error: string | null;
}> {
  const id = clientAccountId.trim();
  if (!id) return { data: null, error: "Missing clientAccountId" };
  const res = await adminFetchJson<SourceFunnelListResponse>(
    `/admin/v1/clients/${encodeURIComponent(id)}/source-funnels`
  );
  if (!res.ok) return { data: null, error: formatAdminApiError(res) };
  return { data: res.data, error: null };
}

export async function postAdminClientSourceFunnel(
  clientAccountId: string,
  pageUrlOrSlug: string
): Promise<AssociateSourceFunnelResult> {
  const id = clientAccountId.trim();
  const res = await adminRequestJson<AssociateSourceFunnelSuccess>(
    "POST",
    `/admin/v1/clients/${encodeURIComponent(id)}/source-funnels`,
    { pageUrlOrSlug }
  );
  if (res.ok) return res.data;
  const conflict = parseSourceFunnelConflict(res.body);
  if (conflict) return conflict;
  if (res.status === 409) {
    return { ok: false, error: LEADCAPTURE_SOURCES_OWNED_ELSEWHERE };
  }
  return { ok: false, error: formatAdminApiError(res) };
}

export async function postAdminSourceFunnelConfirm(
  sourceFunnelId: string,
  originClientAccountId: string
): Promise<ConfirmSourceFunnelSuccess | SourceFunnelOriginConflict | { ok: false; error: string }> {
  const res = await adminRequestJson<ConfirmSourceFunnelSuccess>(
    "POST",
    `/admin/v1/source-funnels/${encodeURIComponent(sourceFunnelId)}/confirm`,
    { originClientAccountId }
  );
  if (res.ok) return res.data;
  const conflict = parseSourceFunnelConflict(res.body);
  if (conflict) return conflict;
  return { ok: false, error: formatAdminApiError(res) };
}

export async function postAdminSourceFunnelReassign(
  sourceFunnelId: string,
  originClientAccountId: string
): Promise<ReassignSourceFunnelSuccess | { ok: false; error: string }> {
  const res = await adminRequestJson<ReassignSourceFunnelSuccess>(
    "POST",
    `/admin/v1/source-funnels/${encodeURIComponent(sourceFunnelId)}/reassign`,
    { originClientAccountId }
  );
  if (res.ok) return res.data;
  return { ok: false, error: formatAdminApiError(res) };
}

export async function deleteAdminSourceFunnelAssociation(
  sourceFunnelId: string
): Promise<ClearSourceFunnelSuccess | { ok: false; error: string }> {
  const res = await adminRequestJson<ClearSourceFunnelSuccess>(
    "DELETE",
    `/admin/v1/source-funnels/${encodeURIComponent(sourceFunnelId)}/association`
  );
  if (res.ok) return res.data;
  return { ok: false, error: formatAdminApiError(res) };
}
