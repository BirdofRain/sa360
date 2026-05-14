import Fastify from "fastify";
import cors from "@fastify/cors";
import { webhookRoutes } from "./routes/webhook.js";
import { healthRoutes } from "./routes/health.js";
import { voiceRoutes } from "./routes/voice.js";
import { debugLogtailRoutes } from "./routes/debug-logtail.js";
import { adminRoutes } from "./routes/admin.js";
import { adminKanbanRoutes } from "./routes/admin-kanban.js";
import { agentWorkspaceRoutes } from "./routes/agent-workspace.js";

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
  await app.register(adminKanbanRoutes, { prefix: "/admin/v1" });
  await app.register(agentWorkspaceRoutes, { prefix: "/agent-workspace/v1" });

  return app;
}