import type { FastifyInstance } from "fastify";
import { logger } from "../lib/logger.js";
import { readRequestId } from "../lib/read-request-id.js";
import { isSynthflowVoiceRequestAuthorized } from "../lib/synthflow-voice-auth.js";
import { synthflowInboundLookupBodySchema } from "../schemas/synthflow-inbound-lookup.schema.js";
import { synthflowOutboundContextBodySchema } from "../schemas/synthflow-outbound-context.schema.js";
import {
  buildSynthflowGuardrailResponse,
  executeSynthflowInboundLookup,
  logSynthflowLookupEvent,
  phoneSuffixForLog,
} from "../services/synthflow-inbound-lookup.service.js";
import {
  buildOutboundContextGuardrailResponse,
  executeSynthflowOutboundContext,
} from "../services/synthflow-outbound-context.service.js";
import {
  completeSynthflowLog,
  fieldsFromOutboundContextResponse,
  fieldsFromSynthflowResponse,
  startSynthflowLog,
  SYNTHFLOW_OUTBOUND_CONTEXT_ROUTE,
  SYNTHFLOW_OUTBOUND_CONTEXT_SOURCE,
} from "../services/synthflow-request-log.service.js";
import { synthflowOutboundResultBodySchema } from "../schemas/synthflow-outbound-result.schema.js";
import { persistSynthflowOutboundResult } from "../services/synthflow-outbound-result.service.js";

