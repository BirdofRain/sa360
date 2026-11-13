/**
 * Durable external-webhook notice receipts.
 *
 * One row per acceptance, channel, and normalized recipient. This module does
 * not call Twilio or Resend and does not write DeliverySuccessNotification.
 * provider_accepted is the provider API result. sent requires delivery evidence.
 */

import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { isTransactionalEmailConfigured } from "../../lib/transactional-email.js";
import {
  externalWebhookNotificationIdempotencyKey,
  prepareExternalWebhookNotification,
  type NotificationSkipReason,
} from "./notification-contract.js";
import {
  canTransitionNotice,
  providerStatusConfirmsDelivery,
  providerStatusIsStorable,
  type ExternalWebhookNoticeStatusName,
} from "./notice-status.js";
import { SMS_CONSENT_VERSION } from "./sms-consent.js";
import { isSmsNotificationsEnabled, readTwilioMessagingConfig } from "./twilio-programmable-messaging.js";

const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type NoticeDb = PrismaClient | Prisma.TransactionClient;

export type NoticeReceiptView = {
  id: string;
  idempotencyKey: string;
  acceptanceId: string;
  channel: "email" | "sms";
  recipient: string;
  status: ExternalWebhookNoticeStatusName;
  provider: string | null;
  providerMessageId: string | null;
  providerStatus: string | null;
  providerCode: number | null;
  deliveryEvidence: boolean;
  skipReason: string | null;
  claimCount: number;
};

export type RecordNoticeResult =
  | { ok: true; inserted: boolean; receipt: NoticeReceiptView }
  | { ok: false; reason: NotificationSkipReason; receipt: null };

export type ClaimNoticeResult =
  | { ok: true; claimed: true; receipt: NoticeReceiptView }
  | { ok: false; claimed: false; reason: NotificationSkipReason | "not_pending" | "not_found"; receipt: NoticeReceiptView | null };

export type TransitionNoticeResult =
  | { ok: true; receipt: NoticeReceiptView }
  | { ok: false; reason: "not_found" | "illegal_transition" | "delivery_evidence_required" | "unsafe_diagnostic" };

type PlannerDeps = {
  emailConfigured?: boolean;
  twilioConfig?: ReturnType<typeof readTwilioMessagingConfig>;
  env?: NodeJS.ProcessEnv;
};

const receiptSelect = {
  id: true,
  idempotencyKey: true,
  acceptanceId: true,
  channel: true,
  recipient: true,
  status: true,
  provider: true,
  providerMessageId: true,
  providerStatus: true,
  providerCode: true,
  deliveryEvidence: true,
  skipReason: true,
  claimCount: true,
} as const;

/**
 * Insert one pending or terminal-suppressed receipt for an HTTP-accepted attempt.
 * The process SMS flag is not consulted. The later dispatcher claims the row.
 */
export async function recordEligibleExternalWebhookNotice(
  db: NoticeDb,
  input: { attemptId: string; channel: "email" | "sms" },
  deps: PlannerDeps = {}
): Promise<RecordNoticeResult> {
  const attemptId = input.attemptId.trim();
  const loaded = await loadEligibility(db, attemptId, input.channel, deps);
  if (!loaded.ok) return { ok: false, reason: loaded.reason, receipt: null };

  const existing = await db.externalWebhookNotificationReceipt.findUnique({
    where: { idempotencyKey: loaded.idempotencyKey },
    select: receiptSelect,
  });
  if (existing) return { ok: true, inserted: false, receipt: toView(existing) };

  try {
    const created = await db.externalWebhookNotificationReceipt.create({
      data: {
        id: randomUUID(),
        idempotencyKey: loaded.idempotencyKey,
        acceptanceId: loaded.attempt.id,
        attemptId: loaded.attempt.id,
        clientAccountId: loaded.attempt.clientAccountId,
        sourceLeadEventId: loaded.attempt.sourceLeadEventId,
        destinationId: loaded.attempt.destinationId,
        channel: input.channel,
        recipient: loaded.recipient,
        status: loaded.terminalSuppression ? "suppressed" : "pending",
        acceptedAt: loaded.attempt.httpAcceptedAt,
        templateId: "delivery_accepted",
        skipReason: loaded.terminalSuppression,
        deliveryEvidence: false,
      },
      select: receiptSelect,
    });
    return { ok: true, inserted: true, receipt: toView(created) };
  } catch (error) {
    if (!isUnique(error)) throw error;
    const raced = await db.externalWebhookNotificationReceipt.findUnique({
      where: { idempotencyKey: loaded.idempotencyKey },
      select: receiptSelect,
    });
    if (!raced) throw error;
    return { ok: true, inserted: false, receipt: toView(raced) };
  }
}

