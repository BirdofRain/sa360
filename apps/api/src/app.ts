import Fastify from "fastify";
import cors from "@fastify/cors";
import { webhookRoutes } from "./routes/webhook.js";
import { healthRoutes } from "./routes/health.js";
import { voiceRoutes } from "./routes/voice.js";
import { debugLogtailRoutes } from "./routes/debug-logtail.js";
import { adminRoutes } from "./routes/admin.js";
import { adminKanbanRoutes } from "./routes/admin-kanban.js";
import { agentWorkspaceRoutes } from "./routes/agent-workspace.js";
import { automationDashboardRoutes } from "./routes/automation-dashboard.js";
import { actionDashboardRoutes } from "./routes/action-dashboard.js";
import { clientPortalRoutes } from "./routes/client-portal.js";
import { adminRoutingRoutes } from "./routes/admin-routing.js";
import { adminDeliveryPlanRoutes } from "./routes/admin-delivery-plan.js";
import { adminDeliveryReadinessRoutes } from "./routes/admin-delivery-readiness.js";
import { adminClientsRoutes } from "./routes/admin-clients.js";
import { adminGhlAdapterRoutes } from "./routes/admin-ghl-adapter.js";
import { adminGhlLiveDeliveryRoutes } from "./routes/admin-ghl-live-delivery.js";
import { adminGhlConfigRoutes } from "./routes/admin-ghl-config.js";
import { adminGhlOAuthRoutes, integrationsGhlRoutes } from "./routes/integrations-ghl.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  const corsOriginsRaw = process.env.CORS_ALLOWED_ORIGINS?.trim();
  if (corsOriginsRaw) {
    const origins = corsOriginsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (origins.length > 0) {
      await app.register(cors, {
        origin: origins.length === 1 ? origins[0] : origins,
      });
    }
  }

  await app.register(webhookRoutes);
  await app.register(healthRoutes);
  await app.register(voiceRoutes);
  await app.register(debugLogtailRoutes);
  await app.register(adminRoutes, { prefix: "/admin/v1" });
  await app.register(adminRoutingRoutes, { prefix: "/admin/v1" });
  await app.register(adminDeliveryPlanRoutes, { prefix: "/admin/v1" });
  await app.register(adminDeliveryReadinessRoutes, { prefix: "/admin/v1" });
  await app.register(adminClientsRoutes, { prefix: "/admin/v1" });
  await app.register(adminGhlAdapterRoutes, { prefix: "/admin/v1" });
  await app.register(adminGhlLiveDeliveryRoutes, { prefix: "/admin/v1" });
  await app.register(adminGhlOAuthRoutes, { prefix: "/admin/v1" });
  await app.register(adminGhlConfigRoutes, { prefix: "/admin/v1" });
  // Public GHL OAuth callback: GET /integrations/oauth/callback (alias: /integrations/ghl/oauth/callback)
  await app.register(integrationsGhlRoutes, { prefix: "/integrations" });
  await app.register(adminKanbanRoutes, { prefix: "/admin/v1" });
  await app.register(agentWorkspaceRoutes, { prefix: "/agent-workspace/v1" });
  await app.register(automationDashboardRoutes, {
    prefix: "/admin/v1/automation-dashboard",
  });
  await app.register(actionDashboardRoutes, {
    prefix: "/admin/v1/action-dashboard",
  });
  await app.register(clientPortalRoutes, { prefix: "/client/v1" });

  return app;
}