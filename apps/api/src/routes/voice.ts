import type { FastifyInstance } from "fastify";
import { readRequestId } from "../lib/read-request-id.js";
import { synthflowInboundLookupBodySchema } from "../schemas/synthflow-inbound-lookup.schema.js";
import {
  buildSynthflowGuardrailResponse,
  executeSynthflowInboundLookup,
  logSynthflowLookupEvent,
  phoneSuffixForLog,
} from "../services/synthflow-inbound-lookup.service.js";
import {
  completeSynthflowLog,
  fieldsFromSynthflowResponse,
  startSynthflowLog,
} from "../services/synthflow-request-log.service.js";

export async function voiceRoutes(app: FastifyInstance) {
  app.post("/voice/synthflow/inbound-lookup", async (request, reply) => {
    const request_id = readRequestId(request);
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
}
