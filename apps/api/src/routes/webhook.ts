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

  app.get("/debug/test-event", async (_request, reply) => {
    const payload = {
      schema_version: "1.0",
      client_account_id: "lal_client_0142",
      contact: {
        lead_uid: "LAL-DEBUG-0001",
        first_name: "Debug",
        last_name: "Lead",
        email: "debug@example.com",
        phone_e164: "+15555550123",
        state: "NC",
        zip: "27513",
      },
      attribution: {
        source_platform: "facebook",
        campaign_id: "debug_campaign_001",
        ad_id: "debug_ad_001",
        fbclid: "fb.debug.001",
      },
      state: {
        lead_type: "Final Expense",
        lifecycle_stage: "Appointment Set",
        appointment_status: "Scheduled",
      },
      event: {
        event_uuid: `evt_debug_${Date.now()}`,
        event_name_internal: "appointment_set",
        event_name_meta: "Schedule",
        event_time_unix: Math.floor(Date.now() / 1000),
        value_score: 50,
        currency: "USD",
        send_to_meta: true,
      },
      ownership: {
        assigned_agent_id: "agent_debug",
        assigned_agent_name: "Debug Agent",
        updated_by: "debug_route",
      },
    };

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/ghl/lifecycle-event",
      payload,
      headers: {
        "x-sa360-secret": process.env.WEBHOOK_SECRET || "",
      },
    });

    return reply.send({
      ok: true,
      message: "Debug lifecycle event triggered",
      statusCode: response.statusCode,
      response: response.json(),
      payload,
    });
  });
}