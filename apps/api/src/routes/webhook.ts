import type { FastifyInstance } from "fastify";
import { lifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import { isValidWebhookSecret } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import {
  lifecycleEventExists,
  saveLifecycleEvent,
  upsertLeadAttribution,
} from "../services/event-service.js";
import { enqueueMetaDispatch } from "../services/queue-service.js";

export async function webhookRoutes(app: FastifyInstance) {
  app.post("/webhooks/ghl/lifecycle-event", async (request, reply) => {
    const secret = request.headers["x-sa360-secret"];

    if (!isValidWebhookSecret(typeof secret === "string" ? secret : undefined)) {
      return reply.status(401).send({ ok: false, error: "Unauthorized" });
    }

    const parsed = lifecycleEventSchema.safeParse(request.body);

    if (!parsed.success) {
      logger.warn("Invalid webhook payload", parsed.error.flatten());
      return reply.status(400).send({
        ok: false,
        error: "Invalid payload",
        details: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;
    const eventUuid = payload.event.event_uuid;

    if (await lifecycleEventExists(eventUuid)) {
      return reply.send({ ok: true, duplicate: true });
    }

    await saveLifecycleEvent(payload);
    await upsertLeadAttribution(payload);

    if (payload.event.send_to_meta !== false) {
      await enqueueMetaDispatch(eventUuid);
    }

    return reply.send({
      ok: true,
      eventUuid,
      queued: payload.event.send_to_meta !== false,
    });
  });

  app.post("/webhooks/ghl/test", async (_request, reply) => {
    return reply.send({ ok: true, message: "Webhook test endpoint live" });
  });
}

fastify.get("/debug/test-event", async (request, reply) => {
  const payload = {
    clientId: "debug-client",
    contactId: "debug-contact-123",
    eventType: "lead_created",
    source: "facebook",
    campaign: "debug_campaign",
    timestamp: new Date().toISOString()
  };

  await fastify.inject({
    method: "POST",
    url: "/webhooks/ghl/lifecycle-event",
    payload,
    headers: {
      "x-sa360-secret": process.env.WEBHOOK_SECRET || ""
    }
  });

  return { ok: true, message: "Debug lifecycle event triggered", payload };
});