import Fastify from "fastify";
import cors from "@fastify/cors";
import { webhookRoutes } from "./routes/webhook.js";
import { webhookLeadCaptureIoRoutes } from "./routes/webhook-leadcaptureio.js";
import { sourcesFacebookRoutes } from "./routes/sources-facebook.js";
import { sourcesLeadConduitFacebookRoutes } from "./routes/sources-leadconduit-facebook.js";
import { sourcesGoogleSheetRoutes } from "./routes/sources-google-sheet.js";
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
import { adminClientChannelProfileRoutes } from "./routes/admin-client-channel-profile.js";
import { adminGhlAdapterRoutes } from "./routes/admin-ghl-adapter.js";
import { adminGhlLiveDeliveryRoutes } from "./routes/admin-ghl-live-delivery.js";
import { adminGhlConfigRoutes } from "./routes/admin-ghl-config.js";
import { adminGhlOAuthRoutes, integrationsGhlRoutes } from "./routes/integrations-ghl.js";
import { adminLeadDeliveryDirectDemoRoutes } from "./routes/admin-lead-delivery-direct-demo.js";
import { adminLeadDeliveryRoutes } from "./routes/admin-lead-delivery.js";
import { adminLeadOrderRoutes } from "./routes/admin-lead-orders.js";
import { adminLeadInventoryRoutes } from "./routes/admin-lead-inventory.js";
import { adminFulfillmentShadowRoutes } from "./routes/admin-fulfillment-shadow.js";
import { adminLeadCaptureTrustRoutes } from "./routes/admin-leadcapture-trust.js";
import { adminFulfillmentExecutionRoutes } from "./routes/admin-fulfillment-execution.js";
import { adminFrontOfficeRoutes } from "./routes/admin-front-office.js";
import { adminSourceLeadsRoutes } from "./routes/admin-source-leads.js";
import { adminBulkImportsRoutes } from "./routes/admin-bulk-imports.js";
import { adminDeliveryRuntimeModeRoutes } from "./routes/admin-delivery-runtime-mode.js";
import { adminRuntimeSettingsRoutes } from "./routes/admin-runtime-settings.js";
import { adminSupportTicketRoutes } from "./routes/admin-support-tickets.js";

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
  await app.register(webhookLeadCaptureIoRoutes);
  await app.register(sourcesFacebookRoutes);
  await app.register(sourcesLeadConduitFacebookRoutes);
  await app.register(sourcesGoogleSheetRoutes);
  await app.register(healthRoutes);
  await app.register(voiceRoutes);
  await app.register(debugLogtailRoutes);
  await app.register(adminRoutes, { prefix: "/admin/v1" });
  await app.register(adminRoutingRoutes, { prefix: "/admin/v1" });
  await app.register(adminDeliveryPlanRoutes, { prefix: "/admin/v1" });
  await app.register(adminDeliveryReadinessRoutes, { prefix: "/admin/v1" });
  await app.register(adminClientsRoutes, { prefix: "/admin/v1" });
  await app.register(adminClientChannelProfileRoutes, { prefix: "/admin/v1" });
  await app.register(adminGhlAdapterRoutes, { prefix: "/admin/v1" });
  await app.register(adminGhlLiveDeliveryRoutes, { prefix: "/admin/v1" });
  await app.register(adminLeadDeliveryDirectDemoRoutes, { prefix: "/admin/v1" });
  await app.register(adminLeadDeliveryRoutes, { prefix: "/admin/v1" });
  await app.register(adminLeadOrderRoutes, { prefix: "/admin/v1" });
  await app.register(adminLeadInventoryRoutes, { prefix: "/admin/v1" });
  await app.register(adminFulfillmentShadowRoutes, { prefix: "/admin/v1" });
  await app.register(adminLeadCaptureTrustRoutes, { prefix: "/admin/v1" });
  await app.register(adminFulfillmentExecutionRoutes, { prefix: "/admin/v1" });
  await app.register(adminFrontOfficeRoutes, { prefix: "/admin/v1" });
  await app.register(adminSourceLeadsRoutes, { prefix: "/admin/v1" });
  await app.register(adminBulkImportsRoutes, { prefix: "/admin/v1" });
  await app.register(adminDeliveryRuntimeModeRoutes, { prefix: "/admin/v1" });
  await app.register(adminRuntimeSettingsRoutes, { prefix: "/admin/v1" });
  await app.register(adminGhlOAuthRoutes, { prefix: "/admin/v1" });
  await app.register(adminGhlConfigRoutes, { prefix: "/admin/v1" });
  // Public GHL OAuth callback: GET /integrations/oauth/callback (alias: /integrations/ghl/oauth/callback)
  await app.register(integrationsGhlRoutes, { prefix: "/integrations" });
  await app.register(adminKanbanRoutes, { prefix: "/admin/v1" });
  await app.register(adminSupportTicketRoutes, { prefix: "/admin/v1" });
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