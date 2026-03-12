import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import { redis } from "../lib/redis.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return { ok: true, service: "api" };
  });

  app.get("/health/db", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, db: "connected" };
  });

  app.get("/health/queue", async () => {
    const pong = await redis.ping();
    return { ok: pong === "PONG", queue: pong };
  });
}