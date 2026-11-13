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

const STALE_SEND_LEASE_MS = 120_000;

export type ExternalWebhookPost = (input: PinnedHttpsRequest) => Promise<PinnedHttpsResult>;

type SendDb = Prisma.TransactionClient | typeof prisma;

/**
 * Claims one recorded attempt and POSTs the frozen bytes.
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
  } = {}
): Promise<{ ok: true; skipped?: string; outcome?: string }> {
  const env = deps.env ?? process.env;
  if (!isExternalWebhookDeliveryEnabled(env)) {
    return { ok: true, skipped: "flag_off" };
  }
  const db = deps.db ?? prisma;
  const claimed = await db.externalWebhookDeliveryAttempt.updateMany({
    where: { id: attemptId, state: "recorded" },
    data: { state: "sending" },
  });
  if (claimed.count !== 1) return { ok: true, skipped: "not_recorded" };

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
      code: sameTarget ? "duplicate_primary_crm" : "destination_changed",
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
  await finalize(db, attemptId, {
    outcome: classified.receipt.outcome,
    httpStatus: classified.receipt.httpStatus,
    requestLeftSa360: classified.receipt.requestLeftSa360,
    proves: classified.receipt.proves,
  });
  logger.info("external_webhook.send_result", {
    attemptId,
    outcome: classified.receipt.outcome,
    httpStatus: classified.receipt.httpStatus,
  });
  return { ok: true, outcome: classified.receipt.outcome };
}

export async function promoteStaleExternalWebhookSends(
  now: Date = new Date(),
  leaseMs: number = STALE_SEND_LEASE_MS,
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
