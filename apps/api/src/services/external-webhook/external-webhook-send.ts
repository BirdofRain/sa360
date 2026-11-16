import { isIP } from "node:net";

import type { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  decryptExternalWebhookSigningSecret,
  decryptExternalWebhookUrl,
} from "../../lib/external-webhook-credentials.js";
import {
  EXTERNAL_WEBHOOK_MAX_RESPONSE_BYTES,
  EXTERNAL_WEBHOOK_POST_TIMEOUT_MS,
  postPinnedHttps,
  type PinnedHttpsRequest,
  type PinnedHttpsResult,
} from "../../lib/external-webhook-http.js";
import {
  nodeExternalWebhookResolver,
  validateExternalWebhookUrl,
  type ExternalWebhookResolver,
} from "../../lib/external-webhook-url-policy.js";
import { logger } from "../../lib/logger.js";
import {
  assessPrimaryCrmDelivery,
  classifyExternalWebhookResponse,
  externalWebhookRequestHeaders,
  isExternalWebhookDeliveryEnabled,
  signExternalWebhookBody,
  EXTERNAL_WEBHOOK_PAYLOAD_CONTRACT_VERSION,
} from "./external-webhook-contract.js";

/** A sending row younger than this is still the in-flight POST. Recovery does not claim it. */
export const EXTERNAL_WEBHOOK_STALE_SEND_LEASE_MS = 120_000;

/** Total claims, including the first. The last never-left failure becomes terminal failed. */
export const EXTERNAL_WEBHOOK_MAX_SENDS = 3;

/** Minimum age of a retryable receipt before another claim. */
export const EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS = 30_000;

export type ExternalWebhookPost = (input: PinnedHttpsRequest) => Promise<PinnedHttpsResult>;

type SendDb = Prisma.TransactionClient | typeof prisma;

/**
 * Claims one recorded or backoff-eligible retryable attempt and POSTs the frozen bytes.
 * Retryable means the request never left. Uncertain, failed, and http_accepted are not claimed.
 * A destination revision or fingerprint change refuses the POST.
 * Flag off returns before any resolver or socket call.
 */
export async function deliverExternalWebhookAttempt(
  attemptId: string,
  deps: {
    env?: NodeJS.ProcessEnv;
    resolve?: ExternalWebhookResolver;
    post?: ExternalWebhookPost;
    db?: SendDb;
    now?: Date;
  } = {}
): Promise<{ ok: true; skipped?: string; outcome?: string }> {
  const env = deps.env ?? process.env;
  if (!isExternalWebhookDeliveryEnabled(env)) {
    return { ok: true, skipped: "flag_off" };
  }
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  const claimed = await claimExternalWebhookAttempt(db, attemptId, now);
  if (!claimed) return { ok: true, skipped: "not_claimable" };

  const resolve = deps.resolve ?? nodeExternalWebhookResolver;
  const post = deps.post ?? postPinnedHttps;
  try {
    return await sendClaimedAttempt(db, attemptId, resolve, post);
  } catch (err) {
    logger.warn("external_webhook.send_failed", {
      attemptId,
      errorName: err instanceof Error ? err.name : "Error",
    });
    await finalize(db, attemptId, {
      outcome: "uncertain",
      httpStatus: null,
      requestLeftSa360: true,
      proves: [],
    });
    return { ok: true, outcome: "uncertain" };
  }
}

