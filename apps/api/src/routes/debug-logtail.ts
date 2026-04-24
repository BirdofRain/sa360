import type { FastifyInstance } from "fastify";
import { flushLogger, logger } from "../lib/logger.js";

export async function debugLogtailRoutes(app: FastifyInstance) {
  app.get("/debug/logtail-test", async (_request, reply) => {
    if (process.env.ENABLE_DEBUG_ROUTES !== "true") {
      return reply.status(404).send({ ok: false });
    }

    logger.info("logtail.test", {
      service: "sa360-api",
      env: process.env.SA360_ENV ?? process.env.NODE_ENV ?? "development",
      timestamp: new Date().toISOString(),
    });

    await flushLogger();
    return { ok: true };
  });
}
