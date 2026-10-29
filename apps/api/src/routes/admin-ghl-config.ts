import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { ghlLocationConfigQuerySchema, routingRuleGhlConfigBodySchema } from "../schemas/ghl-config.schema.js";
import { discoverGhlLocationConfig } from "../services/ghl-config-discovery/ghl-config-discovery.service.js";
import { assertNoTokensInGhlConfigPayload } from "../services/ghl-config-discovery/ghl-config-discovery.present.js";
import {
  getRoutingRuleGhlConfigSummary,
  saveRoutingRuleGhlConfig,
} from "../services/ghl-config-discovery/routing-rule-ghl-config.service.js";
import {
  CREATE_SAM_TEST_SURVEY_TEXT_FIELDS,
  SAM_TEST_GHL_LOCATION_ID,
  ensureSamTestSurveyTextFields,
} from "../services/ghl-config-discovery/sam-test-survey-text-fields.js";

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export async function adminGhlConfigRoutes(app: FastifyInstance) {
  app.get("/ghl/locations/:locationId/config", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { locationId } = request.params as { locationId: string };
    const parsed = ghlLocationConfigQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }

    const result = await discoverGhlLocationConfig({
      locationId,
      refresh: parsed.data.refresh ?? false,
    });

    if (!result.ok) {
      const status = result.code === "NOT_CONNECTED" ? 400 : 404;
      return reply.status(status).send({ ok: false, error: result.error, code: result.code });
    }

    const payload = { ok: true as const, ...result.discovery };
    assertNoTokensInGhlConfigPayload(payload as unknown as Record<string, unknown>);
    return reply.send(payload);
  });

  app.post("/ghl/locations/:locationId/survey-text-fields", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { locationId } = request.params as { locationId: string };
    if (locationId.trim() !== SAM_TEST_GHL_LOCATION_ID) {
      return reply.status(403).send({ ok: false, error: "location_not_allowed" });
    }
    const body = request.body;
    const confirmation =
      body && typeof body === "object" && !Array.isArray(body) && typeof (body as { confirmation?: unknown }).confirmation === "string"
        ? (body as { confirmation: string }).confirmation.trim()
        : "";
    if (confirmation !== CREATE_SAM_TEST_SURVEY_TEXT_FIELDS) {
      return reply.status(400).send({ ok: false, error: "invalid_confirmation" });
    }
    const result = await ensureSamTestSurveyTextFields(locationId.trim());
    if (!result.ok) {
      const status = result.code === "location_not_allowed" ? 403 : result.code === "not_connected" ? 409 : 502;
      return reply.status(status).send({ ok: false, error: result.code });
    }
    return reply.send({ ok: true, locationId: result.locationId, fields: result.fields });
  });

  app.get("/routing/rules/:id/ghl-config", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const summary = await getRoutingRuleGhlConfigSummary(id);
    if ("notFound" in summary) {
      return reply.status(404).send({ ok: false, error: "Routing rule not found" });
    }
    return reply.send({ ok: true, ...summary });
  });

  app.post("/routing/rules/:id/ghl-config", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const parsed = routingRuleGhlConfigBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }

    const result = await saveRoutingRuleGhlConfig(id, parsed.data);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Routing rule not found" });
    }
    if ("error" in result) {
      const status = result.code === "LOCATION_MISMATCH" ? 409 : 400;
      return reply.status(status).send({
        ok: false,
        error: result.error,
        code: result.code,
      });
    }

    return reply.send({
      ok: true,
      item: result.item,
      discoverySummary: result.discoverySummary,
      fieldMapping: result.fieldMapping,
    });
  });
}
