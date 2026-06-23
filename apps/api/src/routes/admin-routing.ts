import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  routingDryRunBodySchema,
  routingDryRunListQuerySchema,
  routingDryRunStatsQuerySchema,
  routingDryRunValidationPatchSchema,
} from "../schemas/routing.schema.js";
import { listDistinctRoutingMasterClientIds } from "../repositories/campaign-routing-rule.repository.js";
import { listRecentRoutingDryRunDecisions } from "../repositories/routing-dry-run-decision.repository.js";
import { presentRoutingDryRunDecisions } from "../services/routing-dry-run-admin.present.js";
import { getRoutingDryRunStats } from "../services/routing-dry-run-stats.service.js";
import { runRoutingDryRun } from "../services/routing-dry-run.service.js";
import { updateRoutingDryRunValidation } from "../services/routing-dry-run-validation.service.js";
import { duplicateRiskReviewPatchSchema } from "../schemas/lead-identity.schema.js";
import {
  getDuplicateRiskForRoutingDecision,
  patchDuplicateRiskOperatorReview,
} from "../services/lead-identity/lead-identity-correlation.service.js";
import { findDuplicateRiskByRoutingDecisionId } from "../repositories/lead-duplicate-risk.repository.js";

function parseOptionalDate(iso: string | undefined): Date | undefined {
  if (!iso?.trim()) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export async function adminRoutingRoutes(app: FastifyInstance) {
  /** Master lead sources with active routing rules (for dry-run filters). */
  app.get("/routing/dry-run-master-clients", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const items = await listDistinctRoutingMasterClientIds();
    return reply.send({ ok: true, items });
  });

  /** Recent dry-run routing decisions for C.O.C. review. */
  app.get("/routing/dry-run-decisions", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = routingDryRunListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const {
      masterClientAccountId,
      limit,
      matched,
      validationStatus,
      destinationClientAccountId,
      reviewQueue,
      createdAfter,
      createdBefore,
    } = parsed.data;
    const rows = await listRecentRoutingDryRunDecisions({
      masterClientAccountId,
      limit,
      matched,
      validationStatus: reviewQueue ? undefined : validationStatus,
      destinationClientAccountId,
      reviewQueue,
      createdAfter: parseOptionalDate(createdAfter),
      createdBefore: parseOptionalDate(createdBefore),
    });
    try {
      const items = await presentRoutingDryRunDecisions(rows);
      return reply.send({
        ok: true,
        masterClientAccountId: masterClientAccountId ?? null,
        count: items.length,
        items,
      });
    } catch (err) {
      request.log.error({ err, masterClientAccountId }, "present_routing_dry_run_decisions_failed");
      return reply.status(500).send({
        ok: false,
        error: "Failed to present routing dry-run decisions",
      });
    }
  });

  /** Global routing dry-run / validation stats for operator dashboards. */
  app.get("/routing/dry-run-stats", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = routingDryRunStatsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const stats = await getRoutingDryRunStats({
      masterClientAccountId: parsed.data.masterClientAccountId,
      destinationClientAccountId: parsed.data.destinationClientAccountId,
      createdAfter: parseOptionalDate(parsed.data.createdAfter),
      createdBefore: parseOptionalDate(parsed.data.createdBefore),
    });
    return reply.send({ ok: true, stats });
  });

  /** On-demand dry-run for a lifecycle payload (no delivery). */
  app.post("/routing/dry-run", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = routingDryRunBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    const result = await runRoutingDryRun(parsed.data.payload, {}, {
      debug: parsed.data.debug === true,
    });
    return reply.send({ ok: true, result });
  });

  /** Operator validation / legacy delivery comparison for a dry-run decision. */
  app.patch("/routing/dry-run-decisions/:id/validation", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const parsed = routingDryRunValidationPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    try {
      const result = await updateRoutingDryRunValidation(id, parsed.data);
      if ("notFound" in result) {
        return reply.status(404).send({ ok: false, error: "Decision not found" });
      }
      return reply.send({ ok: true, item: result.item });
    } catch (err) {
      request.log.error({ err, decisionId: id }, "update_routing_dry_run_validation_failed");
      return reply.status(500).send({
        ok: false,
        error: "Failed to update routing dry-run validation",
      });
    }
  });

  /** Internal SA360 correlation review — does not merge GHL contacts. */
  app.patch("/routing/dry-run-decisions/:id/duplicate-risk-review", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const parsed = duplicateRiskReviewPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    const existing = await findDuplicateRiskByRoutingDecisionId(id);
    if (!existing) {
      return reply.status(404).send({ ok: false, error: "Duplicate risk assessment not found" });
    }
    const item = await patchDuplicateRiskOperatorReview(existing.id, parsed.data);
    if (!item) {
      return reply.status(404).send({ ok: false, error: "Duplicate risk assessment not found" });
    }
    return reply.send({ ok: true, duplicateRisk: item });
  });

  app.get("/routing/dry-run-decisions/:id/duplicate-risk", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const item = await getDuplicateRiskForRoutingDecision(id);
    if (!item) {
      return reply.status(404).send({ ok: false, error: "Duplicate risk assessment not found" });
    }
    return reply.send({ ok: true, duplicateRisk: item });
  });
}