/**
 * Move one pending row to sending. Default SMS dispatch follows the process
 * flag, which stays off. An uncertain or provider-accepted row is not claimed again.
 */
export async function claimExternalWebhookNotice(
  db: NoticeDb,
  input: { idempotencyKey: string; dispatchEnabled?: boolean },
  deps: PlannerDeps = {}
): Promise<ClaimNoticeResult> {
  const idempotencyKey = input.idempotencyKey.trim();
  const current = await db.externalWebhookNotificationReceipt.findUnique({
    where: { idempotencyKey },
    select: receiptSelect,
  });
  if (!current) return { ok: false, claimed: false, reason: "not_found", receipt: null };
  if (current.status !== "pending") {
    return { ok: false, claimed: false, reason: "not_pending", receipt: toView(current) };
  }
  const env = deps.env ?? process.env;
  if (current.channel === "sms" && !(input.dispatchEnabled ?? isSmsNotificationsEnabled(env))) {
    return { ok: false, claimed: false, reason: "sms_disabled", receipt: toView(current) };
  }
  if (current.channel === "email" && !(deps.emailConfigured ?? isTransactionalEmailConfigured())) {
    return { ok: false, claimed: false, reason: "email_not_configured", receipt: toView(current) };
  }
  const still = await loadEligibility(db, current.acceptanceId, current.channel, deps);
  if (!still.ok || still.terminalSuppression) {
    if (still.ok && still.terminalSuppression && canTransitionNotice("pending", "suppressed")) {
      await db.externalWebhookNotificationReceipt.updateMany({
        where: { idempotencyKey, status: "pending" },
        data: { status: "suppressed", skipReason: still.terminalSuppression },
      });
    }
    const after = await db.externalWebhookNotificationReceipt.findUnique({
      where: { idempotencyKey },
      select: receiptSelect,
    });
    return {
      ok: false,
      claimed: false,
      reason: still.ok ? still.terminalSuppression ?? "not_pending" : still.reason,
      receipt: after ? toView(after) : toView(current),
    };
  }
  const updated = await db.externalWebhookNotificationReceipt.updateMany({
    where: { idempotencyKey, status: "pending" },
    data: { status: "sending", claimedAt: new Date(), claimCount: { increment: 1 } },
  });
  const receipt = await db.externalWebhookNotificationReceipt.findUnique({
    where: { idempotencyKey },
    select: receiptSelect,
  });
  if (!receipt) return { ok: false, claimed: false, reason: "not_found", receipt: null };
  if (updated.count === 1) return { ok: true, claimed: true, receipt: toView(receipt) };
  return { ok: false, claimed: false, reason: "not_pending", receipt: toView(receipt) };
}

export async function markExternalWebhookNoticeProviderAccepted(
  db: NoticeDb,
  input: { idempotencyKey: string; provider: "twilio" | "resend"; providerMessageId: string; providerStatus: string }
): Promise<TransitionNoticeResult> {
  if (!MESSAGE_ID.test(input.providerMessageId) || !providerStatusIsStorable(input.providerStatus)) {
    return { ok: false, reason: "unsafe_diagnostic" };
  }
  return transition(db, input.idempotencyKey, "provider_accepted", {
    provider: input.provider,
    providerMessageId: input.providerMessageId,
    providerStatus: input.providerStatus,
    deliveryEvidence: false,
    lastError: null,
  });
}

export async function markExternalWebhookNoticeUncertain(
  db: NoticeDb,
  input: { idempotencyKey: string }
): Promise<TransitionNoticeResult> {
  return transition(db, input.idempotencyKey, "uncertain", { lastError: "transport_uncertain" });
}

export async function markExternalWebhookNoticeFailed(
  db: NoticeDb,
  input: { idempotencyKey: string; providerCode: number | null }
): Promise<TransitionNoticeResult> {
  if (input.providerCode === 21610) return { ok: false, reason: "illegal_transition" };
  return transition(db, input.idempotencyKey, "failed", {
    providerCode: input.providerCode,
    lastError: "provider_failed",
  });
}

