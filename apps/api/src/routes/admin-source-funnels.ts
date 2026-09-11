import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { logger } from "../lib/logger.js";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { findClientAccountById } from "../repositories/client-account.repository.js";
import {
  findSourceFunnelById,
  findSourceFunnelByParentUrlKey,
  listObservedDiscoverableSourceFunnels,
  listSourceFunnelsForClient,
} from "../repositories/source-funnel.repository.js";
import {
  associateSourceFunnelBodySchema,
  confirmSourceFunnelBodySchema,
  observedSourceFunnelsQuerySchema,
  reassignSourceFunnelBodySchema,
  sourceFunnelIdParamSchema,
} from "../schemas/source-funnel-admin.schema.js";
import { normalizeLeadCapturePageUrlOrSlug } from "../services/source-intake/leadcapture-parent-url.js";
import {
  presentSourceFunnelAdmin,
  presentSourceFunnelOriginConflict,
  sortSourceFunnelsForClientList,
} from "../services/source-intake/source-funnel-admin.present.js";
import {
  associateSourceFunnelByPageUrl,
  clearSourceFunnelAssociation,
  confirmSourceFunnelOrigin,
  isSourceFunnelOriginCorrectionError,
  reassignSourceFunnelOrigin,
  SOURCE_FUNNEL_LEADCAPTURE_PROVIDER,
  type SourceFunnelOriginCorrectionError,
} from "../services/source-intake/source-funnel.service.js";

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

function operatorSafeCorrectionMessage(err: SourceFunnelOriginCorrectionError): string {
  switch (err.code) {
    case "invalid_page_url_or_slug":
      return "That value could not be recognized as a valid LeadCapture source.";
    case "origin_client_account_id_required":
      return "A destination client is required.";
    case "source_funnel_not_found":
      return "LeadCapture source not found.";
    case "origin_client_account_not_found":
      return "Client not found.";
    case "confirm_requires_explicit_reassign":
      return "This source is already associated with another client.";
    case "reassign_requires_confirmed_origin":
      return "This source is not confirmed to an origin client, so it cannot be reassigned.";
    case "reassign_requires_different_client":
      return "This source is already associated with this client.";
    default:
      return "Unable to complete source association.";
  }
}

function correctionStatus(code: SourceFunnelOriginCorrectionError["code"]): number {
  if (code === "source_funnel_not_found" || code === "origin_client_account_not_found") return 404;
  if (code === "confirm_requires_explicit_reassign") return 409;
  if (code === "reassign_requires_confirmed_origin" || code === "reassign_requires_different_client") {
    return 409;
  }
  return 400;
}

async function originDisplayName(clientAccountId: string | null | undefined): Promise<string | null> {
  const id = clientAccountId?.trim();
  if (!id) return null;
  const client = await findClientAccountById(id);
  return client?.clientDisplayName ?? null;
}

async function conflictReply(
  reply: FastifyReply,
  err: SourceFunnelOriginCorrectionError,
  sourceFunnelId?: string | null
) {
  const requested = err.requestedOriginClientAccountId ?? "";
  const current = err.currentOriginClientAccountId ?? null;
  const funnel = sourceFunnelId ? await findSourceFunnelById(sourceFunnelId) : null;
  if (funnel && current && requested) {
    return reply.status(409).send(
      presentSourceFunnelOriginConflict({
        sourceFunnel: funnel,
        currentOriginClientAccountId: current,
        currentOriginClientDisplayName: await originDisplayName(current),
        requestedOriginClientAccountId: requested,
      })
    );
  }
  return reply.status(409).send({
    ok: false,
    error: operatorSafeCorrectionMessage(err),
    code: err.code,
    sourceFunnelId: sourceFunnelId ?? null,
    currentOriginClientAccountId: current,
    currentOriginClientDisplayName: await originDisplayName(current),
    requestedOriginClientAccountId: requested || null,
  });
}

async function sendCorrectionError(
  reply: FastifyReply,
  err: SourceFunnelOriginCorrectionError,
  extras?: { sourceFunnelId?: string }
) {
  if (err.code === "confirm_requires_explicit_reassign") {
    return conflictReply(reply, err, extras?.sourceFunnelId);
  }
  return reply.status(correctionStatus(err.code)).send({
    ok: false,
    error: operatorSafeCorrectionMessage(err),
    code: err.code,
  });
}

