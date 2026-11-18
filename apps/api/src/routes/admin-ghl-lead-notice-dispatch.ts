import type { FastifyInstance } from "fastify";

import { readSmsCanaryIsolation } from "@sa360/shared";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { prisma } from "../lib/db.js";
import { discoverGhlLeadNotices, isGhlLeadNoticeEnabled } from "../services/ghl-lead-notice/discover.js";
import { dispatchGhlLeadNotice } from "../services/ghl-lead-notice/dispatch.js";
import { enqueueGhlLeadNotice } from "../services/ghl-lead-notice/queue.js";
import { promoteStaleGhlLeadNotices } from "../services/ghl-lead-notice/receipt.js";
import { recoverPendingGhlLeadNotices } from "../services/ghl-lead-notice/recovery.js";

type NoticeRouteOpts = { env?: NodeJS.ProcessEnv };

/**
 * Internal admin drain for the GHL lead-notice worker.
 * Registered from app.ts under /admin/v1. The flag stays off, and a request
 * then returns before discovery or a provider call. Intake routes do not
 * call this.
 */
export async function adminGhlLeadNoticeDispatchRoutes(app: FastifyInstance, opts: NoticeRouteOpts = {}) {
  const env = opts.env ?? process.env;

  app.post("/ghl-lead-notice/internal/discover", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    if (readSmsCanaryIsolation(env).mode !== "off") {
      return reply.send({ ok: true, skipped: "canary_isolation", scanned: 0, inserted: 0, enqueued: 0 });
    }
    if (!isGhlLeadNoticeEnabled(env)) return reply.send({ ok: true, skipped: "flag_off" });
    const promoted = await promoteStaleGhlLeadNotices(prisma);
    const recovered = await recoverPendingGhlLeadNotices(prisma, { enqueue: enqueueGhlLeadNotice });
    const discovered = await discoverGhlLeadNotices(prisma, { env, enqueue: enqueueGhlLeadNotice });
    return reply.send({ ok: true, promoted: promoted.promoted, recovery: recovered, discovery: discovered });
  });

  app.post("/ghl-lead-notice/internal/dispatch", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    if (readSmsCanaryIsolation(env).mode !== "off") return reply.send({ ok: true, skipped: "canary_isolation" });
    if (!isGhlLeadNoticeEnabled(env)) return reply.send({ ok: true, skipped: "flag_off" });
    const body = request.body as { receiptId?: unknown };
    const receiptId = typeof body?.receiptId === "string" ? body.receiptId.trim() : "";
    if (!receiptId) return reply.code(400).send({ ok: false, error: "receipt_id_required" });
    const result = await dispatchGhlLeadNotice(prisma, receiptId, { env });
    return reply.send(result);
  });
}
