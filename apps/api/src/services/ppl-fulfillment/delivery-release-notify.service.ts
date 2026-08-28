import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import {
  sendTransactionalEmail,
  type SendTransactionalEmailInput,
  type SendTransactionalEmailResult,
} from "../../lib/transactional-email.js";

export const CUSTOMER_RELEASE_NOTIFY_STATUS = {
  pending: "pending",
  sending: "sending",
  sent: "sent",
  skipped: "skipped",
  failed: "failed",
} as const;

export type CustomerReleaseNotifyStatus =
  (typeof CUSTOMER_RELEASE_NOTIFY_STATUS)[keyof typeof CUSTOMER_RELEASE_NOTIFY_STATUS];

/** Stale in-flight claims may be reclaimed after this window (ambiguous provider / crash). */
export const CUSTOMER_RELEASE_NOTIFY_STALE_CLAIM_MS = 10 * 60 * 1000;

const portalEmailSchema = z.string().trim().email().max(320);

export type DeliveryReleasedEmailInput = {
  accountDisplayName: string;
  orderNumber: string;
  orderId: string;
  portalBaseUrl?: string | null;
};

export type CustomerNotificationView = {
  status: CustomerReleaseNotifyStatus | "in_progress" | "not_released";
  reason?: string;
};

export type NotifyCustomerDeliveryReleasedResult =
  | { ok: true; outcome: "sent"; emailId?: string; recipientDomain?: string }
  | { ok: true; outcome: "skipped"; reason: string }
  | { ok: true; outcome: "already_sent" | "in_progress" | "not_released"; reason?: string }
  | { ok: false; outcome: "failed"; error: string };

export type DeliveryReleaseNotifyDeps = {
  send?: (
    input: SendTransactionalEmailInput
  ) => Promise<SendTransactionalEmailResult>;
  now?: Date;
};

export function isValidCustomerPortalEmail(value: string | null | undefined): value is string {
  if (!value) return false;
  return portalEmailSchema.safeParse(value).success;
}

export function resolvePortalPublicBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const raw =
    env.SA360_PORTAL_PUBLIC_BASE_URL?.trim() || env.ADMIN_COC_BASE_URL?.trim() || "";
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function resolvePortalOrderPath(orderId: string): string {
  return `/portal/orders/${orderId.trim()}`;
}

export function resolvePortalOrderUrl(orderId: string, baseUrl?: string | null): string {
  const path = resolvePortalOrderPath(orderId);
  const base = baseUrl?.trim() ? baseUrl.replace(/\/+$/, "") : "";
  return base ? `${base}${path}` : path;
}

export function buildDeliveryReleasedEmail(input: DeliveryReleasedEmailInput): {
  subject: string;
  text: string;
  html: string;
  portalUrl: string;
} {
  const name = input.accountDisplayName.trim() || "there";
  const orderNumber = input.orderNumber.trim();
  const portalUrl = resolvePortalOrderUrl(input.orderId, input.portalBaseUrl);
  const subject = "Your SA360 order is ready";
  const text = [
    `Hi ${name},`,
    "",
    "Your spreadsheet delivery is ready.",
    "",
    `Order ${orderNumber}`,
    "",
    "Open your order in the portal:",
    portalUrl,
    "",
  ].join("\n");
  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    "<p>Your spreadsheet delivery is ready.</p>",
    `<p>Order ${escapeHtml(orderNumber)}</p>`,
    `<p><a href="${escapeHtml(portalUrl)}">Open your order</a></p>`,
  ].join("");
  return { subject, text, html, portalUrl };
}

export function customerReleaseNotifyClaimWhere(
  exportId: string,
  now: Date,
  staleMs = CUSTOMER_RELEASE_NOTIFY_STALE_CLAIM_MS
): Prisma.LeadDeliveryExportPackageWhereInput {
  const staleBefore = new Date(now.getTime() - staleMs);
  return {
    id: exportId,
    spreadsheetDeliveredAt: { not: null },
    OR: [
      { customerReleaseNotifyStatus: null },
      { customerReleaseNotifyStatus: CUSTOMER_RELEASE_NOTIFY_STATUS.pending },
      { customerReleaseNotifyStatus: CUSTOMER_RELEASE_NOTIFY_STATUS.failed },
      { customerReleaseNotifyStatus: CUSTOMER_RELEASE_NOTIFY_STATUS.skipped },
      {
        AND: [
          { customerReleaseNotifyStatus: CUSTOMER_RELEASE_NOTIFY_STATUS.sending },
          { customerReleaseNotifyClaimedAt: { lt: staleBefore } },
        ],
      },
    ],
  };
}

export function presentCustomerNotification(
  result: NotifyCustomerDeliveryReleasedResult
): CustomerNotificationView {
  if (result.outcome === "sent") return { status: "sent" };
  if (result.outcome === "already_sent") return { status: "sent", reason: "already_sent" };
  if (result.outcome === "skipped") return { status: "skipped", reason: result.reason };
  if (result.outcome === "in_progress") return { status: "in_progress", reason: result.reason };
  if (result.outcome === "not_released") {
    return { status: "not_released", reason: result.reason ?? "not_released" };
  }
  return { status: "failed", reason: result.error };
}

/**
 * Post-commit customer notification for a released package.
 * Never throws to callers. Never sends unless spreadsheetDeliveredAt is set
 * and this process wins a durable claim.
 */
