/**
 * Admin C.O.C. writes for one client's delivery-notification recipient and
 * on/off choice.
 *
 * The mailbox rules match `notification-preference.ts`: one lowercase address,
 * verification timestamp from the database transaction, and an address change
 * forces enabled false without moving enabledAt backward. These functions do
 * not copy the portal sign-in address, do not send mail, and do not arm a destination.
 */

import { createHash, randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { normalizeRecipientEmail } from "./notification-preference.js";

const RECIPIENT_ACTION = "recipient";
const PREFERENCE_ACTION = "preference";

type ConfigAction = typeof RECIPIENT_ACTION | typeof PREFERENCE_ACTION;

type PreferenceRow = {
  clientAccountId: string;
  enabled: boolean;
  channel: "email";
  recipientEmail: string | null;
  recipientEmailVerifiedAt: Date | null;
  enabledAt: Date | null;
  disabledAt: Date | null;
  revision: number;
};

export type DeliveryNotificationConfigFailure = {
  ok: false;
  statusCode: 400 | 404 | 409;
  error:
    | "client_not_found"
    | "invalid_recipient"
    | "recipient_not_verified"
    | "revision_conflict"
    | "request_id_conflict";
  replayed: boolean;
};

type RecipientFields = {
  clientAccountId: string;
  recipientEmail: string;
  recipientVerified: true;
  recipientEmailVerifiedAt: string;
  enabled: boolean;
  enabledAt: string | null;
  disabledAt: string | null;
  revision: number;
  channel: "email";
};

type PreferenceFields = {
  clientAccountId: string;
  enabled: boolean;
  recipientVerified: boolean;
  enabledAt: string | null;
  disabledAt: string | null;
  revision: number;
  channel: "email";
};

export type DeliveryNotificationRecipientConfigResult =
  | ({ ok: true; replayed: boolean } & RecipientFields)
  | DeliveryNotificationConfigFailure;

export type DeliveryNotificationPreferenceConfigResult =
  | ({ ok: true; replayed: boolean } & PreferenceFields)
  | DeliveryNotificationConfigFailure;

type StoredRecipient = { kind: "recipient" } & RecipientFields;
type StoredPreference = { kind: "preference" } & PreferenceFields;
type StoredRejection = { kind: "rejected"; error: "recipient_not_verified" };
type StoredResult = StoredRecipient | StoredPreference | StoredRejection;

/**
 * Record one admin-verified mailbox. The verification timestamp is the
 * database transaction time. Changing the address forces enabled false and
 * does not move enabledAt backward. The same request id returns the stored
 * result. A stale expectedRevision conflicts and does not consume the id.
 */
export async function configureDeliveryNotificationRecipient(
  db: PrismaClient,
  input: {
    clientAccountId: string;
    requestId: string;
    expectedRevision: number;
    recipientEmail: string;
  }
): Promise<DeliveryNotificationRecipientConfigResult> {
  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) return failure(404, "client_not_found");
  const recipientEmail = normalizeRecipientEmail(input.recipientEmail);
  if (!recipientEmail) return failure(400, "invalid_recipient");
  const payloadHash = hashPayload({
    action: RECIPIENT_ACTION,
    clientAccountId,
    expectedRevision: input.expectedRevision,
    recipientEmail,
  });

  return db.$transaction(async (tx) => {
    await lockRequest(tx, input.requestId);
    const prior = await replayPrior(tx, input.requestId, clientAccountId, RECIPIENT_ACTION, payloadHash);
    if (prior) return asRecipient(prior);

    const client = await lockClient(tx, clientAccountId);
    if (!client) return failure(404, "client_not_found");
    const existing = await lockPreference(tx, clientAccountId);
    const currentRevision = existing?.revision ?? 0;
    if (input.expectedRevision !== currentRevision) return failure(409, "revision_conflict");

    if (!existing) {
      await tx.$executeRaw`
        INSERT INTO "ClientDeliveryNotificationPreference" (
          "id",
          "clientAccountId",
          "enabled",
          "channel",
          "recipientEmail",
          "recipientEmailVerifiedAt",
          "enabledAt",
          "disabledAt",
          "revision",
          "createdAt",
          "updatedAt"
        ) VALUES (
          ${randomUUID()},
          ${clientAccountId},
          false,
          'email'::"ClientDeliveryNotificationChannel",
          ${recipientEmail},
          transaction_timestamp(),
          NULL,
          NULL,
          1,
          transaction_timestamp(),
          transaction_timestamp()
        )
      `;
    } else if (existing.recipientEmail === recipientEmail) {
      const updated = await tx.$executeRaw`
        UPDATE "ClientDeliveryNotificationPreference"
        SET
          "recipientEmailVerifiedAt" = transaction_timestamp(),
          "revision" = "revision" + 1,
          "updatedAt" = transaction_timestamp()
        WHERE "clientAccountId" = ${clientAccountId}
          AND "revision" = ${input.expectedRevision}
          AND "recipientEmail" = ${recipientEmail}
      `;
      if (updated !== 1) return failure(409, "revision_conflict");
    } else {
      const updated = await tx.$executeRaw`
        UPDATE "ClientDeliveryNotificationPreference"
        SET
          "recipientEmail" = ${recipientEmail},
          "recipientEmailVerifiedAt" = transaction_timestamp(),
          "enabled" = false,
          "revision" = "revision" + 1,
          "updatedAt" = transaction_timestamp()
        WHERE "clientAccountId" = ${clientAccountId}
          AND "revision" = ${input.expectedRevision}
          AND ("recipientEmail" IS DISTINCT FROM ${recipientEmail})
      `;
      if (updated !== 1) return failure(409, "revision_conflict");
    }

    const saved = recipientBody(await readPreference(tx, clientAccountId));
    await storeResult(tx, input.requestId, clientAccountId, RECIPIENT_ACTION, payloadHash, {
      kind: "recipient",
      ...saved,
    });
    return { ok: true, replayed: false, ...saved };
  }, TRANSACTION);
}

