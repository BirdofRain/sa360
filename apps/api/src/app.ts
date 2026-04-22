import Fastify from "fastify";
import { webhookRoutes } from "./routes/webhook.js";
import { healthRoutes } from "./routes/health.js";
import { voiceRoutes } from "./routes/voice.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(webhookRoutes);
  await app.register(healthRoutes);
  await app.register(voiceRoutes);

  return app;
}