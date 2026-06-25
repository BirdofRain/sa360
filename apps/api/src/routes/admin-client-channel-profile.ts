import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { isClientProfileSettingsEnabled } from "../lib/client-channel-profile-env.js";
import {
  clientChannelProfileQuerySchema,
  clientChannelProfileSaveBodySchema,
} from "../schemas/client-channel-profile.schema.js";
import {
  getClientChannelProfile,
  saveClientChannelProfile,
} from "../services/client-channel-profile/client-channel-profile.service.js";
import { validateClientChannelProfileReadiness } from "../services/client-channel-profile/client-channel-profile-readiness.service.js";
import { previewClientChannelProfileImpact } from "../services/client-channel-profile/client-channel-profile-impact.service.js";
import { CLIENT_CHANNEL_APPLY_SCOPES } from "../services/client-channel-profile/client-channel-profile.constants.js";

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

/** Returns false (after sending 404) when the feature flag is disabled. */
function ensureEnabled(reply: FastifyReply): boolean {
  if (!isClientProfileSettingsEnabled()) {
    reply.status(404).send({
      ok: false,
      error: "Client channel profile settings are disabled.",
      code: "FEATURE_DISABLED",
    });
    return false;
  }
  return true;
}

function readSubaccount(query: unknown): string | undefined {
  const parsed = clientChannelProfileQuerySchema.safeParse(query ?? {});
  if (!parsed.success) return undefined;
  return parsed.data.subaccountIdGhl;
}

export async function adminClientChannelProfileRoutes(app: FastifyInstance) {
  app.get("/clients/:clientAccountId/channel-profile", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    if (!ensureEnabled(reply)) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const subaccountIdGhl = readSubaccount(request.query);

    const result = await getClientChannelProfile({ clientAccountId, subaccountIdGhl });
    if (!result.ok) {
      return reply.status(404).send({ ok: false, error: result.error, code: result.code });
    }
    return reply.send({ ok: true, data: result.data });
  });

  app.post("/clients/:clientAccountId/channel-profile", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    if (!ensureEnabled(reply)) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const parsed = clientChannelProfileSaveBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }

    const result = await saveClientChannelProfile({ clientAccountId, body: parsed.data });
    if (!result.ok) {
      const status = result.code === "CLIENT_NOT_FOUND" ? 404 : 400;
      return reply.status(status).send({
        ok: false,
        error: result.error,
        code: result.code,
        details: result.code === "VALIDATION" ? result.details : undefined,
      });
    }
    return reply.send({ ok: true, data: result.data });
  });

  app.get("/clients/:clientAccountId/channel-profile/readiness", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    if (!ensureEnabled(reply)) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const subaccountIdGhl = readSubaccount(request.query);
    const readiness = await validateClientChannelProfileReadiness({
      clientAccountId,
      subaccountIdGhl,
    });
    return reply.send({ ok: true, readiness });
  });

  app.get("/clients/:clientAccountId/channel-profile/impact-preview", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    if (!ensureEnabled(reply)) return;
    const { clientAccountId } = request.params as { clientAccountId: string };
    const subaccountIdGhl = readSubaccount(request.query);
    const rawScope = (request.query as { applyScope?: string } | undefined)?.applyScope;
    const applyScope =
      rawScope && (CLIENT_CHANNEL_APPLY_SCOPES as readonly string[]).includes(rawScope)
        ? (rawScope as (typeof CLIENT_CHANNEL_APPLY_SCOPES)[number])
        : null;
    const preview = await previewClientChannelProfileImpact({
      clientAccountId,
      subaccountIdGhl,
      applyScope,
    });
    return reply.send({ ok: true, preview });
  });
}
