import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  automationDashboardQuerySchema,
  toAutomationDashboardFilters,
} from "../schemas/automation-dashboard.schema.js";
import {
  getAutomationAccounts,
  getAutomationAppointments,
  getAutomationDashboardSummary,
  getAutomationSignalHealth,
  getAutomationWorkflowProgression,
} from "../services/automation-dashboard.service.js";

async function parseFilters(request: FastifyRequest, reply: FastifyReply) {
  const parsed = automationDashboardQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    await reply.status(400).send({
      ok: false,
      error: "Invalid query",
      details: parsed.error.flatten(),
    });
    return null;
  }
  try {
    return toAutomationDashboardFilters(parsed.data);
  } catch (e) {
    const msg = e instanceof RangeError ? e.message : "Invalid date range";
    await reply.status(400).send({ ok: false, error: msg });
    return null;
  }
}

export async function automationDashboardRoutes(app: FastifyInstance) {
  const withFilters = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyAdminApiKey(request, reply))) return null;
    return parseFilters(request, reply);
  };

  app.get("/summary", async (request, reply) => {
    const filters = await withFilters(request, reply);
    if (!filters) return;
    return getAutomationDashboardSummary(filters);
  });

  app.get("/workflow-progression", async (request, reply) => {
    const filters = await withFilters(request, reply);
    if (!filters) return;
    return getAutomationWorkflowProgression(filters);
  });

  app.get("/appointments", async (request, reply) => {
    const filters = await withFilters(request, reply);
    if (!filters) return;
    return getAutomationAppointments(filters);
  });

  app.get("/signal-health", async (request, reply) => {
    const filters = await withFilters(request, reply);
    if (!filters) return;
    return getAutomationSignalHealth(filters);
  });

  app.get("/accounts", async (request, reply) => {
    const filters = await withFilters(request, reply);
    if (!filters) return;
    return getAutomationAccounts(filters);
  });
}
