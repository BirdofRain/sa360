import type { FastifyInstance } from "fastify";
import { synthflowInboundLookupBodySchema } from "../schemas/synthflow-inbound-lookup.schema.js";
import {
  buildSynthflowGuardrailResponse,
  executeSynthflowInboundLookup,
  logSynthflowLookupEvent,
  phoneSuffixForLog,
} from "../services/synthflow-inbound-lookup.service.js";

export async function voiceRoutes(app: FastifyInstance) {
  app.post("/voice/synthflow/inbound-lookup", async (request, reply) => {
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
        return reply.send(res);
      }

      const response = await executeSynthflowInboundLookup(parsed.data);
      return reply.send(response);
    } catch {
      const res = buildSynthflowGuardrailResponse(request.body, "internal_error");
      logSynthflowLookupEvent("error", "route_unhandled", {
        lookup_status: "internal_error",
        from_suffix: phoneSuffixForLog(res.call_inbound.metadata.from_number),
        to_suffix: phoneSuffixForLog(res.call_inbound.metadata.to_number),
      });
      return reply.send(res);
    }
  });
}
