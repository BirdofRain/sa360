import { Prisma, type PrismaClient } from "@prisma/client";

import { isDeliverySuccessNotifyEnabled } from "../../lib/delivery-success-notification-env.js";

export const DELIVERY_SUCCESS_NOTIFICATION_STATUS = {
  pending: "pending",
  sending: "sending",
  sent: "sent",
  skipped: "skipped",
  failed: "failed",
} as const;

export type DeliverySuccessNotificationStatus =
  (typeof DELIVERY_SUCCESS_NOTIFICATION_STATUS)[keyof typeof DELIVERY_SUCCESS_NOTIFICATION_STATUS];

export const DELIVERY_SUCCESS_CHANNEL = {
  company_sheets: "company_sheets",
  ghl_location_api: "ghl_location_api",
  custom_webhook: "custom_webhook",
} as const;

export type DeliverySuccessChannel =
  (typeof DELIVERY_SUCCESS_CHANNEL)[keyof typeof DELIVERY_SUCCESS_CHANNEL];

/** Stale in-flight claims may be reclaimed after this window. */
export const DELIVERY_SUCCESS_NOTIFY_STALE_CLAIM_MS = 10 * 60 * 1000;

/** Matches sendTransactionalEmail's Idempotency-Key cap. This module does not send. */
export const DELIVERY_SUCCESS_RESEND_IDEMPOTENCY_KEY_MAX = 256;

const CHANNELS = new Set<string>(Object.values(DELIVERY_SUCCESS_CHANNEL));

export type NotificationDb = PrismaClient | Prisma.TransactionClient;

export type InsertPendingDeliverySuccessNotificationResult = {
  ok: true;
  inserted: boolean;
  id: string;
  idempotencyKey: string;
  status: DeliverySuccessNotificationStatus;
};

export type ClaimDeliverySuccessNotificationResult =
  | {
      ok: true;
      claimed: true;
      outcome: "claimed";
      id: string;
      attemptCount: number;
      claimCount: 1;
    }
  | {
      ok: true;
      claimed: false;
      outcome: "already_sent" | "skipped" | "in_progress";
      id: string;
      status: DeliverySuccessNotificationStatus;
      claimCount: 0;
    }
  | {
      ok: false;
      claimed: false;
      outcome: "not_found";
      claimCount: 0;
    };

export type ArmDeliverySuccessNotificationCursorResult =
  | { ok: true; armed: false; reason: "notify_disabled" }
  | { ok: true; armed: true; armedAt: Date; newlyArmed: boolean };

export function deliverySuccessNotificationIdempotencyKey(
  channel: DeliverySuccessChannel,
  receiptId: string
): string {
  assertChannel(channel);
  const id = receiptId.trim();
  if (!id) {
    throw new Error("Canonical receipt id is required.");
  }
  return `${channel}:${id}`;
}

export function deliverySuccessResendIdempotencyKey(idempotencyKey: string): string {
  return idempotencyKey.trim().slice(0, DELIVERY_SUCCESS_RESEND_IDEMPOTENCY_KEY_MAX);
}

/**
 * A receipt is eligible only when the cursor is armed and completion is
 * strictly after armedAt. Equal and earlier completions stay unnotified.
 */
export function isCanonicalReceiptEligibleForNotification(input: {
  armedAt: Date | null;
  completedAt: Date;
}): boolean {
  if (input.armedAt == null) return false;
  return input.completedAt.getTime() > input.armedAt.getTime();
}

/**
 * Insert pending once. A second insert for the same key is a no-op and does
 * not change status, including a terminal sent row. This function does not send.
 */
export async function insertPendingDeliverySuccessNotification(
  db: NotificationDb,
  input: {
    clientAccountId: string;
    channel: DeliverySuccessChannel;
    receiptId: string;
    sourceLeadEventId?: string | null;
  }
): Promise<InsertPendingDeliverySuccessNotificationResult> {
  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) {
    throw new Error("Client account id is required.");
  }
  const idempotencyKey = deliverySuccessNotificationIdempotencyKey(
    input.channel,
    input.receiptId
  );
  const sourceLeadEventId = input.sourceLeadEventId?.trim() || null;
  try {
    const created = await db.deliverySuccessNotification.create({
      data: {
        idempotencyKey,
        clientAccountId,
        channel: input.channel,
        receiptId: input.receiptId.trim(),
        sourceLeadEventId,
        status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.pending,
        attemptCount: 0,
      },
      select: { id: true, status: true, idempotencyKey: true },
    });
    return {
      ok: true,
      inserted: true,
      id: created.id,
      idempotencyKey: created.idempotencyKey,
      status: created.status,
    };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await db.deliverySuccessNotification.findUnique({
      where: { idempotencyKey },
      select: { id: true, status: true, idempotencyKey: true },
    });
    if (!existing) throw error;
    return {
      ok: true,
      inserted: false,
      id: existing.id,
      idempotencyKey: existing.idempotencyKey,
      status: existing.status,
    };
  }
}