async function sendClaimedAttempt(
  db: SendDb,
  attemptId: string,
  resolve: ExternalWebhookResolver,
  post: ExternalWebhookPost
): Promise<{ ok: true; skipped?: string; outcome?: string }> {
  const attempt = await db.externalWebhookDeliveryAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt || attempt.state !== "sending") return { ok: true, skipped: "not_sending" };
  const destination = await db.clientExternalWebhookDestination.findUnique({
    where: { id: attempt.destinationId },
  });
  const ghl = destination
    ? await db.clientGhlDestination.findUnique({ where: { clientAccountId: destination.clientAccountId } })
    : null;
  const sameTarget =
    destination !== null &&
    destination.enabled === true &&
    destination.revision === attempt.destinationRevision &&
    destination.endpointUrlFingerprint === attempt.endpointUrlFingerprint &&
    destination.endpointHost === attempt.endpointHost &&
    destination.kind === attempt.kind;
  if (!sameTarget || !destination || !assessPrimaryCrmDelivery({ ghl, externalWebhookEnabled: true }).ok) {
    await finalize(db, attemptId, {
      outcome: "failed",
      httpStatus: null,
      requestLeftSa360: false,
      proves: [],
    });
    logger.info("external_webhook.send_refused", {
      attemptId,
      code: !destination || destination.enabled !== true
        ? "destination_disabled"
        : sameTarget
          ? "duplicate_primary_crm"
          : "destination_changed",
    });
    return { ok: true, outcome: "failed" };
  }

  let canonicalUrl: string;
  try {
    canonicalUrl = decryptExternalWebhookUrl(destination.endpointUrlCiphertext);
  } catch {
    await finalize(db, attemptId, {
      outcome: "failed",
      httpStatus: null,
      requestLeftSa360: false,
      proves: [],
    });
    return { ok: true, outcome: "failed" };
  }
  const accepted = await validateExternalWebhookUrl(canonicalUrl, resolve);
  if (!accepted.ok || accepted.hostname !== destination.endpointHost) {
    await finalize(db, attemptId, {
      outcome: "failed",
      httpStatus: null,
      requestLeftSa360: false,
      proves: [],
    });
    logger.info("external_webhook.send_refused", {
      attemptId,
      code: accepted.ok ? "host_mismatch" : accepted.code,
    });
    return { ok: true, outcome: "failed" };
  }
  const pinnedAddress = accepted.addresses[0];
  const family = pinnedAddress ? isIP(pinnedAddress) : 0;
  if (!pinnedAddress || (family !== 4 && family !== 6)) {
    await finalize(db, attemptId, {
      outcome: "failed",
      httpStatus: null,
      requestLeftSa360: false,
      proves: [],
    });
    return { ok: true, outcome: "failed" };
  }

  let signature: string | null = null;
  if (destination.authMode === "hmac_sha256") {
    if (!destination.signingSecretCiphertext) {
      await finalize(db, attemptId, {
        outcome: "failed",
        httpStatus: null,
        requestLeftSa360: false,
        proves: [],
      });
      return { ok: true, outcome: "failed" };
    }
    try {
      const secret = decryptExternalWebhookSigningSecret(destination.signingSecretCiphertext);
      signature = signExternalWebhookBody(secret, attempt.payloadCanonicalJson);
    } catch {
      await finalize(db, attemptId, {
        outcome: "failed",
        httpStatus: null,
        requestLeftSa360: false,
        proves: [],
      });
      return { ok: true, outcome: "failed" };
    }
  }

  const target = new URL(accepted.canonicalUrl);
  const headers = externalWebhookRequestHeaders({
    contractVersion: EXTERNAL_WEBHOOK_PAYLOAD_CONTRACT_VERSION,
    idempotencyKey: attempt.idempotencyKey,
    mappingMode: attempt.mappingMode,
    mappingContentKey: attempt.columnMapContentKey,
    destinationKind: attempt.kind,
    destinationRevision: attempt.destinationRevision,
    signature,
  });
  const result = await post({
    hostname: accepted.hostname,
    port: target.port ? Number(target.port) : 443,
    pathAndQuery: `${target.pathname}${target.search}`,
    pinnedAddress,
    addressFamily: family,
    body: attempt.payloadCanonicalJson,
    headers,
    timeoutMs: EXTERNAL_WEBHOOK_POST_TIMEOUT_MS,
    maxResponseBytes: EXTERNAL_WEBHOOK_MAX_RESPONSE_BYTES,
  });
  const classified = classifyExternalWebhookResponse({
    requestLeftSa360: result.requestLeftSa360,
    httpStatus: result.refusedRedirect ? result.httpStatus : result.httpStatus,
    timedOut: result.timedOut,
  });
  if (!classified.ok) {
    await finalize(db, attemptId, {
      outcome: "uncertain",
      httpStatus: result.requestLeftSa360 ? result.httpStatus : null,
      requestLeftSa360: result.requestLeftSa360,
      proves: [],
    });
    return { ok: true, outcome: "uncertain" };
  }
  const current = await db.externalWebhookDeliveryAttempt.findUnique({
    where: { id: attemptId },
    select: { sendCount: true },
  });
  const exhausted =
    classified.receipt.outcome === "retryable" &&
    (current?.sendCount ?? EXTERNAL_WEBHOOK_MAX_SENDS) >= EXTERNAL_WEBHOOK_MAX_SENDS;
  await finalize(db, attemptId, {
    outcome: exhausted ? "failed" : classified.receipt.outcome,
    httpStatus: classified.receipt.httpStatus,
    requestLeftSa360: classified.receipt.requestLeftSa360,
    proves: exhausted ? [] : classified.receipt.proves,
  });
  const outcome = exhausted ? "failed" : classified.receipt.outcome;
  if (exhausted) {
    logger.info("external_webhook.retry_exhausted", { attemptId, sendCount: current?.sendCount ?? null });
  }
  logger.info("external_webhook.send_result", {
    attemptId,
    outcome,
    httpStatus: classified.receipt.httpStatus,
  });
  return { ok: true, outcome };
}