/** Handset or inbox confirmation. A create-call status of accepted or queued is refused. */
export async function markExternalWebhookNoticeDeliveryConfirmed(
  db: NoticeDb,
  input: { idempotencyKey: string; providerStatus: string }
): Promise<TransitionNoticeResult> {
  if (!providerStatusConfirmsDelivery(input.providerStatus)) {
    return { ok: false, reason: "delivery_evidence_required" };
  }
  return transition(db, input.idempotencyKey, "sent", {
    providerStatus: input.providerStatus,
    deliveryEvidence: true,
    lastError: null,
  });
}

/** Twilio 21610. Suppresses the receipt and the client's SMS preference. */
export async function markExternalWebhookNoticeProviderStop(
  db: PrismaClient,
  input: { idempotencyKey: string }
): Promise<TransitionNoticeResult> {
  const current = await db.externalWebhookNotificationReceipt.findUnique({
    where: { idempotencyKey: input.idempotencyKey.trim() },
    select: receiptSelect,
  });
  if (!current) return { ok: false, reason: "not_found" };
  if (!canTransitionNotice(current.status, "suppressed")) return { ok: false, reason: "illegal_transition" };
  await db.$transaction(async (tx) => {
    await tx.externalWebhookNotificationReceipt.updateMany({
      where: { idempotencyKey: current.idempotencyKey, status: current.status },
      data: { status: "suppressed", skipReason: "provider_21610", providerCode: 21610, lastError: "provider_21610" },
    });
    await tx.$executeRaw`
      UPDATE "ClientDeliveryNotificationPreference"
      SET "smsSuppressionState" = 'suppressed'::"ExternalWebhookSmsSuppression",
          "smsSuppressedAt" = COALESCE("smsSuppressedAt", transaction_timestamp()),
          "smsEnabled" = false,
          "smsDisabledAt" = CASE WHEN "smsEnabled" THEN transaction_timestamp() ELSE "smsDisabledAt" END,
          "revision" = "revision" + 1,
          "updatedAt" = transaction_timestamp()
      WHERE "clientAccountId" = (
        SELECT "clientAccountId" FROM "ExternalWebhookNotificationReceipt"
        WHERE "idempotencyKey" = ${current.idempotencyKey}
      )
    `;
  });
  const receipt = await db.externalWebhookNotificationReceipt.findUnique({
    where: { idempotencyKey: current.idempotencyKey },
    select: receiptSelect,
  });
  if (!receipt) return { ok: false, reason: "not_found" };
  return { ok: true, receipt: toView(receipt) };
}

type Eligibility =
  | {
      ok: true;
      attempt: {
        id: string;
        clientAccountId: string;
        sourceLeadEventId: string;
        destinationId: string;
        httpAcceptedAt: Date;
      };
      recipient: string;
      idempotencyKey: string;
      terminalSuppression: "before_enabled_at" | "stop_suppressed" | null;
    }
  | { ok: false; reason: NotificationSkipReason };