export function deliverySuccessNotificationClaimWhere(
  idempotencyKey: string,
  now: Date,
  staleMs = DELIVERY_SUCCESS_NOTIFY_STALE_CLAIM_MS
): Prisma.DeliverySuccessNotificationWhereInput {
  const staleBefore = new Date(now.getTime() - staleMs);
  return {
    idempotencyKey,
    OR: [
      { status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.pending },
      { status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.failed },
      {
        AND: [
          { status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.sending },
          { claimedAt: { lt: staleBefore } },
        ],
      },
    ],
  };
}

/**
 * Conditional claim from pending or failed, or from sending older than 10 minutes,
 * to sending. Exactly one row may match the idempotency key. sent and skipped
 * are not claimable. This function does not send email.
 */
export async function claimDeliverySuccessNotification(
  db: NotificationDb,
  input: { idempotencyKey: string; now?: Date; staleMs?: number }
): Promise<ClaimDeliverySuccessNotificationResult> {
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) {
    return { ok: false, claimed: false, outcome: "not_found", claimCount: 0 };
  }
  const now = input.now ?? new Date();
  const updated = await db.deliverySuccessNotification.updateMany({
    where: deliverySuccessNotificationClaimWhere(idempotencyKey, now, input.staleMs),
    data: {
      status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.sending,
      claimedAt: now,
      attemptCount: { increment: 1 },
      lastError: null,
    },
  });
  if (updated.count > 1) {
    throw new Error("Delivery success notification claim updated more than one row.");
  }
  if (updated.count === 1) {
    const row = await db.deliverySuccessNotification.findUnique({
      where: { idempotencyKey },
      select: { id: true, attemptCount: true },
    });
    if (!row) {
      throw new Error("Delivery success notification claim winner disappeared.");
    }
    return {
      ok: true,
      claimed: true,
      outcome: "claimed",
      id: row.id,
      attemptCount: row.attemptCount,
      claimCount: 1,
    };
  }

  const current = await db.deliverySuccessNotification.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true },
  });
  if (!current) {
    return { ok: false, claimed: false, outcome: "not_found", claimCount: 0 };
  }
  if (current.status === DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent) {
    return {
      ok: true,
      claimed: false,
      outcome: "already_sent",
      id: current.id,
      status: current.status,
      claimCount: 0,
    };
  }
  if (current.status === DELIVERY_SUCCESS_NOTIFICATION_STATUS.skipped) {
    return {
      ok: true,
      claimed: false,
      outcome: "skipped",
      id: current.id,
      status: current.status,
      claimCount: 0,
    };
  }
  return {
    ok: true,
    claimed: false,
    outcome: "in_progress",
    id: current.id,
    status: current.status,
    claimCount: 0,
  };
}

/**
 * First observation that the notify flag is exact true.
 * Sets armedAt only while it is null. Never moves an existing armedAt.
 * Does not insert a notification row. Returns before a query when the flag is off.
 */
export async function armDeliverySuccessNotificationCursor(
  db: NotificationDb,
  options: { now?: Date; env?: NodeJS.ProcessEnv } = {}
): Promise<ArmDeliverySuccessNotificationCursorResult> {
  if (!isDeliverySuccessNotifyEnabled(options.env)) {
    return { ok: true, armed: false, reason: "notify_disabled" };
  }
  const now = options.now ?? new Date();
  const existing = await db.deliverySuccessNotificationCursor.findUnique({
    where: { singleton: true },
    select: { armedAt: true },
  });
  if (existing?.armedAt) {
    return { ok: true, armed: true, armedAt: existing.armedAt, newlyArmed: false };
  }
  if (!existing) {
    try {
      const created = await db.deliverySuccessNotificationCursor.create({
        data: { singleton: true, armedAt: now },
        select: { armedAt: true },
      });
      if (!created.armedAt) {
        throw new Error("Delivery success notification cursor armed without a timestamp.");
      }
      return { ok: true, armed: true, armedAt: created.armedAt, newlyArmed: true };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
  }
  const updated = await db.deliverySuccessNotificationCursor.updateMany({
    where: { singleton: true, armedAt: null },
    data: { armedAt: now },
  });
  const row = await db.deliverySuccessNotificationCursor.findUnique({
    where: { singleton: true },
    select: { armedAt: true },
  });
  if (!row?.armedAt) {
    throw new Error("Delivery success notification cursor is missing armedAt.");
  }
  return {
    ok: true,
    armed: true,
    armedAt: row.armedAt,
    newlyArmed: updated.count === 1,
  };
}

function assertChannel(channel: string): asserts channel is DeliverySuccessChannel {
  if (!CHANNELS.has(channel)) {
    throw new Error("Unknown delivery success channel.");
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
