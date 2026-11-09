"use server";

import { adminRequestJson } from "@/lib/admin-api/server";
import { requireAdminCocAdminSession, requireAdminCocSession } from "@/lib/admin-coc-session-guard";
import {
  isNotificationRequestId,
  isNotificationRevision,
  parsePreferenceSnapshot,
  parsePreferenceWriteSnapshot,
  readNotificationErrorCode,
  type NotificationErrorCode,
  type PreferenceSnapshot,
} from "@/lib/notification-setup/model";
import { normalizeTeamWorkspaceClientId } from "@/lib/team-workspace/contract";
import { parseTeamWorkspaceResponse } from "@/lib/team-workspace/parse";

export type PreferenceActionResult =
  | { ok: true; preference: PreferenceSnapshot; replayed: boolean; refreshed: boolean }
  | { ok: false; error: NotificationErrorCode; preference: PreferenceSnapshot | null };

export async function reloadDeliveryNotificationPreferenceAction(
  clientAccountId: string
): Promise<{ ok: true; preference: PreferenceSnapshot } | { ok: false; error: NotificationErrorCode }> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  const id = normalizeTeamWorkspaceClientId(clientAccountId);
  if (!id) return { ok: false, error: "client_not_found" };
  return readPreference(id);
}

export async function saveDeliveryNotificationPreferenceAction(input: {
  clientAccountId: string;
  requestId: string;
  expectedRevision: number;
  enabled: boolean;
}): Promise<PreferenceActionResult> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  const id = normalizeTeamWorkspaceClientId(input.clientAccountId);
  if (!id) return { ok: false, error: "client_not_found", preference: null };
  if (
    !isNotificationRequestId(input.requestId) ||
    !isNotificationRevision(input.expectedRevision) ||
    typeof input.enabled !== "boolean"
  ) {
    return { ok: false, error: "invalid_body", preference: null };
  }

  const saved = await adminRequestJson<unknown>(
    "PUT",
    `/admin/v1/team-workspace/clients/${encodeURIComponent(id)}/delivery-notification`,
    {
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      enabled: input.enabled,
    }
  );
  if (!saved.ok) {
    const error = readNotificationErrorCode(saved.status, saved.body);
    return { ok: false, error, preference: await preferenceAfterFailure(id, error) };
  }
  const write = parsePreferenceWriteSnapshot(saved.data);
  if (!write) return { ok: false, error: "request_failed", preference: null };
  const refreshed = await readPreference(id);
  if (!refreshed.ok) {
    return { ok: true, preference: write.snapshot, replayed: write.replayed, refreshed: false };
  }
  return { ok: true, preference: refreshed.preference, replayed: write.replayed, refreshed: true };
}

async function readPreference(
  clientAccountId: string
): Promise<{ ok: true; preference: PreferenceSnapshot } | { ok: false; error: NotificationErrorCode }> {
  const result = await adminRequestJson<unknown>(
    "GET",
    `/admin/v1/team-workspace/clients/${encodeURIComponent(clientAccountId)}`
  );
  if (!result.ok) return { ok: false, error: readNotificationErrorCode(result.status, result.body) };
  const body = parseTeamWorkspaceResponse(result.data);
  if (!body || body.client.clientAccountId !== clientAccountId) {
    return { ok: false, error: "request_failed" };
  }
  const preference = parsePreferenceSnapshot(body.clientNotification);
  if (!preference) return { ok: false, error: "request_failed" };
  return { ok: true, preference };
}

async function preferenceAfterFailure(
  clientAccountId: string,
  error: NotificationErrorCode
): Promise<PreferenceSnapshot | null> {
  if (error !== "revision_conflict" && error !== "request_id_conflict" && error !== "recipient_not_verified") {
    return null;
  }
  const refreshed = await readPreference(clientAccountId);
  return refreshed.ok ? refreshed.preference : null;
}
