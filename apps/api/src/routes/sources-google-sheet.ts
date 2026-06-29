import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isValidWebhookSecret } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { readRequestId } from "../lib/read-request-id.js";
import { completeLog, startLog } from "../services/webhook-request-log.service.js";
import { googleSheetLeadSchema } from "../schemas/google-sheet-lead.schema.js";
import { processGoogleSheetSourceLead } from "../services/source-intake/google-sheet-lead-intake.service.js";

const LEAD_CREATED_ROUTE = "/sources/google-sheet/lead-created";

export type SourcesGoogleSheetRoutesOptions = {
  processGoogleSheetSourceLeadImpl?: typeof processGoogleSheetSourceLead;
};

async function handleLeadCreated(
  request: FastifyRequest,
  reply: FastifyReply,
  processImpl: typeof processGoogleSheetSourceLead
) {
  const requestId = readRequestId(request);
  const logHandle = await startLog({
    requestId,
    rawBody: request.body,
    source: "google_sheets",
    route: LEAD_CREATED_ROUTE,
  });

  // Authentication: same shared secret header as the GHL lifecycle webhook.
  const secret = request.headers["x-sa360-secret"];
  if (!isValidWebhookSecret(typeof secret === "string" ? secret : undefined)) {
    logger.warn("source_intake.google_sheet.unauthorized", { requestId });
    await completeLog(logHandle, {
      httpStatus: 401,
      processingStatus: "unauthorized",
      responseBodyRedacted: { ok: false, error: "Unauthorized" },
    });
    return reply.status(401).send({ ok: false, error: "Unauthorized" });
  }

  const parsed = googleSheetLeadSchema.safeParse(request.body);
  if (!parsed.success) {
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

  try {
    const result = await processImpl({
      payload: parsed.data,
      webhookRequestLogId: logHandle?.id,
    });

    const response = {
      ok: true,
      provider: result.provider,
      sourceEventId: result.sourceEventId,
      status: result.status,
      eventUuid: result.eventUuid,
      normalizedLeadUid: result.normalizedLeadUid,
      lifecycleEventStored: result.lifecycleEventStored,
      attributionUpserted: result.attributionUpserted,
      contactIndexUpserted: result.contactIndexUpserted,
      matched: result.matched,
      matchedRule: result.matchedRule,
      routingDryRunDecisionId: result.routingDryRunDecisionId,
      deliveryMode: result.deliveryMode,
      deliveryPlanId: result.deliveryPlanId,
      liveDeliverySuppressed: result.liveDeliverySuppressed,
      nextAction: result.nextAction,
    };

    await completeLog(logHandle, {
      httpStatus: 200,
      processingStatus: result.status,
      clientAccountId: result.matchedRule?.destinationClientAccountId ?? undefined,
      subaccountIdGhl: result.matchedRule?.destinationLocationIdGhl ?? undefined,
      eventUuid: result.eventUuid,
      eventNameInternal: "lead_created",
      sourceLeadEventId: result.sourceEventId,
      normalizedLeadUid: result.normalizedLeadUid,
      routingDryRunDecisionId: result.routingDryRunDecisionId ?? undefined,
      responseBodyRedacted: response,
    });

    return reply.status(200).send(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "intake_failed";
    logger.error("source_intake.google_sheet.failed", { requestId, message });
    await completeLog(logHandle, {
      httpStatus: 500,
      processingStatus: "failed",
      errorSummary: message,
      responseBodyRedacted: { ok: false, error: "Intake failed" },
    });
    return reply.status(500).send({ ok: false, error: "Intake failed" });
  }
}

export async function sourcesGoogleSheetRoutes(
  app: FastifyInstance,
  opts: SourcesGoogleSheetRoutesOptions = {}
) {
  const processImpl = opts.processGoogleSheetSourceLeadImpl ?? processGoogleSheetSourceLead;
  app.post(LEAD_CREATED_ROUTE, (request, reply) =>
    handleLeadCreated(request, reply, processImpl)
  );
}
