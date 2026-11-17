/**
 * Durable ghl_lead_received receipts.
 *
 * One row per source lead and GHL location. This module does not call Twilio.
 * provider_accepted is the provider API result. sent requires delivery evidence.
 */

import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  canTransitionNotice,
  providerStatusConfirmsDelivery,
  providerStatusIsStorable,
  type ExternalWebhookNoticeStatusName,
} from "../external-webhook-notification/notice-status.js";
import type { GhlLeadSmsPlan } from "./contract.js";

const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type GhlNoticeDb = PrismaClient | Prisma.TransactionClient;

export type GhlNoticeView = {
  id: string;
  idempotencyKey: string;
  status: ExternalWebhookNoticeStatusName;
  recipient: string;
  providerMessageId: string | null;
  claimCount: number;
};

const select = {
  id: true,
  idempotencyKey: true,
  status: true,
  recipient: true,
  providerMessageId: true,
  claimCount: true,
} as const;

export async function recordGhlLeadNotice(
  db: GhlNoticeDb,
  plan: Extract<GhlLeadSmsPlan, { action: "record" }>
): Promise<{ inserted: boolean; receipt: GhlNoticeView }> {
  const existing = await db.ghlLeadReceivedNotice.findUnique({
    where: { idempotencyKey: plan.idempotencyKey },
    select,
  });
  if (existing) return { inserted: false, receipt: toView(existing) };
  try {
    const created = await db.ghlLeadReceivedNotice.create({
      data: {
        id: randomUUID(),
        idempotencyKey: plan.idempotencyKey,
        event: "ghl_lead_received",
        clientAccountId: plan.clientAccountId,
        sourceLeadEventId: plan.sourceLeadEventId,
        destinationLocationIdGhl: plan.locationIdGhl,
        liveRunId: plan.liveRunId,
        contactExternalId: plan.contactId,
        channel: "sms",
        recipient: plan.recipient,
        status: plan.terminalSuppression ? "suppressed" : "pending",
        consentVersion: plan.consentVersion,
        completedAt: plan.completedAt,
        templateId: "ghl_lead_received",
        skipReason: plan.terminalSuppression,
        deliveryEvidence: false,
      },
      select,
    });
    return { inserted: true, receipt: toView(created) };
  } catch (error) {
    if (!isUnique(error)) throw error;
    const raced = await db.ghlLeadReceivedNotice.findUnique({
      where: { idempotencyKey: plan.idempotencyKey },
      select,
    });
    if (!raced) throw error;
    return { inserted: false, receipt: toView(raced) };
  }
}

export async function claimGhlLeadNotice(
  db: GhlNoticeDb,
  idempotencyKey: string
): Promise<{ claimed: boolean; receipt: GhlNoticeView | null; reason?: string }> {
  const current = await db.ghlLeadReceivedNotice.findUnique({ where: { idempotencyKey }, select });
  if (!current) return { claimed: false, receipt: null, reason: "not_found" };
  if (current.status !== "pending") return { claimed: false, receipt: toView(current), reason: "not_pending" };
  const claimed = await db.ghlLeadReceivedNotice.updateMany({
    where: { idempotencyKey, status: "pending" },
    data: { status: "sending", claimedAt: new Date(), claimCount: { increment: 1 } },
  });
  const after = await db.ghlLeadReceivedNotice.findUnique({ where: { idempotencyKey }, select });
  if (!after) return { claimed: false, receipt: null, reason: "not_found" };
  if (claimed.count !== 1) return { claimed: false, receipt: toView(after), reason: "not_pending" };
  return { claimed: true, receipt: toView(after) };
}

