import Fastify from "fastify";
import { webhookRoutes } from "./routes/webhook.js";
import { healthRoutes } from "./routes/health.js";
import { voiceRoutes } from "./routes/voice.js";
import { debugLogtailRoutes } from "./routes/debug-logtail.js";
import { adminRoutes } from "./routes/admin.js";
import { adminKanbanRoutes } from "./routes/admin-kanban.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(webhookRoutes);
  await app.register(healthRoutes);
  await app.register(voiceRoutes);
  await app.register(debugLogtailRoutes);
  await app.register(adminRoutes, { prefix: "/admin/v1" });
  await app.register(adminKanbanRoutes, { prefix: "/admin/v1" });

  return app;
}