export async function promoteStaleExternalWebhookSends(
  now: Date = new Date(),
  leaseMs: number = EXTERNAL_WEBHOOK_STALE_SEND_LEASE_MS,
  db: SendDb = prisma
): Promise<{ promoted: number }> {
  const cutoff = new Date(now.getTime() - leaseMs);
  const promoted = await db.externalWebhookDeliveryAttempt.updateMany({
    where: { state: "sending", updatedAt: { lt: cutoff } },
    data: {
      state: "attempted",
      outcome: "uncertain",
      requestLeftSa360: true,
      httpStatus: null,
      proves: [],
    },
  });
  return { promoted: promoted.count };
}

export async function listRecordedExternalWebhookAttemptIds(
  limit = 25,
  db: SendDb = prisma
): Promise<string[]> {
  const rows = await db.externalWebhookDeliveryAttempt.findMany({
    where: { state: "recorded" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * Recorded rows, plus retryable rows whose request never left and whose backoff has elapsed.
 * Disabled destinations are omitted. Uncertain, failed, and http_accepted rows are omitted.
 */
export async function listRecoverableExternalWebhookAttemptIds(
  limit = 25,
  db: SendDb = prisma,
  now: Date = new Date()
): Promise<string[]> {
  const retryReadyAt = new Date(now.getTime() - EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS);
  const rows = await db.externalWebhookDeliveryAttempt.findMany({
    where: {
      destination: { enabled: true },
      OR: [
        { state: "recorded" },
        {
          state: "attempted",
          outcome: "retryable",
          requestLeftSa360: false,
          sendCount: { lt: EXTERNAL_WEBHOOK_MAX_SENDS },
          updatedAt: { lte: retryReadyAt },
        },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

async function claimExternalWebhookAttempt(db: SendDb, attemptId: string, now: Date): Promise<boolean> {
  const recorded = await db.externalWebhookDeliveryAttempt.updateMany({
    where: { id: attemptId, state: "recorded" },
    data: { state: "sending", sendCount: { increment: 1 } },
  });
  if (recorded.count === 1) return true;
  const retryReadyAt = new Date(now.getTime() - EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS);
  const retry = await db.externalWebhookDeliveryAttempt.updateMany({
    where: {
      id: attemptId,
      state: "attempted",
      outcome: "retryable",
      requestLeftSa360: false,
      sendCount: { lt: EXTERNAL_WEBHOOK_MAX_SENDS },
      updatedAt: { lte: retryReadyAt },
    },
    data: {
      state: "sending",
      outcome: null,
      httpStatus: null,
      proves: [],
      sendCount: { increment: 1 },
    },
  });
  return retry.count === 1;
}

async function finalize(
  db: SendDb,
  attemptId: string,
  receipt: {
    outcome: "http_accepted" | "retryable" | "failed" | "uncertain";
    httpStatus: number | null;
    requestLeftSa360: boolean;
    proves: readonly string[];
  }
): Promise<void> {
  await db.externalWebhookDeliveryAttempt.updateMany({
    where: { id: attemptId, state: "sending" },
    data: {
      state: "attempted",
      outcome: receipt.outcome,
      httpStatus: receipt.httpStatus,
      requestLeftSa360: receipt.requestLeftSa360,
      proves: [...receipt.proves],
    },
  });
}
