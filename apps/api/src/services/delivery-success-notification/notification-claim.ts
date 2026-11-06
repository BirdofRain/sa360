import { Prisma, type PrismaClient } from "@prisma/client";

export const DELIVERY_SUCCESS_NOTIFICATION_STATUS = {
  pending: "pending",
  sending: "sending",
  sent: "sent",
  skipped: "skipped",
  failed: "failed",
} as const;

export type DeliverySuccessNotificationStatus =
  (typeof DELIVERY_SUCCESS_NOTIFICATION_STATUS)[keyof typeof DELIVERY_SUCCESS_NOTIFICATION_STATUS];

/** Stale in-flight claims may be reclaimed after this window. */
export const DELIVERY_SUCCESS_NOTIFY_STALE_CLAIM_MS = 10 * 60 * 1000;

/** Matches sendTransactionalEmail's Idempotency-Key cap. This module does not send. */
export const DELIVERY_SUCCESS_RESEND_IDEMPOTENCY_KEY_MAX = 256;

export type NotificationDb = PrismaClient | Prisma.TransactionClient;

export type DeliverySuccessEvidence = {
  sheetsJobId: string | null;
  ghlLiveRunId: string | null;
  customWebhookAttemptId: string | null;
};

export type RecordDeliverySuccessNotificationResult = {
  ok: true;
  inserted: boolean;
  id: string;
  idempotencyKey: string;
  status: DeliverySuccessNotificationStatus;
} & DeliverySuccessEvidence;

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

export function deliverySuccessNotificationIdempotencyKey(
  clientAccountId: string,
  sourceLeadEventId: string
): string {
  const clientId = requireIdentityPart(clientAccountId, "Client account id");
  const leadId = requireIdentityPart(sourceLeadEventId, "Source lead id");
  return `client_lead:${clientId}:${leadId}`;
}

export function deliverySuccessResendIdempotencyKey(idempotencyKey: string): string {
  return idempotencyKey.trim().slice(0, DELIVERY_SUCCESS_RESEND_IDEMPOTENCY_KEY_MAX);
}

/**
 * A lead is eligible only while the client preference is on and completion is
 * strictly after enabledAt. Equal and earlier completions, and the disabled
 * gap before a later re-enable, stay unnotified.
 */
export function isSourceLeadEligibleForClientNotification(input: {
  enabled: boolean;
  enabledAt: Date | null;
  completedAt: Date;
}): boolean {
  if (!input.enabled || input.enabledAt == null) return false;
  return input.completedAt.getTime() > input.enabledAt.getTime();
}

/**
 * Insert one pending row per client and source lead. A second channel fills
 * a null evidence column on that row. It does not insert another row and it
 * does not change status, including a terminal sent row. This function does not send.
 */
export async function recordDeliverySuccessNotification(
  db: NotificationDb,
  input: {
    clientAccountId: string;
    sourceLeadEventId: string;
    sheetsJobId?: string | null;
    ghlLiveRunId?: string | null;
    customWebhookAttemptId?: string | null;
  }
): Promise<RecordDeliverySuccessNotificationResult> {
  const clientAccountId = requireIdentityPart(input.clientAccountId, "Client account id");
  const sourceLeadEventId = requireIdentityPart(input.sourceLeadEventId, "Source lead id");
  const idempotencyKey = deliverySuccessNotificationIdempotencyKey(
    clientAccountId,
    sourceLeadEventId
  );
  const evidence = {
    sheetsJobId: blankToNull(input.sheetsJobId),
    ghlLiveRunId: blankToNull(input.ghlLiveRunId),
    customWebhookAttemptId: blankToNull(input.customWebhookAttemptId),
  };
  try {
    const created = await db.deliverySuccessNotification.create({
      data: {
        idempotencyKey,
        clientAccountId,
        sourceLeadEventId,
        status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.pending,
        attemptCount: 0,
        ...evidence,
      },
      select: evidenceSelect,
    });
    return { ok: true, inserted: true, ...created };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return fillEvidence(db, idempotencyKey, evidence);
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
 * to sending. Exactly one row may match the client-lead key. sent and skipped
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

const evidenceSelect = {
  id: true,
  idempotencyKey: true,
  status: true,
  sheetsJobId: true,
  ghlLiveRunId: true,
  customWebhookAttemptId: true,
} as const;

/**
 * Fill only null evidence columns. One statement, evaluated on the locked row,
 * so a Sheets write cannot clear a GHL receipt id and a GHL write cannot clear
 * a Sheets receipt id. A non-null column is kept. Status is not updated, so a
 * terminal sent row stays sent.
 */
async function fillEvidence(
  db: NotificationDb,
  idempotencyKey: string,
  evidence: DeliverySuccessEvidence
): Promise<RecordDeliverySuccessNotificationResult> {
  if (evidence.sheetsJobId || evidence.ghlLiveRunId || evidence.customWebhookAttemptId) {
    await db.$executeRaw`
      UPDATE "DeliverySuccessNotification"
      SET
        "sheetsJobId" = COALESCE("sheetsJobId", CAST(${evidence.sheetsJobId} AS TEXT)),
        "ghlLiveRunId" = COALESCE("ghlLiveRunId", CAST(${evidence.ghlLiveRunId} AS TEXT)),
        "customWebhookAttemptId" = COALESCE(
          "customWebhookAttemptId",
          CAST(${evidence.customWebhookAttemptId} AS TEXT)
        ),
        "updatedAt" = transaction_timestamp()
      WHERE "idempotencyKey" = ${idempotencyKey}
    `;
  }
  const row = await db.deliverySuccessNotification.findUnique({
    where: { idempotencyKey },
    select: evidenceSelect,
  });
  if (!row) {
    throw new Error("Delivery success notification disappeared after a unique conflict.");
  }
  return { ok: true, inserted: false, ...row };
}

function requireIdentityPart(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  if (trimmed.includes(":")) {
    throw new Error(`${label} must not contain ':'.`);
  }
  return trimmed;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
