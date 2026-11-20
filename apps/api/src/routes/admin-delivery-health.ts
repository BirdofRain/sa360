import type { FastifyInstance } from "fastify";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import { prisma } from "../lib/db.js";
import { readDeliveryHealthConfig } from "../services/delivery-health/config.js";
import {
  runDeliveryHealthMonitor,
  type DeliveryHealthRunResult,
  type DeliveryHealthScanDeps,
} from "../services/delivery-health/scan.js";

type RouteOpts = {
  env?: NodeJS.ProcessEnv;
  run?: (deps: DeliveryHealthScanDeps) => Promise<DeliveryHealthRunResult>;
};

/**
 * Internal scan for the delivery-health worker.
 * The monitor flag stays off unless it is the exact string true.
 * Notifications stay off unless their flag is the exact string true.
 * The response lists counts and failure classes. It does not list lead fields.
 */
export async function adminDeliveryHealthRoutes(app: FastifyInstance, opts: RouteOpts = {}) {
  const env = opts.env ?? process.env;
  const run = opts.run ?? runDeliveryHealthMonitor;

  app.post("/delivery-health/internal/scan", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    if (!readDeliveryHealthConfig(env).monitorEnabled) {
      return reply.send({
        ok: true,
        skipped: "flag_off",
        dryRun: true,
        queried: false,
        findings: 0,
        notified: 0,
        notificationSkipped: "notify_disabled",
        heartbeat: "skipped",
      });
    }
    try {
      const result = await run({ env, db: prisma });
      if (!result.ok) return reply.code(500).send({ ok: false, error: "scan_failed" });
      return reply.send({
        ok: true,
        dryRun: result.dryRun,
        queried: result.queried,
        pilotClients: result.pilotClients,
        pilotIdsRejected: result.pilotIdsRejected,
        findings: result.findings,
        opened: result.opened,
        updated: result.updated,
        resolved: result.resolved,
        suppressedResolved: result.suppressedResolved,
        notified: result.notified,
        notificationSkipped: result.notificationSkipped,
        failureClasses: result.failureClasses,
        truncated: result.truncated,
        heartbeat: result.heartbeat,
      });
    } catch {
      return reply.code(500).send({ ok: false, error: "scan_failed" });
    }
  });
}
