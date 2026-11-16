/**
 * Pages persisted HTTP acceptances and records eligible notices.
 * The forward cursor is a keyset on (httpAcceptedAt, id). A 30 second lag
 * only keeps a brand-new acceptance on the next forward page. It is not the
 * correctness guarantee. Attempts the cursor has already passed, and that
 * still have no receipt and no ineligible decision, are reconciled on every
 * run. Recording is idempotent, so a replay does not create a second receipt.
 * This module does not call Resend or Twilio and does not touch
 * scanCanonicalDeliveryNotifications.
 */

import type { PrismaClient } from "@prisma/client";

import { recordEligibleExternalWebhookNotice } from "./notice-receipt.js";
import type { NotificationSkipReason } from "./notification-contract.js";
import type { TwilioConfigResult } from "./twilio-programmable-messaging.js";

export const EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED_ENV = "SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED";
export const EXTERNAL_WEBHOOK_NOTICE_DISCOVERY_LAG_MS = 30_000;
export const EXTERNAL_WEBHOOK_NOTICE_DISCOVERY_PAGE = 25;
/** How long a restricted role keeps rechecking an ineligible decision. */
export const EXTERNAL_WEBHOOK_NOTICE_RESTRICTED_REVISIT_MS = 15 * 60 * 1000;
const CURSOR_ID = "acceptance";

/**
 * Reasons that cannot become a send later without violating the acceptedAt
 * clock, or that were already ineligible when the acceptance committed.
 * Provider outages are absent: those stay pending receipts and are retried.
 */
const DURABLE_INELIGIBLE = new Set<NotificationSkipReason>([
  "not_opted_in",
  "stop_unknown",
  "invalid_e164",
  "invalid_recipient",
  "recipient_not_verified",
  "eligibility_unknown",
  "template_rejected",
  "invalid_event",
  "key_too_long",
]);

/** These can change when a transaction that was already open commits a preference. */
const REVISITABLE = new Set<NotificationSkipReason>([
  "not_opted_in",
  "stop_unknown",
  "invalid_e164",
  "invalid_recipient",
  "recipient_not_verified",
  "eligibility_unknown",
]);

export function isExternalWebhookNoticeDispatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED_ENV]?.trim() === "true";
}

export type NoticeDiscoveryCursor = { httpAcceptedAt: string; attemptId: string } | null;

type AttemptKey = { id: string; httpAcceptedAt: Date };

