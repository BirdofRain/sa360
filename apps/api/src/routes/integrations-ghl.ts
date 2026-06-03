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
  getGhlMarketplaceWebhookDebugForAdmin,
  getGhlOAuthDebugForAdmin,
  linkGhlConnectionToClient,
  listGhlConnectionsPresented,
  probeGhlConnection,
  purgeGhlConnection,
  startGhlOAuthFlow,
} from "../services/ghl-oauth/ghl-connection.service.js";
import {
  listGhlOAuthPendingInstallsPresented,
  purgeGhlOAuthPendingInstall,
  revokeGhlOAuthPendingInstall,
} from "../services/ghl-oauth/ghl-oauth-pending-install.service.js";
import { GHL_MARKETPLACE_WEBHOOK_URL } from "../lib/ghl-oauth-env.js";
import { assertNoTokenFieldsInPayload } from "../services/ghl-oauth/ghl-connection.present.js";
import { getAdminCocBaseUrl } from "../lib/ghl-oauth-env.js";
import {
  buildGhlOAuthReconciliationSummary,
  deriveGhlOAuthPageBanner,
  getGhlOAuthInstallConfigDebugForAdmin,
  presentGhlLocationConnectionForAdmin,
} from "../services/ghl-oauth/ghl-oauth-admin.present.js";
import {
  handleGhlOAuthCallback,
  type GhlOAuthCallbackDeps,
} from "../services/ghl-oauth/ghl-connection.service.js";

export type GhlOAuthCallbackQuery = {
  code?: string;
  state?: string;
  error?: string;
};

export type GhlOAuthCallbackRouteResult =
  | { kind: "redirect"; redirectUrl: string }
  | { kind: "json"; statusCode: number; body: Record<string, unknown> };

export async function processGhlOAuthCallbackRoute(
  query: GhlOAuthCallbackQuery,
  requestId: string,
  callbackDeps?: GhlOAuthCallbackDeps
): Promise<GhlOAuthCallbackRouteResult> {
  const cocBase = getAdminCocBaseUrl();

  if (query.error?.trim()) {
    const path = `/ghl-connections?ghl_oauth=error&reason=${encodeURIComponent(query.error.trim())}`;
    if (!cocBase) {
      return {
        kind: "json",
        statusCode: 400,
        body: { ok: false, error: "ADMIN_COC_BASE_URL is not configured.", reason: query.error.trim() },
      };
    }
    return { kind: "redirect", redirectUrl: `${cocBase}${path}` };
  }

  const result = await handleGhlOAuthCallback(
    {
      code: query.code ?? "",
      state: query.state ?? "",
      requestId,
    },
    callbackDeps
  );

  const redirectPath = result.redirectUrl;
  if (redirectPath.startsWith("http://") || redirectPath.startsWith("https://")) {
    return { kind: "redirect", redirectUrl: redirectPath };
  }
  if (cocBase) {
    return {
      kind: "redirect",
      redirectUrl: `${cocBase}${redirectPath.startsWith("/") ? redirectPath : `/${redirectPath}`}`,
    };
  }
  return {
    kind: "json",
    statusCode: 400,
    body: {
      ok: false,
      error: "ADMIN_COC_BASE_URL is not configured for OAuth redirect.",
      redirectPath,
    },
  };
}

async function handleOAuthCallbackRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const q = request.query as GhlOAuthCallbackQuery;
  const requestId =
    (typeof request.headers["x-request-id"] === "string" && request.headers["x-request-id"]) ||
    randomUUID();
  const outcome = await processGhlOAuthCallbackRoute(q, requestId);
  if (outcome.kind === "redirect") {
    return reply.redirect(outcome.redirectUrl);
  }
  return reply.status(outcome.statusCode).send(outcome.body);
}

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
    const latestInstallWebhook = getGhlMarketplaceWebhookDebugForAdmin();
    const connections = await listGhlConnectionsPresented({});
    const activePending = await listGhlOAuthPendingInstallsPresented({ status: "pending_location" });
    const reconciliation = buildGhlOAuthReconciliationSummary({
      latestCallback: latest,
      latestWebhook: latestInstallWebhook,
      connections,
    });
    const payload = {
      ok: true as const,
      latest,
      latestInstallWebhook,
      marketplaceWebhookUrl: GHL_MARKETPLACE_WEBHOOK_URL,
      config: getGhlOAuthInstallConfigDebugForAdmin(),
      reconciliation,
      suggestedBanner: deriveGhlOAuthPageBanner({
        urlOauth: null,
        urlReason: null,
        connections,
        activePending,
        latestCallback: latest,
        latestWebhook: latestInstallWebhook,
      }),
    };
    if (latest) assertNoTokenFieldsInPayload(latest as unknown as Record<string, unknown>);
    if (latestInstallWebhook) {
      assertNoTokenFieldsInPayload(latestInstallWebhook as unknown as Record<string, unknown>);
    }
    assertNoTokenFieldsInPayload(payload.config as unknown as Record<string, unknown>);
    if (payload.suggestedBanner) {
      assertNoTokenFieldsInPayload(payload.suggestedBanner as unknown as Record<string, unknown>);
    }
    return reply.send(payload);
  });

  app.get("/ghl/oauth/pending-installs", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const active = await listGhlOAuthPendingInstallsPresented({ status: "pending_location" });
    const reconciledHistory = await listGhlOAuthPendingInstallsPresented({
      status: "reconciled",
      limit: 20,
    });
    return reply.send({
      ok: true,
      count: active.length,
      items: active,
      active,
      reconciledHistory,
    });
  });

  app.delete("/ghl/oauth/pending-installs/:id", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const { id } = request.params as { id: string };
    const parsed = (request.query as { purge?: string }).purge;
    const result =
      parsed === "true"
        ? await purgeGhlOAuthPendingInstall(id)
        : await revokeGhlOAuthPendingInstall(id);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Pending install not found" });
    }
    if ("purged" in result) {
      return reply.send({ ok: true, purged: true });
    }
    return reply.send({ ok: true, pending: result.pending });
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
      config: started.config,
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
    const items = (await listGhlConnectionsPresented(parsed.data)).map(
      presentGhlLocationConnectionForAdmin
    );
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
    const purge = (request.query as { purge?: string }).purge === "true";
    if (purge) {
      const result = await purgeGhlConnection(id);
      if ("notFound" in result) {
        return reply.status(404).send({ ok: false, error: "Connection not found" });
      }
      return reply.send({ ok: true, purged: true, locationId: result.locationId });
    }
    const result = await disconnectGhlConnection(id);
    if ("notFound" in result) {
      return reply.status(404).send({ ok: false, error: "Connection not found" });
    }
    return reply.send({ ok: true, connection: result.connection });
  });
}

/** Public integration routes (OAuth callback + marketplace webhooks). */
export async function integrationsGhlRoutes(app: FastifyInstance) {
  app.get("/oauth/callback", handleOAuthCallbackRequest);
  /** Legacy/cached GHL callback path — forwards to primary handler. */
  app.get("/ghl/oauth/callback", handleOAuthCallbackRequest);

  app.post("/ghl/webhooks", async (request, reply) => {
    const { handleGhlMarketplaceWebhook } = await import(
      "../services/ghl-oauth/ghl-connection.service.js"
    );
    const result = await handleGhlMarketplaceWebhook(request.body);
    return reply.status(200).send({ ok: true, ...result });
  });
}
