/**
 * Requeue one bounded page of pending ghl_lead_received notices.
 *
 * Discovery can insert a row and then lose the BullMQ job. Dispatch can also
 * return while SMS is disabled and leave the row pending. This pass enqueues
 * that row again. It does not read historical live runs, and it does not
 * select provider_accepted, sending, sent, uncertain, suppressed, or failed.
 * A row at or before the frozen discovery cutoff is not selected.
 * The page is capped. One call does not drain the table.
 */

import type { PrismaClient } from "@prisma/client";

import { isSourceLeadEligibleForClientNotification } from "../delivery-success-notification/notification-claim.js";
import { smsConsentAllowsGhlLeadNotice, SMS_CONSENT_VERSION_GHL } from "../external-webhook-notification/sms-consent.js";
import { markGhlLeadNoticeSuppressed } from "./receipt.js";

export const GHL_LEAD_NOTICE_DISCOVERY_CURSOR_ID = "ghl_lead_received";
export const GHL_LEAD_NOTICE_CUTOFF_CURSOR_ID = "ghl_lead_received_cutoff";
export const GHL_LEAD_NOTICE_PENDING_CURSOR_ID = "ghl_lead_received_pending";
export const GHL_LEAD_NOTICE_PENDING_RECOVERY_PAGE = 20;

type PendingRow = {
  id: string;
  createdAt: Date;
  idempotencyKey: string;
  clientAccountId: string;
  recipient: string;
  completedAt: Date;
  consentVersion: string;
};

type PendingKey = { id: string; createdAt: Date };

export async function recoverPendingGhlLeadNotices(
  db: PrismaClient,
  input: {
    limit?: number;
    enqueue: (receiptId: string) => Promise<unknown>;
  }
): Promise<{ scanned: number; enqueued: number; suppressed: number }> {
  const cutoff = await db.ghlLeadNoticeDiscoveryCursor.findUnique({
    where: { id: GHL_LEAD_NOTICE_CUTOFF_CURSOR_ID },
  });
  if (!cutoff?.lastCompletedAt) return { scanned: 0, enqueued: 0, suppressed: 0 };
  const limit = boundedPage(input.limit);
  const stored = await db.ghlLeadNoticeDiscoveryCursor.findUnique({
    where: { id: GHL_LEAD_NOTICE_PENDING_CURSOR_ID },
  });
  const after =
    stored?.lastCompletedAt && stored.lastRunId
      ? { createdAt: stored.lastCompletedAt, id: stored.lastRunId }
      : null;
  let rows = await readPendingPage(db, cutoff.lastCompletedAt, after, limit);
  if (rows.length < limit && after) {
    const head = await readPendingPage(db, cutoff.lastCompletedAt, null, limit - rows.length);
    const seen = new Set(rows.map((row) => row.id));
    for (const row of head) {
      if (seen.has(row.id)) continue;
      if (!isAtOrBefore(row, after)) continue;
      rows.push(row);
      if (rows.length >= limit) break;
    }
  }
  if (rows.length === 0) return { scanned: 0, enqueued: 0, suppressed: 0 };

  const preferences = await db.clientDeliveryNotificationPreference.findMany({
    where: { clientAccountId: { in: [...new Set(rows.map((row) => row.clientAccountId))] } },
  });
  const preferenceByClient = new Map(preferences.map((row) => [row.clientAccountId, row]));
  let enqueued = 0;
  let suppressed = 0;
  let inspected: PendingKey | null = null;
  for (const row of rows) {
    inspected = row;
    const reason = ineligibleReason(row, preferenceByClient.get(row.clientAccountId) ?? null);
    if (reason) {
      await markGhlLeadNoticeSuppressed(db, row.idempotencyKey, reason);
      suppressed += 1;
      continue;
    }
    try {
      await input.enqueue(row.id);
      enqueued += 1;
    } catch {
      // Leave the row pending. A later page, after the cursor wraps, tries once more.
    }
  }
  if (inspected) {
    await db.ghlLeadNoticeDiscoveryCursor.upsert({
      where: { id: GHL_LEAD_NOTICE_PENDING_CURSOR_ID },
      create: {
        id: GHL_LEAD_NOTICE_PENDING_CURSOR_ID,
        lastCompletedAt: inspected.createdAt,
        lastRunId: inspected.id,
      },
      update: { lastCompletedAt: inspected.createdAt, lastRunId: inspected.id },
    });
  }
  return { scanned: rows.length, enqueued, suppressed };
}

function ineligibleReason(
  row: PendingRow,
  preference: {
    smsEnabled: boolean;
    smsSuppressionState: string;
    smsConsentVersion: string | null;
    smsConsentText: string | null;
    smsConsentRecordedAt: Date | null;
    smsEnabledAt: Date | null;
    recipientPhoneE164: string | null;
  } | null
): string | null {
  if (row.consentVersion !== SMS_CONSENT_VERSION_GHL) return "not_opted_in";
  if (!preference) return "not_opted_in";
  if (preference.smsSuppressionState === "suppressed") return "stop_suppressed";
  if (preference.smsSuppressionState !== "clear") return "stop_unknown";
  if (preference.recipientPhoneE164 !== row.recipient) return "not_opted_in";
  if (!smsConsentAllowsGhlLeadNotice(preference)) return "not_opted_in";
  const consentAt = preference.smsConsentRecordedAt;
  const enabledAt = preference.smsEnabledAt;
  if (!consentAt || !enabledAt) return "before_consent";
  const gate = consentAt.getTime() > enabledAt.getTime() ? consentAt : enabledAt;
  if (
    !isSourceLeadEligibleForClientNotification({
      enabled: true,
      enabledAt: gate,
      completedAt: row.completedAt,
    })
  ) {
    return "before_consent";
  }
  return null;
}

function boundedPage(limit: number | undefined): number {
  const requested = limit ?? GHL_LEAD_NOTICE_PENDING_RECOVERY_PAGE;
  if (!Number.isFinite(requested)) return GHL_LEAD_NOTICE_PENDING_RECOVERY_PAGE;
  return Math.min(GHL_LEAD_NOTICE_PENDING_RECOVERY_PAGE, Math.max(1, Math.trunc(requested)));
}

async function readPendingPage(
  db: PrismaClient,
  cutoff: Date,
  after: PendingKey | null,
  limit: number
): Promise<PendingRow[]> {
  return db.ghlLeadReceivedNotice.findMany({
    where: {
      AND: [
        { status: "pending", event: "ghl_lead_received", templateId: "ghl_lead_received" },
        { completedAt: { gt: cutoff } },
        ...(after
          ? [
              {
                OR: [
                  { createdAt: { gt: after.createdAt } },
                  { AND: [{ createdAt: after.createdAt }, { id: { gt: after.id } }] },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      createdAt: true,
      idempotencyKey: true,
      clientAccountId: true,
      recipient: true,
      completedAt: true,
      consentVersion: true,
    },
  });
}

function isAtOrBefore(row: PendingKey, cursor: PendingKey): boolean {
  if (row.createdAt < cursor.createdAt) return true;
  return row.createdAt.getTime() === cursor.createdAt.getTime() && row.id <= cursor.id;
}
