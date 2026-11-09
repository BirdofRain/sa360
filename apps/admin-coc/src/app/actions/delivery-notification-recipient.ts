"use server";

import { adminRequestJson } from "@/lib/admin-api/server";
import { requireAdminCocAdminSession, requireAdminCocSession } from "@/lib/admin-coc-session-guard";
import {
  isNotificationRequestId,
  isNotificationRevision,
  normalizeNotificationRecipient,
  parseRecipientSnapshot,
  readNotificationErrorCode,
  type NotificationErrorCode,
  type RecipientSnapshot,
} from "@/lib/notification-setup/model";
import { normalizeTeamWorkspaceClientId } from "@/lib/team-workspace/contract";

export type RecipientActionResult =
  | { ok: true; recipient: RecipientSnapshot; replayed: boolean; refreshed: boolean }
  | { ok: false; error: NotificationErrorCode; recipient: RecipientSnapshot | null };

export async function loadDeliveryNotificationRecipient(
  clientAccountId: string
): Promise<{ ok: true; recipient: RecipientSnapshot } | { ok: false; error: NotificationErrorCode }> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  const id = normalizeTeamWorkspaceClientId(clientAccountId);
  if (!id) return { ok: false, error: "client_not_found" };
  return readRecipient(id);
}

export async function saveDeliveryNotificationRecipientAction(input: {
  clientAccountId: string;
  requestId: string;
  expectedRevision: number;
  recipientEmail: string;
}): Promise<RecipientActionResult> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  const id = normalizeTeamWorkspaceClientId(input.clientAccountId);
  if (!id) return { ok: false, error: "client_not_found", recipient: null };
  const recipientEmail = normalizeNotificationRecipient(input.recipientEmail);
  if (!recipientEmail) return { ok: false, error: "invalid_recipient", recipient: null };
  if (!isNotificationRequestId(input.requestId) || !isNotificationRevision(input.expectedRevision)) {
    return { ok: false, error: "invalid_body", recipient: null };
  }

  const saved = await adminRequestJson<unknown>(
    "PUT",
    `/admin/v1/clients/${encodeURIComponent(id)}/delivery-notification-recipient`,
    {
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      recipientEmail,
    }
  );
  if (!saved.ok) {
    const error = readNotificationErrorCode(saved.status, saved.body);
    const recipient =
      error === "revision_conflict" || error === "request_id_conflict" ? await readRecipientOrNull(id) : null;
    return { ok: false, error, recipient };
  }
  const write = parseRecipientWrite(saved.data, id);
  if (!write) return { ok: false, error: "request_failed", recipient: null };
  const refreshed = await readRecipient(id);
  if (!refreshed.ok) {
    return { ok: true, recipient: write.recipient, replayed: write.replayed, refreshed: false };
  }
  return { ok: true, recipient: refreshed.recipient, replayed: write.replayed, refreshed: true };
}

async function readRecipient(
  clientAccountId: string
): Promise<{ ok: true; recipient: RecipientSnapshot } | { ok: false; error: NotificationErrorCode }> {
  const result = await adminRequestJson<unknown>(
    "GET",
    `/admin/v1/clients/${encodeURIComponent(clientAccountId)}/delivery-notification-recipient`
  );
  if (!result.ok) return { ok: false, error: readNotificationErrorCode(result.status, result.body) };
  const recipient = parseRecipientSnapshot(result.data, clientAccountId);
  if (!recipient) return { ok: false, error: "request_failed" };
  return { ok: true, recipient };
}

async function readRecipientOrNull(clientAccountId: string): Promise<RecipientSnapshot | null> {
  const read = await readRecipient(clientAccountId);
  return read.ok ? read.recipient : null;
}

function parseRecipientWrite(
  value: unknown,
  clientAccountId: string
): { recipient: RecipientSnapshot; replayed: boolean } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.replayed !== "boolean") return null;
  const recipient = parseRecipientSnapshot(value, clientAccountId);
  if (!recipient) return null;
  return { recipient, replayed: row.replayed };
}
