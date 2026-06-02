import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  ghlConnectionLinkClientBodySchema,
  ghlConnectionsListQuerySchema,
  ghlOAuthStartQuerySchema,
} from "../schemas/ghl-oauth.schema.js";
import { randomUUID } from "node:crypto";
import {
  disconnectGhlConnection,
  getGhlConnectionByIdPresented,
  getGhlOAuthDebugForAdmin,
  linkGhlConnectionToClient,
  listGhlConnectionsPresented,
  probeGhlConnection,
  startGhlOAuthFlow,
} from "../services/ghl-oauth/ghl-connection.service.js";
import { assertNoTokenFieldsInPayload } from "../services/ghl-oauth/ghl-connection.present.js";
import { getAdminCocBaseUrl } from "../lib/ghl-oauth-env.js";

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

export async function adminGhlOAuthRoutes(app: FastifyInstance) {
  app.get("/ghl/oauth/debug", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const latest = getGhlOAuthDebugForAdmin();
    const payload = { ok: true as const, latest };
    if (latest) assertNoTokenFieldsInPayload(latest as unknown as Record<string, unknown>);
    return reply.send(payload);
  });

  app.get("/ghl/oauth/start", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = ghlOAuthStartQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const started = startGhlOAuthFlow({
      clientAccountId: parsed.data.clientAccountId,
      returnTo: parsed.data.returnTo,
    });
    if ("error" in started) {
      return reply.status(503).send({ ok: false, error: started.error });
    }
    if (parsed.data.redirect === "true") {
      return reply.redirect(started.authorizeUrl);
    }
    return reply.send({
      ok: true,
      authorizeUrl: started.authorizeUrl,
      state: started.state,
    });
  });

  app.get("/ghl/connections", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const parsed = ghlConnectionsListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
    }
    const items = await listGhlConnectionsPresented(parsed.data);
    return reply.send({ ok: true, count: items.length, items });
  });

  app.get("/ghl/connections/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const item = await getGhlConnectionByIdPresented(id);
    if (!item) {
      return reply.status(404).send({ ok: false, error: "Connection not found" });
    }
    return reply.send({ ok: true, item });
  });

  app.post("/ghl/connections/:id/probe", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const result = await probeGhlConnection(id);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Connection not found" });
    }
    return reply.status(result.ok ? 200 : 502).send({
      ok: result.ok,
      connection: result.connection,
      detail: result.detail,
    });
  });

  app.patch("/ghl/connections/:id/link-client", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const parsed = ghlConnectionLinkClientBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    const result = await linkGhlConnectionToClient(id, parsed.data.clientAccountId);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Connection not found" });
    }
    if ("error" in result) {
      return reply.status(400).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, connection: result.connection });
  });

  app.delete("/ghl/connections/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const result = await disconnectGhlConnection(id);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Connection not found" });
    }
    return reply.send({ ok: true, connection: result.connection });
  });
}

/** Public integration routes (OAuth callback + marketplace webhooks). */
export async function integrationsGhlRoutes(app: FastifyInstance) {
  app.get("/oauth/callback", async (request, reply) => {
    const q = request.query as { code?: string; state?: string; error?: string };
    const cocBase = getAdminCocBaseUrl();

    function redirectToCoc(path: string) {
      if (path.startsWith("http://") || path.startsWith("https://")) {
        return reply.redirect(path);
      }
      if (cocBase) {
        return reply.redirect(`${cocBase}${path.startsWith("/") ? path : `/${path}`}`);
      }
      return reply.status(502).send({
        ok: false,
        error: "OAuth callback succeeded but ADMIN_COC_BASE_URL is not configured for redirect.",
        redirectPath: path,
      });
    }

    if (q.error) {
      return redirectToCoc(`/ghl-connections?ghl_oauth=error&reason=${encodeURIComponent(q.error)}`);
    }

    const requestId =
      (typeof request.headers["x-request-id"] === "string" && request.headers["x-request-id"]) ||
      randomUUID();

    const { handleGhlOAuthCallback } = await import(
      "../services/ghl-oauth/ghl-connection.service.js"
    );
    const result = await handleGhlOAuthCallback({
      code: q.code ?? "",
      state: q.state ?? "",
      requestId,
    });
    return redirectToCoc(result.redirectUrl);
  });

  app.post("/ghl/webhooks", async (request, reply) => {
    const { handleGhlMarketplaceWebhook } = await import(
      "../services/ghl-oauth/ghl-connection.service.js"
    );
    const result = await handleGhlMarketplaceWebhook(request.body);
    return reply.status(200).send({ ok: true, ...result });
  });
}