export async function markGhlLeadNoticeProviderAccepted(
  db: GhlNoticeDb,
  input: { idempotencyKey: string; providerMessageId: string; providerStatus: string }
): Promise<void> {
  if (!MESSAGE_ID.test(input.providerMessageId) || !providerStatusIsStorable(input.providerStatus)) return;
  const current = await db.ghlLeadReceivedNotice.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { status: true },
  });
  if (!current || !canTransitionNotice(current.status as ExternalWebhookNoticeStatusName, "provider_accepted")) return;
  await db.ghlLeadReceivedNotice.updateMany({
    where: { idempotencyKey: input.idempotencyKey, status: current.status },
    data: {
      status: "provider_accepted",
      provider: "twilio",
      providerMessageId: input.providerMessageId,
      providerStatus: input.providerStatus,
    },
  });
}

export async function markGhlLeadNoticeDeliveryConfirmed(
  db: GhlNoticeDb,
  input: { idempotencyKey: string; providerStatus: string }
): Promise<boolean> {
  if (!providerStatusConfirmsDelivery(input.providerStatus)) return false;
  const current = await db.ghlLeadReceivedNotice.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { status: true },
  });
  if (!current || !canTransitionNotice(current.status as ExternalWebhookNoticeStatusName, "sent")) return false;
  const updated = await db.ghlLeadReceivedNotice.updateMany({
    where: { idempotencyKey: input.idempotencyKey, status: current.status },
    data: { status: "sent", providerStatus: input.providerStatus, deliveryEvidence: true },
  });
  return updated.count === 1;
}

export async function markGhlLeadNoticeFailed(
  db: GhlNoticeDb,
  input: { idempotencyKey: string; providerCode: number | null }
): Promise<void> {
  const current = await db.ghlLeadReceivedNotice.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { status: true },
  });
  if (!current || !canTransitionNotice(current.status as ExternalWebhookNoticeStatusName, "failed")) return;
  await db.ghlLeadReceivedNotice.updateMany({
    where: { idempotencyKey: input.idempotencyKey, status: current.status },
    data: {
      status: "failed",
      providerCode: input.providerCode,
      lastError: "provider_failed",
    },
  });
}

export async function markGhlLeadNoticeUncertain(db: GhlNoticeDb, idempotencyKey: string): Promise<void> {
  const current = await db.ghlLeadReceivedNotice.findUnique({
    where: { idempotencyKey },
    select: { status: true },
  });
  if (!current || !canTransitionNotice(current.status as ExternalWebhookNoticeStatusName, "uncertain")) return;
  await db.ghlLeadReceivedNotice.updateMany({
    where: { idempotencyKey, status: current.status },
    data: { status: "uncertain", lastError: "transport_uncertain" },
  });
}

export async function markGhlLeadNoticeSuppressed(
  db: GhlNoticeDb,
  idempotencyKey: string,
  skipReason = "stop_suppressed"
): Promise<void> {
  const current = await db.ghlLeadReceivedNotice.findUnique({
    where: { idempotencyKey },
    select: { status: true },
  });
  if (!current || !canTransitionNotice(current.status as ExternalWebhookNoticeStatusName, "suppressed")) return;
  await db.ghlLeadReceivedNotice.updateMany({
    where: { idempotencyKey, status: current.status },
    data: { status: "suppressed", skipReason },
  });
}

export async function promoteStaleGhlLeadNotices(
  db: PrismaClient,
  now: Date = new Date(),
  staleMs = 10 * 60 * 1000
): Promise<{ promoted: number }> {
  const cutoff = new Date(now.getTime() - staleMs);
  const promoted = await db.ghlLeadReceivedNotice.updateMany({
    where: { status: "sending", claimedAt: { lt: cutoff } },
    data: { status: "uncertain", lastError: "transport_uncertain" },
  });
  return { promoted: promoted.count };
}

function toView(row: {
  id: string;
  idempotencyKey: string;
  status: string;
  recipient: string;
  providerMessageId: string | null;
  claimCount: number;
}): GhlNoticeView {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    status: row.status as ExternalWebhookNoticeStatusName,
    recipient: row.recipient,
    providerMessageId: row.providerMessageId,
    claimCount: row.claimCount,
  };
}

function isUnique(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}