async function loadEligibility(
  db: NoticeDb,
  attemptId: string,
  channel: "email" | "sms",
  deps: PlannerDeps
): Promise<Eligibility> {
  const attempt = await db.externalWebhookDeliveryAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt || attempt.outcome !== "http_accepted" || !attempt.httpAcceptedAt || attempt.httpStatus == null) {
    return { ok: false, reason: "not_accepted" };
  }
  const preference = await db.clientDeliveryNotificationPreference.findUnique({
    where: { clientAccountId: attempt.clientAccountId },
  });
  if (channel === "sms" && (preference?.smsSuppressionState ?? "unknown") === "unknown") {
    return { ok: false, reason: "stop_unknown" };
  }
  if (channel === "sms" && preference?.smsSuppressionState === "suppressed" && preference.recipientPhoneE164) {
    const key = externalWebhookNotificationIdempotencyKey({
      acceptanceId: attempt.id,
      channel,
      recipient: preference.recipientPhoneE164,
    });
    if (!key.ok) return { ok: false, reason: key.reason };
    return {
      ok: true,
      attempt: {
        id: attempt.id,
        clientAccountId: attempt.clientAccountId,
        sourceLeadEventId: attempt.sourceLeadEventId,
        destinationId: attempt.destinationId,
        httpAcceptedAt: attempt.httpAcceptedAt,
      },
      recipient: preference.recipientPhoneE164,
      idempotencyKey: key.idempotencyKey,
      terminalSuppression: "stop_suppressed",
    };
  }
  const recipient = channel === "email" ? preference?.recipientEmail ?? "" : preference?.recipientPhoneE164 ?? "";
  const smsClock = laterDate(preference?.smsConsentRecordedAt ?? null, preference?.smsEnabledAt ?? null);
  const optedIn =
    preference?.smsEnabled === true &&
    preference.smsSuppressionState === "clear" &&
    preference.smsConsentVersion === SMS_CONSENT_VERSION &&
    Boolean(preference.smsConsentRecordedAt);
  const plan = prepareExternalWebhookNotification(
    {
      event: {
        acceptanceId: attempt.id,
        clientAccountId: attempt.clientAccountId,
        sourceLeadEventId: attempt.sourceLeadEventId,
        destinationId: attempt.destinationId,
        attemptId: attempt.id,
        httpStatus: attempt.httpStatus,
        acceptedAt: attempt.httpAcceptedAt.toISOString(),
      },
      channel,
      recipient,
      preferenceEnabled: preference?.enabled === true,
      recipientVerified: Boolean(preference?.recipientEmailVerifiedAt),
      enabledAt: preference?.enabledAt?.toISOString() ?? null,
      templateId: "delivery_accepted",
      sms: {
        optIn: { optedIn, recordedAt: smsClock?.toISOString() ?? null },
        stopState: preference?.smsSuppressionState ?? "unknown",
      },
    },
    {
      smsEnabled: true,
      emailConfigured: channel === "email" ? (deps.emailConfigured ?? isTransactionalEmailConfigured()) : true,
      twilioConfig: channel === "sms" ? (deps.twilioConfig ?? readTwilioMessagingConfig(deps.env)) : undefined,
    }
  );
  if (plan.action === "skip") {
    if (plan.reason === "before_enabled_at" || plan.reason === "stop_suppressed") {
      const key = externalWebhookNotificationIdempotencyKey({
        acceptanceId: attempt.id,
        channel,
        recipient,
      });
      if (!key.ok) return { ok: false, reason: key.reason };
      return {
        ok: true,
        attempt: {
          id: attempt.id,
          clientAccountId: attempt.clientAccountId,
          sourceLeadEventId: attempt.sourceLeadEventId,
          destinationId: attempt.destinationId,
          httpAcceptedAt: attempt.httpAcceptedAt,
        },
        recipient,
        idempotencyKey: key.idempotencyKey,
        terminalSuppression: plan.reason,
      };
    }
    return { ok: false, reason: plan.reason };
  }
  return {
    ok: true,
    attempt: {
      id: attempt.id,
      clientAccountId: attempt.clientAccountId,
      sourceLeadEventId: attempt.sourceLeadEventId,
      destinationId: attempt.destinationId,
      httpAcceptedAt: attempt.httpAcceptedAt,
    },
    recipient: plan.request.to,
    idempotencyKey: plan.idempotencyKey,
    terminalSuppression: null,
  };
}

async function transition(
  db: NoticeDb,
  idempotencyKey: string,
  to: ExternalWebhookNoticeStatusName,
  data: Prisma.ExternalWebhookNotificationReceiptUpdateManyMutationInput
): Promise<TransitionNoticeResult> {
  const current = await db.externalWebhookNotificationReceipt.findUnique({
    where: { idempotencyKey: idempotencyKey.trim() },
    select: receiptSelect,
  });
  if (!current) return { ok: false, reason: "not_found" };
  if (!canTransitionNotice(current.status, to)) return { ok: false, reason: "illegal_transition" };
  if (to === "sent" && !("deliveryEvidence" in data)) return { ok: false, reason: "delivery_evidence_required" };
  const updated = await db.externalWebhookNotificationReceipt.updateMany({
    where: { idempotencyKey: current.idempotencyKey, status: current.status },
    data: { ...data, status: to },
  });
  if (updated.count !== 1) return { ok: false, reason: "illegal_transition" };
  const receipt = await db.externalWebhookNotificationReceipt.findUnique({
    where: { idempotencyKey: current.idempotencyKey },
    select: receiptSelect,
  });
  if (!receipt) return { ok: false, reason: "not_found" };
  return { ok: true, receipt: toView(receipt) };
}

function laterDate(left: Date | null, right: Date | null): Date | null {
  if (!left || !right) return left ?? right;
  return left.getTime() >= right.getTime() ? left : right;
}

function toView(row: {
  id: string;
  idempotencyKey: string;
  acceptanceId: string;
  channel: "email" | "sms";
  recipient: string;
  status: ExternalWebhookNoticeStatusName;
  provider: string | null;
  providerMessageId: string | null;
  providerStatus: string | null;
  providerCode: number | null;
  deliveryEvidence: boolean;
  skipReason: string | null;
  claimCount: number;
}): NoticeReceiptView {
  return row;
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
