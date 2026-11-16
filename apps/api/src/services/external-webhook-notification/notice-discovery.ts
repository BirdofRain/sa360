/**
 * Pages persisted HTTP acceptances and records eligible notices.
 * The cursor moves only through acceptances older than the lag, so a
 * transaction that commits late is still seen. Recording is idempotent.
 * This module does not call Resend or Twilio and does not touch
 * scanCanonicalDeliveryNotifications.
 */

import type { PrismaClient } from "@prisma/client";

import { recordEligibleExternalWebhookNotice } from "./notice-receipt.js";
import type { TwilioConfigResult } from "./twilio-programmable-messaging.js";

export const EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED_ENV = "SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED";
export const EXTERNAL_WEBHOOK_NOTICE_DISCOVERY_LAG_MS = 30_000;
export const EXTERNAL_WEBHOOK_NOTICE_DISCOVERY_PAGE = 25;
const CURSOR_ID = "acceptance";

export function isExternalWebhookNoticeDispatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED_ENV]?.trim() === "true";
}

export type NoticeDiscoveryCursor = { httpAcceptedAt: string; attemptId: string } | null;

export async function discoverExternalWebhookNotices(
  db: PrismaClient,
  input: {
    env?: NodeJS.ProcessEnv;
    now?: Date;
    limit?: number;
    enqueue?: (receiptId: string) => Promise<void>;
    emailConfigured?: boolean;
    twilioConfig?: TwilioConfigResult;
  } = {}
): Promise<{ enabled: boolean; scanned: number; enqueued: number; cursor: NoticeDiscoveryCursor; hasMore: boolean }> {
  const env = input.env ?? process.env;
  if (!isExternalWebhookNoticeDispatchEnabled(env)) {
    return { enabled: false, scanned: 0, enqueued: 0, cursor: null, hasMore: false };
  }
  const now = input.now ?? new Date();
  const horizon = new Date(now.getTime() - EXTERNAL_WEBHOOK_NOTICE_DISCOVERY_LAG_MS);
  const limit = input.limit ?? EXTERNAL_WEBHOOK_NOTICE_DISCOVERY_PAGE;
  const stored = await db.externalWebhookNoticeDiscoveryCursor.findUnique({ where: { id: CURSOR_ID } });
  const attempts = await db.externalWebhookDeliveryAttempt.findMany({
    where: {
      state: "attempted",
      outcome: "http_accepted",
      requestLeftSa360: true,
      httpStatus: { gte: 200, lte: 299 },
      httpAcceptedAt: {
        not: null,
        lte: horizon,
        ...(stored?.lastHttpAcceptedAt ? { gte: stored.lastHttpAcceptedAt } : {}),
      },
    },
    orderBy: [{ httpAcceptedAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    select: { id: true, httpAcceptedAt: true },
  });
  const page = attempts.filter((row) => {
    if (!stored?.lastHttpAcceptedAt || !stored.lastAttemptId || !row.httpAcceptedAt) return true;
    if (row.httpAcceptedAt > stored.lastHttpAcceptedAt) return true;
    return row.httpAcceptedAt.getTime() === stored.lastHttpAcceptedAt.getTime() && row.id > stored.lastAttemptId;
  }).slice(0, limit);
  let enqueued = 0;
  let last: { id: string; httpAcceptedAt: Date } | null = null;
  for (const attempt of page) {
    if (!attempt.httpAcceptedAt) continue;
    for (const channel of ["email", "sms"] as const) {
      const recorded = await recordEligibleExternalWebhookNotice(db, { attemptId: attempt.id, channel }, {
        emailConfigured: input.emailConfigured,
        twilioConfig: input.twilioConfig,
        env,
      });
      if (recorded.ok && recorded.receipt.status === "pending") {
        if (input.enqueue) await input.enqueue(recorded.receipt.id);
        enqueued += 1;
      }
    }
    last = { id: attempt.id, httpAcceptedAt: attempt.httpAcceptedAt };
  }
  if (last) {
    await db.externalWebhookNoticeDiscoveryCursor.upsert({
      where: { id: CURSOR_ID },
      create: { id: CURSOR_ID, lastHttpAcceptedAt: last.httpAcceptedAt, lastAttemptId: last.id, updatedAt: now },
      update: { lastHttpAcceptedAt: last.httpAcceptedAt, lastAttemptId: last.id },
    });
  }
  return {
    enabled: true,
    scanned: page.length,
    enqueued,
    cursor: last ? { httpAcceptedAt: last.httpAcceptedAt.toISOString(), attemptId: last.id } : null,
    hasMore: attempts.length > limit,
  };
}