/**
 * Enable or disable the per-client preference. Enable sets enabledAt to the
 * database transaction time. Re-enable advances that clock. Disable keeps
 * enabledAt and does not delete notification history. On is rejected with
 * recipient_not_verified until a verified email recipient exists.
 */
export async function configureDeliveryNotificationPreference(
  db: PrismaClient,
  input: {
    clientAccountId: string;
    requestId: string;
    expectedRevision: number;
    enabled: boolean;
  }
): Promise<DeliveryNotificationPreferenceConfigResult> {
  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) return failure(404, "client_not_found");
  const payloadHash = hashPayload({
    action: PREFERENCE_ACTION,
    clientAccountId,
    expectedRevision: input.expectedRevision,
    enabled: input.enabled,
  });

  return db.$transaction(async (tx) => {
    await lockRequest(tx, input.requestId);
    const prior = await replayPrior(tx, input.requestId, clientAccountId, PREFERENCE_ACTION, payloadHash);
    if (prior) return asPreference(prior);

    const client = await lockClient(tx, clientAccountId);
    if (!client) return failure(404, "client_not_found");
    const existing = await lockPreference(tx, clientAccountId);
    const currentRevision = existing?.revision ?? 0;
    if (input.expectedRevision !== currentRevision) return failure(409, "revision_conflict");

    if (!input.enabled) {
      if (existing?.enabled) {
        const updated = await tx.$executeRaw`
          UPDATE "ClientDeliveryNotificationPreference"
          SET
            "enabled" = false,
            "disabledAt" = transaction_timestamp(),
            "revision" = "revision" + 1,
            "updatedAt" = transaction_timestamp()
          WHERE "clientAccountId" = ${clientAccountId}
            AND "revision" = ${input.expectedRevision}
            AND "enabled" = true
        `;
        if (updated !== 1) return failure(409, "revision_conflict");
        const saved = preferenceBody(await readPreference(tx, clientAccountId));
        await storeResult(tx, input.requestId, clientAccountId, PREFERENCE_ACTION, payloadHash, {
          kind: "preference",
          ...saved,
        });
        return { ok: true, replayed: false, ...saved };
      }
      const saved = existing ? preferenceBody(existing) : disabledPreference(clientAccountId);
      await storeResult(tx, input.requestId, clientAccountId, PREFERENCE_ACTION, payloadHash, {
        kind: "preference",
        ...saved,
      });
      return { ok: true, replayed: false, ...saved };
    }

    const updated = await tx.$executeRaw`
      UPDATE "ClientDeliveryNotificationPreference"
      SET
        "enabled" = true,
        "enabledAt" = transaction_timestamp(),
        "revision" = "revision" + 1,
        "updatedAt" = transaction_timestamp()
      WHERE "clientAccountId" = ${clientAccountId}
        AND "revision" = ${input.expectedRevision}
        AND "enabled" = false
        AND "recipientEmail" IS NOT NULL
        AND btrim("recipientEmail") <> ''
        AND "recipientEmailVerifiedAt" IS NOT NULL
        AND "channel"::text = 'email'
        AND ("enabledAt" IS NULL OR "enabledAt" < transaction_timestamp())
    `;
    if (updated === 1) {
      const saved = preferenceBody(await readPreference(tx, clientAccountId));
      await storeResult(tx, input.requestId, clientAccountId, PREFERENCE_ACTION, payloadHash, {
        kind: "preference",
        ...saved,
      });
      return { ok: true, replayed: false, ...saved };
    }
    if (
      existing?.enabled &&
      existing.recipientEmail &&
      existing.recipientEmailVerifiedAt &&
      existing.channel === "email"
    ) {
      const saved = preferenceBody(existing);
      await storeResult(tx, input.requestId, clientAccountId, PREFERENCE_ACTION, payloadHash, {
        kind: "preference",
        ...saved,
      });
      return { ok: true, replayed: false, ...saved };
    }

    await storeResult(tx, input.requestId, clientAccountId, PREFERENCE_ACTION, payloadHash, {
      kind: "rejected",
      error: "recipient_not_verified",
    });
    return failure(409, "recipient_not_verified");
  }, TRANSACTION);
}

