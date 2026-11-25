import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { redis } from "../lib/redis.js";
import { loadGhlRunDiagnostic } from "../services/delivery-diagnostics/ghl-run-diagnostic.js";
import { bullQueueReader, type QueueReader } from "../services/delivery-diagnostics/infra-health.js";
import {
  DIAGNOSTICS_MAX_CONCURRENT,
  DIAGNOSTICS_RATE_LIMIT,
  createConcurrencyGate,
  createFixedWindowRateLimiter,
  type ConcurrencyGate,
  type RateLimiter,
} from "../services/delivery-diagnostics/limits.js";
import { withReadOnlyDb } from "../services/delivery-diagnostics/read-only.js";
import { loadGhlRunList } from "../services/delivery-diagnostics/run-list.js";
import { loadDeliveryDiagnosticsSummary } from "../services/delivery-diagnostics/summary.js";
import {
  decodeRunCursor,
  diagnosticsRunListQuerySchema,
  diagnosticsRunParamsSchema,
  diagnosticsSummaryQuerySchema,
  resolveDiagnosticWindow,
} from "../services/delivery-diagnostics/window.js";

export type AdminDeliveryDiagnosticsRouteOptions = {
  db?: PrismaClient;
  redis?: Pick<Redis, "ping">;
  readQueue?: QueueReader;
  env?: NodeJS.ProcessEnv;
  limiter?: RateLimiter;
  gate?: ConcurrencyGate;
  now?: () => Date;
};

type AuditOutcome = "ok" | "not_found" | "bad_request" | "rate_limited" | "busy" | "error";

/**
 * Read-only delivery diagnostics for authorized SA360 administrators.
 *
 * Every route is GET. Each one runs inside a server-enforced read-only
 * transaction and returns counts, statuses, internal ids, and sanitized codes.
 * Lead fields, stored payload bodies, and credentials are never returned. No
 * route enqueues work, retries a run, or calls a provider.
 */
export async function adminDeliveryDiagnosticsRoutes(
  app: FastifyInstance,
  opts: AdminDeliveryDiagnosticsRouteOptions = {}
) {
  const db = opts.db ?? prisma;
  const redisClient = opts.redis ?? redis;
  const readQueue = opts.readQueue ?? bullQueueReader(redis);
  const env = opts.env ?? process.env;
  const limiter = opts.limiter ?? createFixedWindowRateLimiter(DIAGNOSTICS_RATE_LIMIT);
  const gate = opts.gate ?? createConcurrencyGate(DIAGNOSTICS_MAX_CONCURRENT);
  const now = opts.now ?? (() => new Date());

  function audit(
    request: FastifyRequest,
    route: string,
    outcome: AuditOutcome,
    startedAt: number,
    params: Record<string, unknown> = {}
  ) {
    logger.info("delivery_diagnostics.access", {
      route,
      outcome,
      method: request.method,
      requestId: request.id,
      ip: request.ip,
      durationMs: Date.now() - startedAt,
      ...params,
    });
  }

  async function guard(
    request: FastifyRequest,
    reply: FastifyReply,
    route: string,
    startedAt: number
  ): Promise<(() => void) | null> {
    if (!(await verifyAdminApiKey(request, reply))) {
      logger.warn("delivery_diagnostics.auth_denied", {
        route,
        status: reply.statusCode,
        requestId: request.id,
        ip: request.ip,
      });
      return null;
    }
    const taken = limiter.take(request.ip);
    if (!taken.allowed) {
      audit(request, route, "rate_limited", startedAt);
      await reply.code(429).header("retry-after", String(taken.retryAfterSeconds)).send({ ok: false, error: "rate_limited" });
      return null;
    }
    const release = gate.tryEnter();
    if (!release) {
      audit(request, route, "busy", startedAt);
      await reply.code(429).header("retry-after", "5").send({ ok: false, error: "diagnostics_busy" });
      return null;
    }
    reply.header("cache-control", "no-store");
    return release;
  }

  app.get("/delivery-diagnostics/summary", async (request, reply) => {
    const startedAt = Date.now();
    const route = "summary";
    const release = await guard(request, reply, route, startedAt);
    if (!release) return;
    try {
      const parsed = diagnosticsSummaryQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        audit(request, route, "bad_request", startedAt);
        return reply.code(400).send({ ok: false, error: "invalid_query" });
      }
      const summary = await loadDeliveryDiagnosticsSummary(
        { db, redis: redisClient, readQueue, env, now: now() },
        parsed.data
      );
      audit(request, route, "ok", startedAt, parsed.data);
      return reply.send({ ok: true, ...summary });
    } catch {
      audit(request, route, "error", startedAt);
      return reply.code(500).send({ ok: false, error: "diagnostics_failed" });
    } finally {
      release();
    }
  });

  app.get("/delivery-diagnostics/ghl-runs", async (request, reply) => {
    const startedAt = Date.now();
    const route = "ghl_runs";
    const release = await guard(request, reply, route, startedAt);
    if (!release) return;
    try {
      const parsed = diagnosticsRunListQuerySchema.safeParse(request.query ?? {});
      const cursor = parsed.success ? decodeRunCursor(parsed.data.cursor) : null;
      if (!parsed.success || cursor === "invalid") {
        audit(request, route, "bad_request", startedAt);
        return reply.code(400).send({ ok: false, error: "invalid_query" });
      }
      if (!parsed.data.status && !parsed.data.clientAccountId) {
        audit(request, route, "bad_request", startedAt);
        return reply.code(400).send({ ok: false, error: "status_or_client_required" });
      }
      const window = resolveDiagnosticWindow(parsed.data.window, now());
      const list = await withReadOnlyDb(db, (tx) =>
        loadGhlRunList(tx, {
          window,
          clientAccountId: parsed.data.clientAccountId ?? null,
          status: parsed.data.status ?? null,
          limit: parsed.data.limit,
          cursor,
        })
      );
      audit(request, route, "ok", startedAt, {
        window: parsed.data.window,
        clientAccountId: parsed.data.clientAccountId ?? null,
        status: parsed.data.status ?? null,
        returned: list.items.length,
      });
      return reply.send({ ok: true, readOnly: true, ...list });
    } catch {
      audit(request, route, "error", startedAt);
      return reply.code(500).send({ ok: false, error: "diagnostics_failed" });
    } finally {
      release();
    }
  });

  app.get("/delivery-diagnostics/ghl-runs/:runId", async (request, reply) => {
    const startedAt = Date.now();
    const route = "ghl_run_detail";
    const release = await guard(request, reply, route, startedAt);
    if (!release) return;
    try {
      const params = diagnosticsRunParamsSchema.safeParse(request.params);
      if (!params.success) {
        audit(request, route, "bad_request", startedAt);
        return reply.code(400).send({ ok: false, error: "invalid_run_id" });
      }
      const result = await withReadOnlyDb(db, (tx) => loadGhlRunDiagnostic(tx, params.data.runId));
      if (!result.found) {
        audit(request, route, "not_found", startedAt, { runId: params.data.runId });
        return reply.code(404).send({ ok: false, error: "run_not_found" });
      }
      audit(request, route, "ok", startedAt, { runId: params.data.runId });
      return reply.send({ ok: true, readOnly: true, ...result.diagnostic });
    } catch {
      audit(request, route, "error", startedAt);
      return reply.code(500).send({ ok: false, error: "diagnostics_failed" });
    } finally {
      release();
    }
  });
}
