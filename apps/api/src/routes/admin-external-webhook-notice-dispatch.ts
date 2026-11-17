import type { FastifyInstance } from "fastify";

import { readSmsCanaryIsolation } from "@sa360/shared";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { prisma } from "../lib/db.js";
import { discoverExternalWebhookNotices, isExternalWebhookNoticeDispatchEnabled } from "../services/external-webhook-notification/notice-discovery.js";
import { dispatchExternalWebhookNotice, promoteStaleExternalWebhookNotices } from "../services/external-webhook-notification/notice-dispatch.js";
import { enqueueExternalWebhookNotice } from "../services/external-webhook-notification/notice-queue.js";
import { recoverPendingExternalWebhookNotices } from "../services/external-webhook-notification/notice-recovery.js";
import { runIsolatedSmsCanary } from "../services/external-webhook-notification/sms-canary.js";

type NoticeRouteOpts = { env?: NodeJS.ProcessEnv };

/**
 * Internal admin drain for the notice worker.
 * Registered from app.ts under /admin/v1. The exact-true dispatch flag
 * stays off, and a request then returns before discovery, recovery, or a provider call.
 */
export async function adminExternalWebhookNoticeDispatchRoutes(app: FastifyInstance, opts: NoticeRouteOpts = {}) {
  const env = opts.env ?? process.env;

  app.post("/external-webhook-notice/internal/discover", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    if (readSmsCanaryIsolation(env).mode !== "off") {
      return reply.send({ ok: true, skipped: "canary_isolation", scanned: 0, enqueued: 0, pendingRecovered: 0 });
    }
    if (!isExternalWebhookNoticeDispatchEnabled(env)) {
      return reply.send({ ok: true, skipped: "flag_off" });
    }
    const promoted = await promoteStaleExternalWebhookNotices(prisma);
    const discovered = await discoverExternalWebhookNotices(prisma, { env, enqueue: enqueueExternalWebhookNotice });
    const recovered = await recoverPendingExternalWebhookNotices(prisma, { enqueue: enqueueExternalWebhookNotice });
    return reply.send({ ok: true, ...promoted, ...discovered, pendingRecovered: recovered.enqueued });
  });

  app.post("/external-webhook-notice/internal/dispatch", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    if (readSmsCanaryIsolation(env).mode !== "off") {
      return reply.send({ ok: true, skipped: "canary_isolation" });
    }
    if (!isExternalWebhookNoticeDispatchEnabled(env)) {
      return reply.send({ ok: true, skipped: "flag_off" });
    }
    const body = request.body as { receiptId?: unknown };
    const receiptId = typeof body?.receiptId === "string" ? body.receiptId.trim() : "";
    if (!receiptId) return reply.code(400).send({ ok: false, error: "receipt_id_required" });
    const result = await dispatchExternalWebhookNotice(prisma, receiptId, { env });
    return reply.send(result);
  });

  app.post("/external-webhook-notice/internal/sms-canary", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const body = request.body as { attemptId?: unknown };
    const attemptId = typeof body?.attemptId === "string" ? body.attemptId.trim() : "";
    if (!attemptId) return reply.code(400).send({ ok: false, error: "attempt_id_required" });
    const result = await runIsolatedSmsCanary(prisma, { attemptId, env });
    return reply.send(result);
  });
}