export async function notifyCustomerDeliveryReleased(
  input: { exportId: string },
  db: PrismaClient = prisma,
  deps: DeliveryReleaseNotifyDeps = {}
): Promise<NotifyCustomerDeliveryReleasedResult> {
  const exportId = input.exportId.trim();
  if (!exportId) {
    return { ok: true, outcome: "not_released", reason: "missing_export_id" };
  }

  const now = deps.now ?? new Date();
  const claimed = await db.leadDeliveryExportPackage.updateMany({
    where: customerReleaseNotifyClaimWhere(exportId, now),
    data: {
      customerReleaseNotifyStatus: CUSTOMER_RELEASE_NOTIFY_STATUS.sending,
      customerReleaseNotifyClaimedAt: now,
      customerReleaseNotifyError: null,
    },
  });

  if (claimed.count !== 1) {
    const current = await db.leadDeliveryExportPackage.findUnique({
      where: { id: exportId },
      select: {
        spreadsheetDeliveredAt: true,
        customerReleaseNotifyStatus: true,
      },
    });
    if (!current?.spreadsheetDeliveredAt) {
      logger.info("delivery_release.notify.not_released", { exportId });
      return { ok: true, outcome: "not_released", reason: "spreadsheet_not_released" };
    }
    if (current.customerReleaseNotifyStatus === CUSTOMER_RELEASE_NOTIFY_STATUS.sent) {
      logger.info("delivery_release.notify.already_sent", { exportId });
      return { ok: true, outcome: "already_sent" };
    }
    logger.info("delivery_release.notify.in_progress", {
      exportId,
      status: current.customerReleaseNotifyStatus,
    });
    return {
      ok: true,
      outcome: "in_progress",
      reason: current.customerReleaseNotifyStatus ?? "unknown",
    };
  }

  const packageRow = await db.leadDeliveryExportPackage.findUnique({
    where: { id: exportId },
    select: {
      id: true,
      leadOrderId: true,
      clientAccountId: true,
      spreadsheetDeliveredAt: true,
      leadOrder: {
        select: {
          orderNumber: true,
          clientDisplayName: true,
          clientAccountId: true,
        },
      },
    },
  });

  if (!packageRow?.spreadsheetDeliveredAt) {
    logger.warn("delivery_release.notify.claim_without_release", { exportId });
    return { ok: true, outcome: "not_released", reason: "spreadsheet_not_released" };
  }

  const ownerClientAccountId = packageRow.clientAccountId;
  const account = await db.clientAccount.findUnique({
    where: { clientAccountId: ownerClientAccountId },
    select: {
      clientAccountId: true,
      clientDisplayName: true,
      portalDisplayName: true,
      portalLoginEmail: true,
    },
  });

  const recipient = account?.portalLoginEmail?.trim() ?? "";
  if (!account || !isValidCustomerPortalEmail(recipient)) {
    const reason = account ? "invalid_portal_login_email" : "missing_portal_login_email";
    await db.leadDeliveryExportPackage.update({
      where: { id: exportId },
      data: {
        customerReleaseNotifyStatus: CUSTOMER_RELEASE_NOTIFY_STATUS.skipped,
        customerReleaseNotifyError: reason,
      },
    });
    logger.warn("delivery_release.notify.skipped", {
      exportId,
      orderId: packageRow.leadOrderId,
      clientAccountId: ownerClientAccountId,
      reason,
    });
    return { ok: true, outcome: "skipped", reason };
  }

  const displayName =
    account.portalDisplayName?.trim() ||
    account.clientDisplayName.trim() ||
    packageRow.leadOrder.clientDisplayName?.trim() ||
    "there";

  const email = buildDeliveryReleasedEmail({
    accountDisplayName: displayName,
    orderNumber: packageRow.leadOrder.orderNumber,
    orderId: packageRow.leadOrderId,
    portalBaseUrl: resolvePortalPublicBaseUrl(),
  });

  const send = deps.send ?? sendTransactionalEmail;
  const sendResult = await send({
    to: recipient,
    subject: email.subject,
    text: email.text,
    html: email.html,
    idempotencyKey: `delivery-release:${exportId}`,
  });

  if (sendResult.ok) {
    await db.leadDeliveryExportPackage.update({
      where: { id: exportId },
      data: {
        customerReleaseNotifyStatus: CUSTOMER_RELEASE_NOTIFY_STATUS.sent,
        customerReleaseNotifiedAt: now,
        customerReleaseNotifyProviderId: sendResult.id ?? null,
        customerReleaseNotifyError: null,
      },
    });
    logger.info("delivery_release.notify.sent", {
      exportId,
      orderId: packageRow.leadOrderId,
      clientAccountId: ownerClientAccountId,
      emailId: sendResult.id,
    });
    return {
      ok: true,
      outcome: "sent",
      emailId: sendResult.id,
      recipientDomain: recipientDomain(recipient),
    };
  }

  const error = sendResult.error.slice(0, 300);
  await db.leadDeliveryExportPackage.update({
    where: { id: exportId },
    data: {
      customerReleaseNotifyStatus: CUSTOMER_RELEASE_NOTIFY_STATUS.failed,
      customerReleaseNotifyError: error,
    },
  });
  logger.warn("delivery_release.notify.failed", {
    exportId,
    orderId: packageRow.leadOrderId,
    clientAccountId: ownerClientAccountId,
    error,
    skipped: sendResult.skipped === true,
  });
  return { ok: false, outcome: "failed", error };
}

function recipientDomain(email: string): string | undefined {
  const at = email.lastIndexOf("@");
  if (at < 0) return undefined;
  return email.slice(at + 1).toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
