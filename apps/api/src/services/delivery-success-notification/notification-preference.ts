import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

const RECIPIENT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type DeliveryNotificationPreferenceView = {
  clientAccountId: string;
  enabled: boolean;
  channel: "email";
  recipientEmail: string | null;
  recipientEmailVerifiedAt: Date | null;
  enabledAt: Date | null;
  disabledAt: Date | null;
  revision: number;
};

export type DeliveryNotificationPreferenceResult =
  | { ok: true; preference: DeliveryNotificationPreferenceView }
  | { ok: false; code: "client_not_found" | "invalid_recipient" | "recipient_not_verified" };

/**
 * Record one admin-verified mailbox. The verification timestamp is the
 * database transaction time. Changing the address forces enabled false and
 * does not move enabledAt backward. This function does not send mail and
 * does not copy portalLoginEmail.
 */
export async function saveDeliveryNotificationRecipient(
  db: PrismaClient,
  input: { clientAccountId: string; recipientEmail: string }
): Promise<DeliveryNotificationPreferenceResult> {
  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) return { ok: false, code: "client_not_found" };
  const recipientEmail = normalizeRecipientEmail(input.recipientEmail);
  if (!recipientEmail) return { ok: false, code: "invalid_recipient" };

  return db.$transaction(async (tx) => {
    const client = await tx.clientAccount.findUnique({
      where: { clientAccountId },
      select: { clientAccountId: true },
    });
    if (!client) return { ok: false, code: "client_not_found" };

    const existing = await tx.clientDeliveryNotificationPreference.findUnique({
      where: { clientAccountId },
    });
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
      await tx.$executeRaw`
        UPDATE "ClientDeliveryNotificationPreference"
        SET
          "recipientEmailVerifiedAt" = transaction_timestamp(),
          "revision" = "revision" + 1,
          "updatedAt" = transaction_timestamp()
        WHERE "clientAccountId" = ${clientAccountId}
      `;
    } else {
      await tx.$executeRaw`
        UPDATE "ClientDeliveryNotificationPreference"
        SET
          "recipientEmail" = ${recipientEmail},
          "recipientEmailVerifiedAt" = transaction_timestamp(),
          "enabled" = false,
          "revision" = "revision" + 1,
          "updatedAt" = transaction_timestamp()
        WHERE "clientAccountId" = ${clientAccountId}
      `;
    }
    return { ok: true, preference: await readPreference(tx, clientAccountId) };
  });
}

/**
 * Off-to-on sets enabledAt to transaction_timestamp(). A caller cannot pass a
 * clock. Re-enabling advances enabledAt only when that timestamp is later.
 * Already-on is a no-op. Missing or unverified recipients stay disabled.
 */
export async function setDeliveryNotificationEnabled(
  db: PrismaClient,
  input: { clientAccountId: string; enabled: boolean }
): Promise<DeliveryNotificationPreferenceResult> {
  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) return { ok: false, code: "client_not_found" };

  return db.$transaction(async (tx) => {
    const client = await tx.clientAccount.findUnique({
      where: { clientAccountId },
      select: { clientAccountId: true },
    });
    if (!client) return { ok: false, code: "client_not_found" };

    if (!input.enabled) {
      await tx.$executeRaw`
        UPDATE "ClientDeliveryNotificationPreference"
        SET
          "enabled" = false,
          "disabledAt" = transaction_timestamp(),
          "revision" = "revision" + 1,
          "updatedAt" = transaction_timestamp()
        WHERE "clientAccountId" = ${clientAccountId}
          AND "enabled" = true
      `;
      const preference = await tx.clientDeliveryNotificationPreference.findUnique({
        where: { clientAccountId },
      });
      if (!preference) {
        return { ok: true, preference: disabledView(clientAccountId) };
      }
      return { ok: true, preference: toView(preference) };
    }

    const updated = await tx.$executeRaw`
      UPDATE "ClientDeliveryNotificationPreference"
      SET
        "enabled" = true,
        "enabledAt" = transaction_timestamp(),
        "revision" = "revision" + 1,
        "updatedAt" = transaction_timestamp()
      WHERE "clientAccountId" = ${clientAccountId}
        AND "enabled" = false
        AND "recipientEmail" IS NOT NULL
        AND btrim("recipientEmail") <> ''
        AND "recipientEmailVerifiedAt" IS NOT NULL
        AND "channel"::text = 'email'
        AND ("enabledAt" IS NULL OR "enabledAt" < transaction_timestamp())
    `;
    const preference = await tx.clientDeliveryNotificationPreference.findUnique({
      where: { clientAccountId },
    });
    if (updated === 1 && preference?.enabled) {
      return { ok: true, preference: toView(preference) };
    }
    if (preference?.enabled && preference.recipientEmail && preference.recipientEmailVerifiedAt) {
      return { ok: true, preference: toView(preference) };
    }
    return { ok: false, code: "recipient_not_verified" };
  });
}

export function normalizeRecipientEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!RECIPIENT_EMAIL.test(email)) return null;
  if (email.includes(",") || email.includes(";") || email.includes("<") || email.includes(">")) {
    return null;
  }
  return email;
}

function disabledView(clientAccountId: string): DeliveryNotificationPreferenceView {
  return {
    clientAccountId,
    enabled: false,
    channel: "email",
    recipientEmail: null,
    recipientEmailVerifiedAt: null,
    enabledAt: null,
    disabledAt: null,
    revision: 0,
  };
}

async function readPreference(
  tx: Pick<PrismaClient, "clientDeliveryNotificationPreference">,
  clientAccountId: string
): Promise<DeliveryNotificationPreferenceView> {
  const preference = await tx.clientDeliveryNotificationPreference.findUniqueOrThrow({
    where: { clientAccountId },
  });
  return toView(preference);
}

function toView(preference: {
  clientAccountId: string;
  enabled: boolean;
  channel: "email";
  recipientEmail: string | null;
  recipientEmailVerifiedAt: Date | null;
  enabledAt: Date | null;
  disabledAt: Date | null;
  revision: number;
}): DeliveryNotificationPreferenceView {
  return {
    clientAccountId: preference.clientAccountId,
    enabled: preference.enabled,
    channel: "email",
    recipientEmail: preference.recipientEmail,
    recipientEmailVerifiedAt: preference.recipientEmailVerifiedAt,
    enabledAt: preference.enabledAt,
    disabledAt: preference.disabledAt,
    revision: preference.revision,
  };
}
