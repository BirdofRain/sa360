import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  LEADCAPTURE_NEXTGEN_AUTH_HEADER,
  validateLeadCaptureNextGenWebhookAuth,
} from "../lib/leadcapture-nextgen-webhook-auth.js";
import { logger } from "../lib/logger.js";
import { readRequestId } from "../lib/read-request-id.js";
import {
  LEADCAPTURE_NEXTGEN_MAX_BODY_BYTES,
  leadCaptureNextGenLeadCreatedSchema,
} from "../schemas/leadcapture-nextgen-webhook.schema.js";
import { completeLog, startLog } from "../services/webhook-request-log.service.js";
import {
  LeadCaptureNextGenIntakeError,
  processLeadCaptureNextGenLeadCreated,
} from "../services/source-intake/leadcapture-nextgen-intake.service.js";

const NEXTGEN_LEAD_CREATED_ROUTE = "/sources/leadcapture/nextgen/lead-created";

export type SourcesLeadCaptureNextGenRoutesOptions = {
  processLeadCaptureNextGenLeadCreatedImpl?: typeof processLeadCaptureNextGenLeadCreated;
};

function isObjectPayload(body: unknown): body is Record<string, unknown> {
  return Boolean(body) && typeof body === "object" && !Array.isArray(body);
}

async function handleNextGenLeadCreated(
  request: FastifyRequest,
  reply: FastifyReply,
  processImpl: typeof processLeadCaptureNextGenLeadCreated
) {
  const request_id = readRequestId(request);
  const logHandle = await startLog({
    requestId: request_id,
    rawBody: request.body,
    source: "leadcapture_io",
    route: NEXTGEN_LEAD_CREATED_ROUTE,
  });

  const keyHeader = request.headers[LEADCAPTURE_NEXTGEN_AUTH_HEADER];
  const keyValue = typeof keyHeader === "string" ? keyHeader : undefined;
  const authHeader = request.headers.authorization;
  const authorizationHeader = typeof authHeader === "string" ? authHeader : undefined;
  const auth = validateLeadCaptureNextGenWebhookAuth({
    headerKey: keyValue,
    authorizationHeader,
  });

  if (!auth.ok) {
    if (auth.reason === "integration_not_configured") {
      const responseBody = {
        ok: false,
        error: "integration_not_configured",
        integration: "leadcapture_io_nextgen",
        hint: auth.hint ?? "Set SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET in the API environment.",
      };
      logger.error("source_intake.leadcapture_nextgen.integration_not_configured", {
        request_id,
      });
      await completeLog(logHandle, {
        httpStatus: 503,
        processingStatus: "integration_not_configured",
        errorCode: "INTEGRATION_NOT_CONFIGURED",
        errorSummary: "LeadCapture Next-Gen webhook secret is required in production.",
        responseBodyRedacted: responseBody,
      });
      return reply.status(503).send(responseBody);
    }

    logger.warn("source_intake.leadcapture_nextgen.unauthorized", {
      request_id,
      reason: auth.reason,
    });
    await completeLog(logHandle, {
      httpStatus: 401,
      processingStatus: "unauthorized",
      responseBodyRedacted: { ok: false, error: "Unauthorized" },
    });
    return reply.status(401).send({ ok: false, error: "Unauthorized" });
  }

  if (!isObjectPayload(request.body)) {
    await completeLog(logHandle, {
      httpStatus: 400,
      processingStatus: "validation_failed",
      errorCode: "INVALID_BODY",
      errorSummary: "Expected JSON object webhook body",
      responseBodyRedacted: { ok: false, error: "Invalid payload" },
    });
    return reply.status(400).send({ ok: false, error: "Invalid payload" });
  }

  const validated = leadCaptureNextGenLeadCreatedSchema.safeParse(request.body);
  if (!validated.success) {
    await completeLog(logHandle, {
      httpStatus: 400,
      processingStatus: "validation_failed",
      errorCode: "INVALID_NEXTGEN_PAYLOAD",
      errorSummary: "Next-Gen payload failed structured validation (lead_id UUID required).",
      responseBodyRedacted: { ok: false, error: "invalid_payload" },
    });
    return reply.status(400).send({
      ok: false,
      error: "invalid_payload",
      message: "Expected Next-Gen lead_id UUID and a valid LeadCapture object payload.",
    });
  }

  try {
    const result = await processImpl({
      rawPayload: request.body,
      webhookRequestLogId: logHandle?.id,
    });

    const response = {
      ok: true,
      provider: result.provider,
      sourceSystem: result.sourceSystem,
      sourceEventId: result.sourceEventId,
      status: result.status,
      sourceRouteKey: result.sourceRouteKey,
      sourceLeadId: result.sourceLeadId,
      duplicate: result.duplicate,
      intakeStage: result.intakeStage,
      matched: result.matched,
      nextAction: result.nextAction,
      ...(auth.devWarning ? { devWarning: auth.devWarning } : {}),
    };

    if (auth.devWarning) {
      logger.warn("source_intake.leadcapture_nextgen.dev_warning", {
        request_id,
        warning: auth.devWarning,
      });
    }

    logger.info("source_intake.leadcapture_nextgen.captured", {
      request_id,
      sourceEventId: result.sourceEventId,
      status: result.status,
      intakeStage: result.intakeStage,
      duplicate: result.duplicate,
      matched: result.matched,
      // Do not log PII, proof keys, or full payload.
    });

    await completeLog(logHandle, {
      httpStatus: 200,
      processingStatus: result.status,
      clientAccountId: result.destinationClientAccountId ?? undefined,
      subaccountIdGhl: result.destinationLocationIdGhl ?? undefined,
      normalizedLeadUid: result.normalizedLeadUid ?? undefined,
      sourceLeadEventId: result.sourceEventId,
      routingDryRunDecisionId: result.routingDryRunDecisionId ?? undefined,
      eventNameInternal: "lead_created",
      responseBodyRedacted: response,
    });

    return reply.status(200).send(response);
  } catch (err) {
    if (err instanceof LeadCaptureNextGenIntakeError) {
      const httpStatus = err.code === "invalid_payload" ? 400 : 400;
      const responseBody = { ok: false, error: err.code };
      await completeLog(logHandle, {
        httpStatus,
        processingStatus: "validation_failed",
        errorCode: err.code.toUpperCase(),
        errorSummary: err.message,
        responseBodyRedacted: responseBody,
      });
      return reply.status(httpStatus).send(responseBody);
    }

    const message = err instanceof Error ? err.message : "intake_failed";
    logger.error("source_intake.leadcapture_nextgen.failed", { request_id, message });
    await completeLog(logHandle, {
      httpStatus: 500,
      processingStatus: "failed",
      errorSummary: message,
      responseBodyRedacted: { ok: false, error: "Intake failed" },
    });
    return reply.status(500).send({ ok: false, error: "Intake failed" });
  }
}

export async function sourcesLeadCaptureNextGenRoutes(
  app: FastifyInstance,
  opts: SourcesLeadCaptureNextGenRoutesOptions = {}
) {
  const processImpl =
    opts.processLeadCaptureNextGenLeadCreatedImpl ?? processLeadCaptureNextGenLeadCreated;

  app.post(
    NEXTGEN_LEAD_CREATED_ROUTE,
    { bodyLimit: LEADCAPTURE_NEXTGEN_MAX_BODY_BYTES },
    (request, reply) => handleNextGenLeadCreated(request, reply, processImpl)
  );
}