export async function voiceRoutes(app: FastifyInstance) {
  app.post("/voice/synthflow/inbound-lookup", async (request, reply) => {
    const request_id = readRequestId(request);
    if (!isSynthflowVoiceRequestAuthorized(request)) {
      logger.warn("synthflow.inbound_lookup.unauthorized", { request_id });
      return reply.status(401).send({ ok: false, error: "Unauthorized" });
    }

    const logHandle = await startSynthflowLog({
      requestId: request_id,
      rawBody: request.body,
    });

    try {
      const parsed = synthflowInboundLookupBodySchema.safeParse(request.body);

      if (!parsed.success) {
        const res = buildSynthflowGuardrailResponse(request.body, "invalid_payload");
        const first = parsed.error.issues[0];
        logSynthflowLookupEvent("warn", "invalid_payload", {
          lookup_status: "invalid_payload",
          from_suffix: phoneSuffixForLog(res.call_inbound.metadata.from_number),
          to_suffix: phoneSuffixForLog(res.call_inbound.metadata.to_number),
          issue_count: parsed.error.issues.length,
          first_issue_path: first?.path?.length ? first.path.join(".") : "",
          first_issue_code: first?.code ?? "",
        });
        const errorSummary = first
          ? `${first.path.join(".")}: ${first.message}`
          : "validation_failed";
        const fields = fieldsFromSynthflowResponse(res);
        await completeSynthflowLog(logHandle, {
          ...fields,
          httpStatus: 200,
          errorCode: "VALIDATION_FAILED",
          errorSummary,
          responseBodyRedacted: res,
        });
        return reply.send(res);
      }

      const response = await executeSynthflowInboundLookup(parsed.data);
      const fields = fieldsFromSynthflowResponse(response);
      await completeSynthflowLog(logHandle, {
        ...fields,
        httpStatus: 200,
        responseBodyRedacted: response,
      });
      return reply.send(response);
    } catch {
      const res = buildSynthflowGuardrailResponse(request.body, "internal_error");
      logSynthflowLookupEvent("error", "route_unhandled", {
        lookup_status: "internal_error",
        from_suffix: phoneSuffixForLog(res.call_inbound.metadata.from_number),
        to_suffix: phoneSuffixForLog(res.call_inbound.metadata.to_number),
      });
      const fields = fieldsFromSynthflowResponse(res);
      await completeSynthflowLog(logHandle, {
        ...fields,
        httpStatus: 200,
        errorCode: "INTERNAL",
        errorSummary: "route_unhandled",
        responseBodyRedacted: res,
      });
      return reply.send(res);
    }
  });

  app.post("/voice/synthflow/outbound-context", async (request, reply) => {
    const request_id = readRequestId(request);
    if (!isSynthflowVoiceRequestAuthorized(request)) {
      logger.warn("synthflow.outbound_context.unauthorized", { request_id });
      return reply.status(401).send({ ok: false, error: "Unauthorized" });
    }

    const logHandle = await startSynthflowLog({
      requestId: request_id,
      rawBody: request.body,
      route: SYNTHFLOW_OUTBOUND_CONTEXT_ROUTE,
      source: SYNTHFLOW_OUTBOUND_CONTEXT_SOURCE,
    });

    try {
      const parsed = synthflowOutboundContextBodySchema.safeParse(request.body);

      if (!parsed.success) {
        const res = buildOutboundContextGuardrailResponse(request.body, "invalid_payload");
        const first = parsed.error.issues[0];
        logSynthflowLookupEvent("warn", "synthflow_outbound_invalid_payload", {
          lookup_status: "invalid_payload",
          from_suffix: phoneSuffixForLog(res.custom_variables.from_number_e164 ?? ""),
          to_suffix: phoneSuffixForLog(res.custom_variables.to_number_e164 ?? ""),
          issue_count: parsed.error.issues.length,
          first_issue_path: first?.path?.length ? first.path.join(".") : "",
          first_issue_code: first?.code ?? "",
        });
        const errorSummary = first
          ? `${first.path.join(".")}: ${first.message}`
          : "validation_failed";
        const fields = fieldsFromOutboundContextResponse(res);
        await completeSynthflowLog(logHandle, {
          ...fields,
          httpStatus: 200,
          errorCode: "VALIDATION_FAILED",
          errorSummary,
          responseBodyRedacted: res,
        });
        return reply.send(res);
      }

      const response = await executeSynthflowOutboundContext(parsed.data);
      const fields = fieldsFromOutboundContextResponse(response);
      await completeSynthflowLog(logHandle, {
        ...fields,
        httpStatus: 200,
        responseBodyRedacted: response,
      });
      return reply.send(response);
    } catch {
      const res = buildOutboundContextGuardrailResponse(request.body, "internal_error");
      logSynthflowLookupEvent("error", "synthflow_outbound_route_unhandled", {
        lookup_status: "internal_error",
        from_suffix: phoneSuffixForLog(res.custom_variables.from_number_e164 ?? ""),
        to_suffix: phoneSuffixForLog(res.custom_variables.to_number_e164 ?? ""),
      });
      const fields = fieldsFromOutboundContextResponse(res);
      await completeSynthflowLog(logHandle, {
        ...fields,
        httpStatus: 200,
        errorCode: "INTERNAL",
        errorSummary: "route_unhandled",
        responseBodyRedacted: res,
      });
      return reply.send(res);
    }
  });

  app.post("/voice/synthflow/outbound-result", async (request, reply) => {
    const request_id = readRequestId(request);
    if (!isSynthflowVoiceRequestAuthorized(request)) {
      logger.warn("synthflow.outbound_result.unauthorized", { request_id });
      return reply.status(401).send({ ok: false, error: "Unauthorized" });
    }

    try {
      const parsed = synthflowOutboundResultBodySchema.safeParse(request.body);
      if (!parsed.success) {
        logSynthflowLookupEvent("warn", "synthflow_outbound_result_invalid_payload", {
          lookup_status: "invalid_payload",
          issue_count: parsed.error.issues.length,
        });
        return reply.send({
          ok: false,
          error: "invalid_payload",
        });
      }

      const result = await persistSynthflowOutboundResult({
        requestId: request_id,
        body: parsed.data,
        rawBodyForRedaction: request.body,
      });

      if ("error" in result) {
        return reply.send({
          ok: false,
          error: result.error,
        });
      }

      return reply.send({
        ok: true,
        id: result.id,
      });
    } catch {
      logSynthflowLookupEvent("error", "synthflow_outbound_result_unhandled", {});
      return reply.send({
        ok: false,
        error: "internal_error",
      });
    }
  });
}