export async function adminSourceFunnelRoutes(app: FastifyInstance) {
  app.get("/clients/:clientAccountId/source-funnels", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const client = await findClientAccountById(clientAccountId);
    if (!client) {
      return reply.status(404).send({ ok: false, error: "Client not found" });
    }
    const rows = sortSourceFunnelsForClientList(await listSourceFunnelsForClient(client.clientAccountId));
    return reply.send({
      ok: true,
      count: rows.length,
      items: rows.map(presentSourceFunnelAdmin),
    });
  });

  app.post("/clients/:clientAccountId/source-funnels", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const parsed = associateSourceFunnelBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const empty = !String((request.body as { pageUrlOrSlug?: unknown } | null)?.pageUrlOrSlug ?? "").trim();
      return reply.status(400).send({
        ok: false,
        error: empty
          ? "Enter a LeadCapture page URL or slug."
          : "That value could not be recognized as a valid LeadCapture source.",
        code: "invalid_page_url_or_slug",
      });
    }
    const client = await findClientAccountById(clientAccountId);
    if (!client) {
      return reply.status(404).send({ ok: false, error: "Client not found" });
    }
    try {
      const result = await associateSourceFunnelByPageUrl({
        originClientAccountId: client.clientAccountId,
        pageUrlOrSlug: parsed.data.pageUrlOrSlug,
      });
      return reply.status(result.created ? 201 : 200).send({
        ok: true,
        created: result.created,
        parentUrlKey: result.parentUrlKey,
        pageSlug: result.pageSlug,
        backfilledInventoryCount: result.backfilledInventoryCount,
        item: presentSourceFunnelAdmin(result.sourceFunnel),
      });
    } catch (err) {
      if (isSourceFunnelOriginCorrectionError(err)) {
        if (err.code === "confirm_requires_explicit_reassign") {
          const normalized = normalizeLeadCapturePageUrlOrSlug(parsed.data.pageUrlOrSlug);
          const funnel = normalized
            ? await findSourceFunnelByParentUrlKey({
                provider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER,
                parentUrlKey: normalized.parentUrlKey,
              })
            : null;
          if (funnel) {
            return conflictReply(reply, err, funnel.id);
          }
        }
        return sendCorrectionError(reply, err);
      }
      logger.warn("admin.source_funnel.associate_failed", {
        clientAccountId: client.clientAccountId,
        error: err instanceof Error ? err.message : "associate_failed",
      });
      return reply.status(500).send({ ok: false, error: "Unable to complete source association." });
    }
  });

  app.get("/source-funnels/observed", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = observedSourceFunnelsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const rows = await listObservedDiscoverableSourceFunnels({ limit: parsed.data.limit });
    return reply.send({
      ok: true,
      count: rows.length,
      items: rows.map(presentSourceFunnelAdmin),
    });
  });

  app.post("/source-funnels/:sourceFunnelId/confirm", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = sourceFunnelIdParamSchema.safeParse(request.params);
    const parsed = confirmSourceFunnelBodySchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.status(400).send({ ok: false, error: "Invalid request" });
    }
    const client = await findClientAccountById(parsed.data.originClientAccountId);
    if (!client) {
      return reply.status(404).send({ ok: false, error: "Client not found" });
    }
    try {
      const result = await confirmSourceFunnelOrigin({
        sourceFunnelId: params.data.sourceFunnelId,
        originClientAccountId: client.clientAccountId,
      });
      return reply.send({
        ok: true,
        backfilledInventoryCount: result.backfilledInventoryCount,
        item: presentSourceFunnelAdmin(result.sourceFunnel),
      });
    } catch (err) {
      if (isSourceFunnelOriginCorrectionError(err)) {
        return sendCorrectionError(reply, err, { sourceFunnelId: params.data.sourceFunnelId });
      }
      logger.warn("admin.source_funnel.confirm_failed", {
        sourceFunnelId: params.data.sourceFunnelId,
        error: err instanceof Error ? err.message : "confirm_failed",
      });
      return reply.status(500).send({ ok: false, error: "Unable to confirm source association." });
    }
  });

  app.post("/source-funnels/:sourceFunnelId/reassign", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = sourceFunnelIdParamSchema.safeParse(request.params);
    const parsed = reassignSourceFunnelBodySchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.status(400).send({ ok: false, error: "Invalid request" });
    }
    const client = await findClientAccountById(parsed.data.originClientAccountId);
    if (!client) {
      return reply.status(404).send({ ok: false, error: "Client not found" });
    }
    try {
      const result = await reassignSourceFunnelOrigin({
        sourceFunnelId: params.data.sourceFunnelId,
        originClientAccountId: client.clientAccountId,
      });
      return reply.send({
        ok: true,
        newlyStamped: result.newlyStamped,
        reassigned: result.reassigned,
        conflictsSkipped: result.conflictsSkipped,
        item: presentSourceFunnelAdmin(result.sourceFunnel),
      });
    } catch (err) {
      if (isSourceFunnelOriginCorrectionError(err)) {
        return sendCorrectionError(reply, err, { sourceFunnelId: params.data.sourceFunnelId });
      }
      logger.warn("admin.source_funnel.reassign_failed", {
        sourceFunnelId: params.data.sourceFunnelId,
        error: err instanceof Error ? err.message : "reassign_failed",
      });
      return reply.status(500).send({ ok: false, error: "Unable to reassign source." });
    }
  });

  app.delete("/source-funnels/:sourceFunnelId/association", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const params = sourceFunnelIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ ok: false, error: "Invalid request" });
    }
    try {
      const result = await clearSourceFunnelAssociation(params.data.sourceFunnelId);
      return reply.send({
        ok: true,
        clearedInventoryCount: result.clearedInventoryCount,
        item: presentSourceFunnelAdmin(result.sourceFunnel),
      });
    } catch (err) {
      if (isSourceFunnelOriginCorrectionError(err)) {
        return sendCorrectionError(reply, err, { sourceFunnelId: params.data.sourceFunnelId });
      }
      logger.warn("admin.source_funnel.clear_failed", {
        sourceFunnelId: params.data.sourceFunnelId,
        error: err instanceof Error ? err.message : "clear_failed",
      });
      return reply.status(500).send({ ok: false, error: "Unable to remove source association." });
    }
  });
}
