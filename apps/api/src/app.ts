import Fastify from "fastify";
import cors from "@fastify/cors";
import { redactSensitiveWebhookUrl } from "./lib/meta-webhook.js";
import { webhookRoutes } from "./routes/webhook.js";
import { webhookLeadCaptureIoRoutes } from "./routes/webhook-leadcaptureio.js";
import { sourcesFacebookRoutes } from "./routes/sources-facebook.js";
import { sourcesLeadConduitFacebookRoutes } from "./routes/sources-leadconduit-facebook.js";
import { sourcesZapierFacebookRoutes } from "./routes/sources-zapier-facebook.js";
import { sourcesGoogleSheetRoutes } from "./routes/sources-google-sheet.js";
import { sourcesLeadCaptureNextGenRoutes } from "./routes/sources-leadcapture-nextgen.js";
import { healthRoutes } from "./routes/health.js";
import { voiceRoutes } from "./routes/voice.js";
import { debugLogtailRoutes } from "./routes/debug-logtail.js";
import { adminRoutes } from "./routes/admin.js";
import { adminKanbanRoutes } from "./routes/admin-kanban.js";
import { agentWorkspaceRoutes } from "./routes/agent-workspace.js";
import { automationDashboardRoutes } from "./routes/automation-dashboard.js";
import { actionDashboardRoutes } from "./routes/action-dashboard.js";
import { clientPortalRoutes } from "./routes/client-portal.js";
import { clientAccountProfileRoutes } from "./routes/client-account-profile.js";
import { adminRoutingRoutes } from "./routes/admin-routing.js";
import { adminDeliveryPlanRoutes } from "./routes/admin-delivery-plan.js";
import { adminDeliveryReadinessRoutes } from "./routes/admin-delivery-readiness.js";
import { adminClientsRoutes } from "./routes/admin-clients.js";
import { adminSourceFunnelRoutes } from "./routes/admin-source-funnels.js";
import { adminFacebookCaptureRoutes } from "./routes/admin-facebook-capture.js";
import { adminClientChannelProfileRoutes } from "./routes/admin-client-channel-profile.js";
import { adminGhlAdapterRoutes } from "./routes/admin-ghl-adapter.js";
import { adminGhlLiveDeliveryRoutes } from "./routes/admin-ghl-live-delivery.js";
import { adminGhlConfigRoutes } from "./routes/admin-ghl-config.js";
import { adminGhlOAuthRoutes, integrationsGhlRoutes } from "./routes/integrations-ghl.js";
import {
  clientGoogleIntegrationRoutes,
  integrationsGoogleRoutes,
} from "./routes/integrations-google.js";
import {
  adminCompanyGoogleSheetsRoutes,
  clientCompanySheetsReadRoutes,
  integrationsCompanyGoogleRoutes,
} from "./routes/company-google-sheets.js";
import {
  adminCompanySheetsDeliveryRoutes,
  clientCompanySheetsDeliveryRoutes,
} from "./routes/company-sheets-delivery.js";
import { adminLeadDeliveryDirectDemoRoutes } from "./routes/admin-lead-delivery-direct-demo.js";
import { adminLeadDeliveryRoutes } from "./routes/admin-lead-delivery.js";
import { adminLeadOrderRoutes } from "./routes/admin-lead-orders.js";
import { adminLeadInventoryRoutes } from "./routes/admin-lead-inventory.js";
import { adminConsumerAgeRoutes } from "./routes/admin-consumer-age.js";
import { adminFulfillmentShadowRoutes } from "./routes/admin-fulfillment-shadow.js";
import { adminMetaLeadgenRoutes } from "./routes/admin-meta-leadgen.js";
import { adminMetaReviewRoutes } from "./routes/admin-meta-review.js";
import { adminLeadCaptureTrustRoutes } from "./routes/admin-leadcapture-trust.js";
import { adminFulfillmentExecutionRoutes } from "./routes/admin-fulfillment-execution.js";
import { adminFulfillmentOpsRoutes } from "./routes/admin-fulfillment-ops.js";
import { adminProvenanceImpactRoutes } from "./routes/admin-provenance-impact.js";
import { adminHistoricalCampaignAssociationRoutes } from "./routes/admin-historical-campaign-association.js";
import { adminHistoricalCampaignCensusRoutes } from "./routes/admin-historical-campaign-census.js";
import { adminFrontOfficeRoutes } from "./routes/admin-front-office.js";
import { adminSourceLeadsRoutes } from "./routes/admin-source-leads.js";
import { adminLiveLeadPoolRoutes } from "./routes/admin-live-lead-pool.js";
import { adminBulkImportsRoutes } from "./routes/admin-bulk-imports.js";
import { adminDeliveryRuntimeModeRoutes } from "./routes/admin-delivery-runtime-mode.js";
import { adminRuntimeSettingsRoutes } from "./routes/admin-runtime-settings.js";
import { adminSupportTicketRoutes } from "./routes/admin-support-tickets.js";
import { adminClientOnboardingV2ReadRoutes } from "./routes/admin-client-onboarding-v2-read.js";
import { adminClientOnboardingV2GhlRoutes } from "./routes/admin-client-onboarding-v2-ghl.js";
import { adminClientOnboardingV2TestRoutes } from "./routes/admin-client-onboarding-v2-test.js";
import { adminClientOnboardingGoogleOnlyPreflightRoutes } from "./routes/admin-client-onboarding-google-only-preflight.js";
import { adminClientOnboardingV2ConfigRoutes } from "./routes/admin-client-onboarding-v2-config.js";
import { onboardingGhlRouteDeps } from "./services/client-onboarding-v2/onboarding-ghl-bindings.js";
import { createPrismaCapturedTestStore } from "./services/client-onboarding-v2/onboarding-test-store.js";
import { loadCapturedTestWorld } from "./services/client-onboarding-v2/onboarding-world.js";
import { capturedTestNoteBuilder } from "./services/client-onboarding-v2/onboarding-note-bridge.js";
import { createOnboardingCapturedTestSheetsAppend } from "./services/company-sheets-delivery/onboarding-captured-test-append.js";
import { createOnboardingGhlTestAdapter } from "./services/client-onboarding-v2/onboarding-ghl-test-adapter.js";
import { saveVerifiedTestIdentity } from "./services/client-onboarding-v2/onboarding-config.service.js";
import {
  createOnboardingTestWorksheetHeaderReader,
  rereadOnboardingCapturedTestSheet,
} from "./services/client-onboarding-v2/onboarding-test-worksheet-reader.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: redactSensitiveWebhookUrl(typeof req.url === "string" ? req.url : ""),
          };
        },
      },
    },
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
  await app.register(sourcesZapierFacebookRoutes);
  await app.register(sourcesGoogleSheetRoutes);
  await app.register(sourcesLeadCaptureNextGenRoutes);
  await app.register(healthRoutes);
  await app.register(voiceRoutes);
  await app.register(debugLogtailRoutes);
  await app.register(adminRoutes, { prefix: "/admin/v1" });
  await app.register(adminRoutingRoutes, { prefix: "/admin/v1" });
  await app.register(adminDeliveryPlanRoutes, { prefix: "/admin/v1" });
  await app.register(adminDeliveryReadinessRoutes, { prefix: "/admin/v1" });
  await app.register(adminClientsRoutes, { prefix: "/admin/v1" });
  await app.register(adminSourceFunnelRoutes, { prefix: "/admin/v1" });
  await app.register(adminFacebookCaptureRoutes, { prefix: "/admin/v1" });
  await app.register(adminClientChannelProfileRoutes, { prefix: "/admin/v1" });
  await app.register(adminGhlAdapterRoutes, { prefix: "/admin/v1" });
  await app.register(adminGhlLiveDeliveryRoutes, { prefix: "/admin/v1" });
  await app.register(adminLeadDeliveryDirectDemoRoutes, { prefix: "/admin/v1" });
  await app.register(adminLeadDeliveryRoutes, { prefix: "/admin/v1" });
  await app.register(adminLeadOrderRoutes, { prefix: "/admin/v1" });
  await app.register(adminLeadInventoryRoutes, { prefix: "/admin/v1" });
  await app.register(adminConsumerAgeRoutes, { prefix: "/admin/v1" });
  await app.register(adminFulfillmentShadowRoutes, { prefix: "/admin/v1" });
  await app.register(adminMetaLeadgenRoutes, { prefix: "/admin/v1" });
  await app.register(adminMetaReviewRoutes, { prefix: "/admin/v1" });
  await app.register(adminLeadCaptureTrustRoutes, { prefix: "/admin/v1" });
  await app.register(adminFulfillmentExecutionRoutes, { prefix: "/admin/v1" });
  await app.register(adminFulfillmentOpsRoutes, { prefix: "/admin/v1" });
  await app.register(adminProvenanceImpactRoutes, { prefix: "/admin/v1" });
  await app.register(adminHistoricalCampaignCensusRoutes, { prefix: "/admin/v1" });
  await app.register(adminHistoricalCampaignAssociationRoutes, { prefix: "/admin/v1" });
  await app.register(adminFrontOfficeRoutes, { prefix: "/admin/v1" });
  await app.register(adminSourceLeadsRoutes, { prefix: "/admin/v1" });
  await app.register(adminLiveLeadPoolRoutes, { prefix: "/admin/v1" });
  await app.register(adminBulkImportsRoutes, { prefix: "/admin/v1" });
  await app.register(adminDeliveryRuntimeModeRoutes, { prefix: "/admin/v1" });
  await app.register(adminRuntimeSettingsRoutes, { prefix: "/admin/v1" });
  await app.register(adminGhlOAuthRoutes, { prefix: "/admin/v1" });
  await app.register(adminGhlConfigRoutes, { prefix: "/admin/v1" });
  // Public GHL OAuth callback: GET /integrations/oauth/callback (alias: /integrations/ghl/oauth/callback)
  await app.register(integrationsGhlRoutes, { prefix: "/integrations" });
  await app.register(integrationsGoogleRoutes, { prefix: "/integrations" });
  await app.register(integrationsCompanyGoogleRoutes, { prefix: "/integrations" });
  await app.register(adminCompanyGoogleSheetsRoutes, { prefix: "/admin/v1" });
  await app.register(adminCompanySheetsDeliveryRoutes, { prefix: "/admin/v1" });
  await app.register(adminKanbanRoutes, { prefix: "/admin/v1" });
  await app.register(adminSupportTicketRoutes, { prefix: "/admin/v1" });
  await app.register(adminClientOnboardingV2ReadRoutes, { prefix: "/admin/v1" });
  await app.register(adminClientOnboardingV2GhlRoutes, {
    prefix: "/admin/v1",
    deps: onboardingGhlRouteDeps(),
  });
  await app.register(adminClientOnboardingV2ConfigRoutes, {
    prefix: "/admin/v1",
    readWorksheetHeader: createOnboardingTestWorksheetHeaderReader(),
  });
  await app.register(adminClientOnboardingGoogleOnlyPreflightRoutes, { prefix: "/admin/v1" });
  await app.register(adminClientOnboardingV2TestRoutes, {
    prefix: "/admin/v1",
    store: createPrismaCapturedTestStore(),
    notes: capturedTestNoteBuilder(),
    sheets: createOnboardingCapturedTestSheetsAppend(),
    // One GHL owner. The step port is intentionally unset so deliver() cannot
    // run once per upsert/note/workflow callback. The adapter still refuses
    // every non-loopback host, including services.leadconnectorhq.com.
    ghlAggregate: createOnboardingGhlTestAdapter(),
    execution: "injected_fakes",
    rereadSheet: (sheet) => rereadOnboardingCapturedTestSheet(sheet),
    loadWorld: (clientAccountId, sourceLeadEventId) => loadCapturedTestWorld(clientAccountId, sourceLeadEventId),
    saveTestIdentity: (input) => saveVerifiedTestIdentity(input),
  });
  await app.register(agentWorkspaceRoutes, { prefix: "/agent-workspace/v1" });
  await app.register(automationDashboardRoutes, {
    prefix: "/admin/v1/automation-dashboard",
  });
  await app.register(actionDashboardRoutes, {
    prefix: "/admin/v1/action-dashboard",
  });
  await app.register(clientPortalRoutes, { prefix: "/client/v1" });
  await app.register(clientAccountProfileRoutes, { prefix: "/client/v1" });
  await app.register(clientGoogleIntegrationRoutes, { prefix: "/client/v1" });
  await app.register(clientCompanySheetsReadRoutes, { prefix: "/client/v1" });
  await app.register(clientCompanySheetsDeliveryRoutes, { prefix: "/client/v1" });

  return app;
}