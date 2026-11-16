import type { FastifyInstance } from "fastify";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { prisma } from "../lib/db.js";
import { discoverExternalWebhookNotices, isExternalWebhookNoticeDispatchEnabled } from "../services/external-webhook-notification/notice-discovery.js";
import { dispatchExternalWebhookNotice, promoteStaleExternalWebhookNotices } from "../services/external-webhook-notification/notice-dispatch.js";
import { enqueueExternalWebhookNotice } from "../services/external-webhook-notification/notice-queue.js";
import { recoverPendingExternalWebhookNotices } from "../services/external-webhook-notification/notice-recovery.js";

/**
 * Internal admin drain for the notice worker.
 * Registered from app.ts under /admin/v1. The exact-true dispatch flag
 * stays off, and a request then returns before discovery, recovery, or a provider call.
 */
export async function adminExternalWebhookNoticeDispatchRoutes(app: FastifyInstance) {
  app.post("/external-webhook-notice/internal/discover", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    if (!isExternalWebhookNoticeDispatchEnabled()) {
      return reply.send({ ok: true, skipped: "flag_off" });
    }
    const promoted = await promoteStaleExternalWebhookNotices(prisma);
    const discovered = await discoverExternalWebhookNotices(prisma, { enqueue: enqueueExternalWebhookNotice });
    const recovered = await recoverPendingExternalWebhookNotices(prisma, { enqueue: enqueueExternalWebhookNotice });
    return reply.send({ ok: true, ...promoted, ...discovered, pendingRecovered: recovered.enqueued });
  });

  app.post("/external-webhook-notice/internal/dispatch", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    if (!isExternalWebhookNoticeDispatchEnabled()) {
      return reply.send({ ok: true, skipped: "flag_off" });
    }
    const body = request.body as { receiptId?: unknown };
    const receiptId = typeof body?.receiptId === "string" ? body.receiptId.trim() : "";
    if (!receiptId) return reply.code(400).send({ ok: false, error: "receipt_id_required" });
    const result = await dispatchExternalWebhookNotice(prisma, receiptId);
    return reply.send(result);
  });
}
