import type { FastifyInstance } from "fastify";
import type { LifecycleWebhookPayload } from "@sa360/shared";
import { lifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import { isValidWebhookSecret } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { logM1AEvent } from "../lib/m1a-event-log.js";
import {
  logInboundLookupError,
  logInboundLookupInfo,
} from "../lib/inbound-lookup-log.js";
import {
  hasLifecycleAttributionPresent,
  lifecycleEventExists,
  saveLifecycleEvent,
  upsertLeadAttribution,
} from "../services/event-service.js";
import {
  contactIndexUpsertSkippedReasonStatic,
  resolveLifecycleContactPhoneDetails,
} from "../lib/lifecycle-contact-phone.js";
import { enrichLifecyclePayloadForIngest } from "../lib/lifecycle-event-enrich.js";
import { upsertFromLifecyclePayload } from "../services/inbound-contact-index.service.js";
import { isGlobalMetaSyncEnabled } from "../lib/meta-sync-enabled.js";
import { enqueueMetaDispatch } from "../services/queue-service.js";
import { readRequestId } from "../lib/read-request-id.js";
import { completeLog, startLog } from "../services/webhook-request-log.service.js";

export async function webhookRoutes(app: FastifyInstance) {
  app.post("/webhooks/ghl/lifecycle-event", async (request, reply) => {
    const request_id = readRequestId(request);
    const logHandle = await startLog({ requestId: request_id, rawBody: request.body });

    const secret = request.headers["x-sa360-secret"];

    if (!isValidWebhookSecret(typeof secret === "string" ? secret : undefined)) {
      logger.warn("m1a.webhook.unauthorized", {
        module: "M1A",
        component: "ghl-lifecycle-webhook",
        service: "sa360-api",
        env: process.env.SA360_ENV ?? process.env.NODE_ENV ?? "development",
        request_id,
        stage: "m1a.webhook.unauthorized",
      });
      await completeLog(logHandle, {
        httpStatus: 401,
        processingStatus: "unauthorized",
        responseBodyRedacted: { ok: false, error: "Unauthorized" },
      });
      return reply.status(401).send({ ok: false, error: "Unauthorized" });
    }

    logM1AEvent("m1a.webhook.received", null, {
      request_id,
      status: "received",
      bodyPreview: request.body,
    });

    const parsed = lifecycleEventSchema.safeParse(request.body);

    if (!parsed.success) {
      logM1AEvent("m1a.payload.validated", null, {
        request_id,
        valid: false,
        status: "failed",
        bodyPreview: request.body,
        validation_issue_count: parsed.error.issues.length,
      });
      logger.warn("Invalid webhook payload", parsed.error.flatten());
      const firstIssue = parsed.error.issues[0];
      const errorSummary = firstIssue
        ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
        : "validation_failed";
      await completeLog(logHandle, {
        httpStatus: 400,
        processingStatus: "validation_failed",
        errorCode: "VALIDATION_FAILED",
        errorSummary,
        responseBodyRedacted: {
          ok: false,
          error: "Invalid payload",
          details: parsed.error.flatten(),
        },
      });
      return reply.status(400).send({
        ok: false,
        error: "Invalid payload",
        details: parsed.error.flatten(),
      });
    }

    const nowUnix = Math.floor(Date.now() / 1000);

    const payload = enrichLifecyclePayloadForIngest({
      ...parsed.data,
      attribution: parsed.data.attribution ?? {},
      event: {
        ...parsed.data.event,
        event_time_unix:
          typeof parsed.data.event.event_time_unix === "number" &&
          parsed.data.event.event_time_unix > 0
            ? parsed.data.event.event_time_unix
            : nowUnix,
      },
    }) as LifecycleWebhookPayload;
    const eventUuid = payload.event.event_uuid;

    logM1AEvent("m1a.payload.validated", payload, {
      request_id,
      valid: true,
      status: "received",
    });

    if (await lifecycleEventExists(eventUuid)) {
      const eventNameInternal = payload.event.event_name_internal;
      const phoneDetails = resolveLifecycleContactPhoneDetails(payload);

      if (!payload.client_account_id?.trim()) {
        logger.warn("m1a.webhook.duplicate.missing_client_account_id", {
          request_id,
          eventUuid,
          event_name_internal: eventNameInternal,
        });
      }

      let attribution_upserted_dup = false;
      if (hasLifecycleAttributionPresent(payload)) {
        try {
          await upsertLeadAttribution(payload);
          attribution_upserted_dup = true;
          logM1AEvent("m1a.attribution.upserted", payload, {
            request_id,
            status: "duplicate_index_refresh",
            duplicate_refresh: true,
            attribution_upserted: true,
          });
        } catch (err) {
          logger.warn("m1a.duplicate.attribution_upsert.failed", {
            request_id,
            eventUuid,
            clientAccountId: payload.client_account_id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      let contact_index_upserted_dup = false;
      let contact_index_error_message: string | null = null;
      try {
        contact_index_upserted_dup = await upsertFromLifecyclePayload(payload, {
          eventUuid,
        });
      } catch (err) {
        contact_index_error_message =
          err instanceof Error ? err.message : String(err);
        logInboundLookupError("inbound_contact_index", {
          component: "inbound_contact_index",
          event: "InboundContactIndex upsert failed on duplicate lifecycle refresh",
          eventUuid,
          clientAccountId: payload.client_account_id,
          subaccountIdGhl: payload.subaccount_id_ghl?.trim() ?? "",
          message: contact_index_error_message,
          error_name: err instanceof Error ? err.name : "unknown",
        });
        logM1AEvent("m1a.contact_index.failed", payload, {
          request_id,
          status: "duplicate_index_refresh",
          duplicate_refresh: true,
          failure_step: "contact_index",
          contact_index_upserted: false,
          error_message: contact_index_error_message,
        });
      }

      if (!contact_index_upserted_dup) {
        const staticReason = contactIndexUpsertSkippedReasonStatic(payload, phoneDetails);
        const reason =
          contact_index_error_message ??
          staticReason ??
          "contact_index_upsert_returned_false";
        logger.warn("m1a.webhook.duplicate.contact_index_not_upserted", {
          request_id,
          eventUuid,
          event_name_internal: eventNameInternal,
          client_account_id: payload.client_account_id,
          phone_resolution_source: phoneDetails.raw_source,
          normalized_phone_present: Boolean(phoneDetails.normalized_e164),
          reason,
        });
      }

      logM1AEvent("m1a.webhook.duplicate_index_refreshed", payload, {
        request_id,
        status: "duplicate_index_refreshed",
        event_stored: false,
        event_name_internal: eventNameInternal,
        attribution_upserted: attribution_upserted_dup,
        contact_index_upserted: contact_index_upserted_dup,
        queue_job_created: false,
      });

      const dupRes = {
        ok: true,
        duplicate: true,
        status: "duplicate_index_refreshed",
        eventUuid,
        event_name_internal: eventNameInternal,
        attribution_upserted: attribution_upserted_dup,
        contact_index_upserted: contact_index_upserted_dup,
        queue_job_created: false,
      };
      await completeLog(logHandle, {
        httpStatus: 200,
        processingStatus: "duplicate_index_refreshed",
        clientAccountId: payload.client_account_id?.trim() || null,
        subaccountIdGhl: payload.subaccount_id_ghl?.trim() ?? null,
        contactIdGhl: payload.contact.contact_id_ghl ?? null,
        eventUuid,
        eventNameInternal: eventNameInternal,
        responseBodyRedacted: dupRes,
      });
      return reply.send(dupRes);
    }

    let event_stored = false;
    let attribution_upserted = false;
    let contact_index_upserted = false;
    let queue_job_created = false;
    let finalStatus: "received" | "stored" | "queued" | "skipped" | "failed" =
      "received";

    logInboundLookupInfo("lifecycle_webhook", {
      component: "lifecycle_webhook",
      event: "lifecycle webhook received",
      eventUuid,
      clientAccountId: payload.client_account_id,
      subaccountIdGhl: payload.subaccount_id_ghl?.trim() ?? "",
    });

    try {
      await saveLifecycleEvent(payload);
      event_stored = true;
      finalStatus = "stored";
      logM1AEvent("m1a.event.stored", payload, {
        request_id,
        status: "stored",
        event_stored: true,
      });

      await upsertLeadAttribution(payload);
      attribution_upserted = true;
      logM1AEvent("m1a.attribution.upserted", payload, {
        request_id,
        status: "stored",
        attribution_upserted: true,
      });

      try {
        contact_index_upserted = await upsertFromLifecyclePayload(payload, {
          eventUuid,
        });
        if (contact_index_upserted) {
          logM1AEvent("m1a.contact_index.upserted", payload, {
            request_id,
            status: "stored",
            contact_index_upserted: true,
          });
        }
      } catch (err) {
        logInboundLookupError("inbound_contact_index", {
          component: "inbound_contact_index",
          event: "InboundContactIndex upsert failed from lifecycle",
          eventUuid,
          clientAccountId: payload.client_account_id,
          subaccountIdGhl: payload.subaccount_id_ghl?.trim() ?? "",
          message: err instanceof Error ? err.message : String(err),
          error_name: err instanceof Error ? err.name : "unknown",
        });
        logM1AEvent("m1a.contact_index.failed", payload, {
          request_id,
          status: "stored",
          failure_step: "contact_index",
          event_stored,
          attribution_upserted,
          contact_index_upserted: false,
          error_message: err instanceof Error ? err.message : String(err),
        });
      }

      const wantsMetaDispatch = payload.event.send_to_meta !== false;
      const globalMetaSyncEnabled = isGlobalMetaSyncEnabled();

      if (wantsMetaDispatch && globalMetaSyncEnabled) {
        await enqueueMetaDispatch(eventUuid);
        queue_job_created = true;
        finalStatus = "queued";
        logM1AEvent("m1a.queue.created", payload, {
          request_id,
          status: "queued",
          event_stored,
          attribution_upserted,
          contact_index_upserted,
          queue_job_created: true,
        });
      } else if (wantsMetaDispatch && !globalMetaSyncEnabled) {
        finalStatus = "skipped";
        logger.info(
          "Meta dispatch not queued: META_SYNC_ENABLED is disabled globally (test mode). Event and attribution were stored.",
          {
            eventUuid,
            clientAccountId: payload.client_account_id,
            eventNameInternal: payload.event.event_name_internal,
          }
        );
      } else {
        finalStatus = "stored";
      }

      const queued = wantsMetaDispatch && globalMetaSyncEnabled;

      const res = {
        ok: true,
        eventUuid,
        queued,
      };

      logM1AEvent("m1a.webhook.completed", payload, {
        request_id,
        status: finalStatus,
        event_stored,
        attribution_upserted,
        contact_index_upserted,
        queue_job_created,
      });

      await completeLog(logHandle, {
        httpStatus: 200,
        processingStatus: finalStatus,
        clientAccountId: payload.client_account_id?.trim() || null,
        subaccountIdGhl: payload.subaccount_id_ghl?.trim() ?? null,
        contactIdGhl: payload.contact.contact_id_ghl ?? null,
        eventUuid,
        eventNameInternal: payload.event.event_name_internal,
        responseBodyRedacted: res,
      });
      return reply.send(res);
    } catch (err) {
      logM1AEvent("m1a.webhook.failed", payload, {
        request_id,
        status: "failed",
        event_stored,
        attribution_upserted,
        contact_index_upserted,
        queue_job_created,
        error_message: err instanceof Error ? err.message : String(err),
        log_level: "error",
      });
      logger.error("Lifecycle webhook processing failed", {
        request_id,
        eventUuid,
        error: err instanceof Error ? err.message : String(err),
      });
      await completeLog(logHandle, {
        httpStatus: 500,
        processingStatus: "failed",
        clientAccountId: payload.client_account_id?.trim() || null,
        subaccountIdGhl: payload.subaccount_id_ghl?.trim() ?? null,
        contactIdGhl: payload.contact.contact_id_ghl ?? null,
        eventUuid,
        eventNameInternal: payload.event.event_name_internal,
        errorCode: "INTERNAL",
        errorSummary: err instanceof Error ? err.message : String(err),
        responseBodyRedacted: { ok: false, error: "Internal error" },
      });
      return reply.status(500).send({ ok: false, error: "Internal error" });
    }
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