export async function discoverExternalWebhookNotices(
  db: PrismaClient,
  input: {
    env?: NodeJS.ProcessEnv;
    now?: Date;
    limit?: number;
    enqueue?: (receiptId: string) => Promise<unknown>;
    /** Test seam. Production reads the database role and does not grant extra privileges. */
    transactionVisibility?: "snapshot" | "restricted";
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
  let enqueued = 0;
  let scanned = 0;

  const visibility = input.transactionVisibility ?? (await externalWebhookNoticeTransactionVisibility(db));
  const revisitAfter =
    visibility === "restricted"
      ? new Date(now.getTime() + EXTERNAL_WEBHOOK_NOTICE_RESTRICTED_REVISIT_MS)
      : await oldestOtherTransactionStart(db);
  if (visibility === "snapshot" && stored?.lastHttpAcceptedAt && stored.lastAttemptId != null) {
    await releaseSettledDecisions(db, stored.lastHttpAcceptedAt, stored.lastAttemptId);
  }
  if (visibility === "restricted") {
    const changed = await recheckProvisionalDecisions(db, now, limit, env, input, (receiptId) => {
      enqueued += 1;
      return input.enqueue?.(receiptId) ?? Promise.resolve();
    });
    scanned += changed;
    if (changed === limit) {
      return {
        enabled: true,
        scanned,
        enqueued,
        cursor: storedCursor(stored),
        hasMore: true,
      };
    }
  }
  const holes =
    stored?.lastHttpAcceptedAt && stored.lastAttemptId != null
      ? await findUncoveredAcceptances(db, stored.lastHttpAcceptedAt, stored.lastAttemptId, limit)
      : [];
  let halted = false;
  for (const attempt of holes) {
    scanned += 1;
    const settled = await settleAttempt(db, attempt, env, input, revisitAfter, (receiptId) => {
      enqueued += 1;
      return input.enqueue?.(receiptId) ?? Promise.resolve();
    });
    if (!settled) {
      halted = true;
      break;
    }
  }
  if (holes.length === limit || halted) {
    return {
      enabled: true,
      scanned,
      enqueued,
      cursor: storedCursor(stored),
      hasMore: true,
    };
  }

  const after = stored?.lastHttpAcceptedAt && stored.lastAttemptId != null
    ? { httpAcceptedAt: stored.lastHttpAcceptedAt, attemptId: stored.lastAttemptId }
    : null;
  const fetched = await db.externalWebhookDeliveryAttempt.findMany({
    where: forwardWhere(horizon, after),
    orderBy: [{ httpAcceptedAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    select: { id: true, httpAcceptedAt: true },
  });
  const page = fetched.slice(0, limit);
  let advanced: AttemptKey | null = null;
  for (const attempt of page) {
    if (!attempt.httpAcceptedAt) continue;
    scanned += 1;
    const settled = await settleAttempt(db, { id: attempt.id, httpAcceptedAt: attempt.httpAcceptedAt }, env, input, revisitAfter, (receiptId) => {
      enqueued += 1;
      return input.enqueue?.(receiptId) ?? Promise.resolve();
    });
    if (!settled) {
      halted = true;
      break;
    }
    advanced = { id: attempt.id, httpAcceptedAt: attempt.httpAcceptedAt };
  }
  if (advanced) {
    await db.externalWebhookNoticeDiscoveryCursor.upsert({
      where: { id: CURSOR_ID },
      create: {
        id: CURSOR_ID,
        lastHttpAcceptedAt: advanced.httpAcceptedAt,
        lastAttemptId: advanced.id,
        updatedAt: now,
      },
      update: { lastHttpAcceptedAt: advanced.httpAcceptedAt, lastAttemptId: advanced.id },
    });
  }
  const cursor = advanced
    ? { httpAcceptedAt: advanced.httpAcceptedAt.toISOString(), attemptId: advanced.id }
    : storedCursor(stored);
  return {
    enabled: true,
    scanned,
    enqueued,
    cursor,
    hasMore: halted || fetched.length > limit,
  };
}

function storedCursor(
  stored: { lastHttpAcceptedAt: Date | null; lastAttemptId: string | null } | null
): NoticeDiscoveryCursor {
  if (!stored?.lastHttpAcceptedAt || stored.lastAttemptId == null) return null;
  return { httpAcceptedAt: stored.lastHttpAcceptedAt.toISOString(), attemptId: stored.lastAttemptId };
}

function forwardWhere(
  horizon: Date,
  after: { httpAcceptedAt: Date; attemptId: string } | null
) {
  const accepted = {
    state: "attempted" as const,
    outcome: "http_accepted" as const,
    requestLeftSa360: true,
    httpStatus: { gte: 200, lte: 299 },
    httpAcceptedAt: { not: null, lte: horizon },
  };
  if (!after) return accepted;
  return {
    AND: [
      accepted,
      {
        OR: [
          { httpAcceptedAt: { gt: after.httpAcceptedAt } },
          { AND: [{ httpAcceptedAt: after.httpAcceptedAt }, { id: { gt: after.attemptId } }] },
        ],
      },
    ],
  };
}

async function findUncoveredAcceptances(
  db: PrismaClient,
  cursorAt: Date,
  cursorId: string,
  limit: number
): Promise<AttemptKey[]> {
  return db.$queryRaw<AttemptKey[]>`
    SELECT a.id, a."httpAcceptedAt"
    FROM "ExternalWebhookDeliveryAttempt" a
    WHERE a.state = 'attempted'
      AND a.outcome = 'http_accepted'
      AND a."requestLeftSa360" = true
      AND a."httpStatus" BETWEEN 200 AND 299
      AND a."httpAcceptedAt" IS NOT NULL
      AND (a."httpAcceptedAt", a.id) <= (${cursorAt}, ${cursorId})
      AND (
        (
          NOT EXISTS (
            SELECT 1 FROM "ExternalWebhookNotificationReceipt" r
            WHERE r."attemptId" = a.id
              AND r.channel = 'email'::"ExternalWebhookNoticeChannel"
          )
          AND NOT EXISTS (
            SELECT 1 FROM "ExternalWebhookNoticeChannelDecision" d
            WHERE d."attemptId" = a.id
              AND d.channel = 'email'::"ExternalWebhookNoticeChannel"
          )
        )
        OR (
          NOT EXISTS (
            SELECT 1 FROM "ExternalWebhookNotificationReceipt" r
            WHERE r."attemptId" = a.id
              AND r.channel = 'sms'::"ExternalWebhookNoticeChannel"
          )
          AND NOT EXISTS (
            SELECT 1 FROM "ExternalWebhookNoticeChannelDecision" d
            WHERE d."attemptId" = a.id
              AND d.channel = 'sms'::"ExternalWebhookNoticeChannel"
          )
        )
      )
    ORDER BY a."httpAcceptedAt" ASC, a.id ASC
    LIMIT ${limit}
  `;
}

/**
 * `snapshot` when this role can read open-transaction times for sessions it is
 * allowed to see. A normal application role sees its own other sessions, which
 * is enough for preference and acceptance transactions it writes. This does
 * not grant pg_monitor or pg_read_all_stats. `restricted` is the fail-safe
 * when that catalog read fails: ineligible decisions are rechecked for 15 minutes.
 * A transaction owned by a different role can still be invisible.
 */
export async function externalWebhookNoticeTransactionVisibility(
  db: PrismaClient
): Promise<"snapshot" | "restricted"> {
  try {
    const rows = await db.$queryRaw<Array<{ ok: number }>>`
      SELECT 1 AS ok
      FROM pg_roles
      WHERE rolname = current_user
    `;
    return rows[0] ? "snapshot" : "restricted";
  } catch {
    return "restricted";
  }
}

/** True only for superuser or an explicit stats role. Same-role sessions do not require it. */
export async function externalWebhookNoticeRoleSeesAllTransactions(db: PrismaClient): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ seesAll: boolean }>>`
    SELECT (
      rolsuper
      OR pg_has_role(oid, 'pg_read_all_stats', 'MEMBER')
      OR pg_has_role(oid, 'pg_monitor', 'MEMBER')
    ) AS "seesAll"
    FROM pg_roles
    WHERE rolname = current_user
  `;
  return rows[0]?.seesAll === true;
}

async function recheckProvisionalDecisions(
  db: PrismaClient,
  now: Date,
  limit: number,
  env: NodeJS.ProcessEnv,
  input: { emailConfigured?: boolean; twilioConfig?: TwilioConfigResult },
  onPending: (receiptId: string) => Promise<unknown>
): Promise<number> {
  const rows = await db.externalWebhookNoticeChannelDecision.findMany({
    where: { revisitAfter: { gt: now }, reason: { in: [...REVISITABLE] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, attemptId: true, channel: true },
  });
  let changed = 0;
  for (const row of rows) {
    if (row.channel !== "email" && row.channel !== "sms") continue;
    const recorded = await recordEligibleExternalWebhookNotice(
      db,
      { attemptId: row.attemptId, channel: row.channel },
      { emailConfigured: input.emailConfigured, twilioConfig: input.twilioConfig, env }
    );
    if (!recorded.ok) continue;
    await db.externalWebhookNoticeChannelDecision.delete({ where: { id: row.id } });
    if (recorded.receipt.status === "pending") await onPending(recorded.receipt.id);
    changed += 1;
  }
  return changed;
}

async function oldestOtherTransactionStart(db: PrismaClient): Promise<Date | null> {
  try {
    const rows = await db.$queryRaw<Array<{ oldest: Date | null }>>`
      SELECT min(xact_start) AS oldest
      FROM pg_stat_activity
      WHERE xact_start IS NOT NULL
        AND pid <> pg_backend_pid()
    `;
    return rows[0]?.oldest ?? null;
  } catch {
    return null;
  }
}

async function releaseSettledDecisions(db: PrismaClient, cursorAt: Date, cursorId: string): Promise<void> {
  try {
    await db.$executeRaw`
      DELETE FROM "ExternalWebhookNoticeChannelDecision" d
      USING "ExternalWebhookDeliveryAttempt" a
      WHERE d."attemptId" = a.id
        AND d."revisitAfter" IS NOT NULL
        AND (a."httpAcceptedAt", a.id) <= (${cursorAt}, ${cursorId})
        AND NOT EXISTS (
          SELECT 1 FROM pg_stat_activity s
          WHERE s.xact_start IS NOT NULL
            AND s.pid <> pg_backend_pid()
            AND s.xact_start <= d."revisitAfter"
        )
    `;
  } catch {
    // Without a transaction snapshot the existing decision stays in place.
  }
}

async function settleAttempt(
  db: PrismaClient,
  attempt: AttemptKey,
  env: NodeJS.ProcessEnv,
  input: { emailConfigured?: boolean; twilioConfig?: TwilioConfigResult },
  revisitAfter: Date | null,
  onPending: (receiptId: string) => Promise<unknown>
): Promise<boolean> {
  for (const channel of ["email", "sms"] as const) {
    const recorded = await recordEligibleExternalWebhookNotice(
      db,
      { attemptId: attempt.id, channel },
      { emailConfigured: input.emailConfigured, twilioConfig: input.twilioConfig, env }
    );
    if (recorded.ok) {
      if (recorded.receipt.status === "pending") await onPending(recorded.receipt.id);
      continue;
    }
    if (!isDurableIneligible(recorded.reason)) return false;
    await db.externalWebhookNoticeChannelDecision.upsert({
      where: { attemptId_channel: { attemptId: attempt.id, channel } },
      create: {
        attemptId: attempt.id,
        channel,
        reason: recorded.reason,
        revisitAfter: REVISITABLE.has(recorded.reason) ? revisitAfter : null,
      },
      update: {},
    });
  }
  return true;
}

function isDurableIneligible(reason: NotificationSkipReason): reason is NotificationSkipReason {
  return DURABLE_INELIGIBLE.has(reason) && /^[a-z0-9_]{1,80}$/.test(reason);
}