const TRANSACTION = { timeout: 10_000 } as const;

function failure(
  statusCode: DeliveryNotificationConfigFailure["statusCode"],
  error: DeliveryNotificationConfigFailure["error"]
): DeliveryNotificationConfigFailure {
  return { ok: false, statusCode, error, replayed: false };
}

function hashPayload(value: Record<string, unknown>): string {
  const stable: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) stable[key] = value[key];
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

async function lockRequest(tx: Prisma.TransactionClient, requestId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(hashtext(${requestId}))
  `;
}

async function lockClient(
  tx: Prisma.TransactionClient,
  clientAccountId: string
): Promise<{ clientAccountId: string } | null> {
  const rows = await tx.$queryRaw<Array<{ clientAccountId: string }>>`
    SELECT "clientAccountId"
    FROM "ClientAccount"
    WHERE "clientAccountId" = ${clientAccountId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function lockPreference(
  tx: Prisma.TransactionClient,
  clientAccountId: string
): Promise<PreferenceRow | null> {
  await tx.$queryRaw`
    SELECT "clientAccountId"
    FROM "ClientDeliveryNotificationPreference"
    WHERE "clientAccountId" = ${clientAccountId}
    FOR UPDATE
  `;
  return tx.clientDeliveryNotificationPreference.findUnique({ where: { clientAccountId } });
}

async function readPreference(
  tx: Prisma.TransactionClient,
  clientAccountId: string
): Promise<PreferenceRow> {
  return tx.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
}

async function replayPrior(
  tx: Prisma.TransactionClient,
  requestId: string,
  clientAccountId: string,
  action: ConfigAction,
  payloadHash: string
): Promise<DeliveryNotificationRecipientConfigResult | DeliveryNotificationPreferenceConfigResult | null> {
  const prior = await tx.clientDeliveryNotificationConfigRequest.findUnique({ where: { requestId } });
  if (!prior) return null;
  if (prior.clientAccountId !== clientAccountId || prior.action !== action || prior.payloadHash !== payloadHash) {
    return failure(409, "request_id_conflict");
  }
  const stored = readStored(prior.resultJson);
  if (!stored) return failure(409, "request_id_conflict");
  if (stored.kind === "rejected") {
    return { ok: false, statusCode: 409, error: stored.error, replayed: true };
  }
  if (stored.kind === "recipient" && action === RECIPIENT_ACTION) {
    return { ok: true, replayed: true, ...recipientFields(stored) };
  }
  if (stored.kind === "preference" && action === PREFERENCE_ACTION) {
    return { ok: true, replayed: true, ...preferenceFields(stored) };
  }
  return failure(409, "request_id_conflict");
}

function asRecipient(
  result: DeliveryNotificationRecipientConfigResult | DeliveryNotificationPreferenceConfigResult
): DeliveryNotificationRecipientConfigResult {
  if (!result.ok) return result;
  if (!("recipientEmail" in result)) return failure(409, "request_id_conflict");
  return result;
}

function asPreference(
  result: DeliveryNotificationRecipientConfigResult | DeliveryNotificationPreferenceConfigResult
): DeliveryNotificationPreferenceConfigResult {
  if (!result.ok) return result;
  if ("recipientEmail" in result) return failure(409, "request_id_conflict");
  return result;
}

async function storeResult(
  tx: Prisma.TransactionClient,
  requestId: string,
  clientAccountId: string,
  action: ConfigAction,
  payloadHash: string,
  result: StoredResult
): Promise<void> {
  await tx.clientDeliveryNotificationConfigRequest.create({
    data: {
      requestId,
      clientAccountId,
      action,
      payloadHash,
      resultJson: result,
    },
  });
}

function recipientBody(row: PreferenceRow): RecipientFields {
  if (!row.recipientEmail || !row.recipientEmailVerifiedAt || row.channel !== "email") {
    throw new Error("Delivery notification recipient save did not record a verified address.");
  }
  return {
    clientAccountId: row.clientAccountId,
    recipientEmail: row.recipientEmail,
    recipientVerified: true,
    recipientEmailVerifiedAt: row.recipientEmailVerifiedAt.toISOString(),
    enabled: row.enabled,
    enabledAt: iso(row.enabledAt),
    disabledAt: iso(row.disabledAt),
    revision: row.revision,
    channel: "email",
  };
}

function preferenceBody(row: PreferenceRow): PreferenceFields {
  return {
    clientAccountId: row.clientAccountId,
    enabled: row.enabled,
    recipientVerified: Boolean(
      row.recipientEmail && row.recipientEmailVerifiedAt && row.channel === "email"
    ),
    enabledAt: iso(row.enabledAt),
    disabledAt: iso(row.disabledAt),
    revision: row.revision,
    channel: "email",
  };
}

function disabledPreference(clientAccountId: string): PreferenceFields {
  return {
    clientAccountId,
    enabled: false,
    recipientVerified: false,
    enabledAt: null,
    disabledAt: null,
    revision: 0,
    channel: "email",
  };
}

function recipientFields(stored: StoredRecipient): RecipientFields {
  return {
    clientAccountId: stored.clientAccountId,
    recipientEmail: stored.recipientEmail,
    recipientVerified: true,
    recipientEmailVerifiedAt: stored.recipientEmailVerifiedAt,
    enabled: stored.enabled,
    enabledAt: stored.enabledAt,
    disabledAt: stored.disabledAt,
    revision: stored.revision,
    channel: "email",
  };
}

function preferenceFields(stored: StoredPreference): PreferenceFields {
  return {
    clientAccountId: stored.clientAccountId,
    enabled: stored.enabled,
    recipientVerified: stored.recipientVerified,
    enabledAt: stored.enabledAt,
    disabledAt: stored.disabledAt,
    revision: stored.revision,
    channel: "email",
  };
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function readStored(value: Prisma.JsonValue): StoredResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind === "rejected") {
    return row.error === "recipient_not_verified" ? { kind: "rejected", error: "recipient_not_verified" } : null;
  }
  if (row.kind === "recipient") return readRecipient(row);
  if (row.kind === "preference") return readPreferenceStored(row);
  return null;
}

function readRecipient(row: Record<string, unknown>): StoredRecipient | null {
  if (typeof row.clientAccountId !== "string") return null;
  if (typeof row.recipientEmail !== "string") return null;
  if (row.recipientVerified !== true) return null;
  if (typeof row.recipientEmailVerifiedAt !== "string") return null;
  if (typeof row.enabled !== "boolean") return null;
  if (!isNullableString(row.enabledAt) || !isNullableString(row.disabledAt)) return null;
  if (typeof row.revision !== "number" || !Number.isInteger(row.revision)) return null;
  if (row.channel !== "email") return null;
  return {
    kind: "recipient",
    clientAccountId: row.clientAccountId,
    recipientEmail: row.recipientEmail,
    recipientVerified: true,
    recipientEmailVerifiedAt: row.recipientEmailVerifiedAt,
    enabled: row.enabled,
    enabledAt: row.enabledAt,
    disabledAt: row.disabledAt,
    revision: row.revision,
    channel: "email",
  };
}

function readPreferenceStored(row: Record<string, unknown>): StoredPreference | null {
  if (typeof row.clientAccountId !== "string") return null;
  if (typeof row.enabled !== "boolean") return null;
  if (typeof row.recipientVerified !== "boolean") return null;
  if (!isNullableString(row.enabledAt) || !isNullableString(row.disabledAt)) return null;
  if (typeof row.revision !== "number" || !Number.isInteger(row.revision)) return null;
  if (row.channel !== "email") return null;
  return {
    kind: "preference",
    clientAccountId: row.clientAccountId,
    enabled: row.enabled,
    recipientVerified: row.recipientVerified,
    enabledAt: row.enabledAt,
    disabledAt: row.disabledAt,
    revision: row.revision,
    channel: "email",
  };
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
