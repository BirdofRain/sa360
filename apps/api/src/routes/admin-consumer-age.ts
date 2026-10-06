import type { FastifyPluginAsync } from "fastify";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  getConsumerAgeBirthdaySweepBatchSize,
  getConsumerAgeBirthdaySweepExpectedDbHost,
  getConsumerAgeBirthdaySweepIntervalMinutes,
  getConsumerAgeBirthdaySweepMaxScanRows,
  isConsumerAgeBirthdaySweepEnabled,
} from "../lib/consumer-age-birthday-sweep-env.js";
import {
  runConsumerAgeBirthdaySweep,
  type ConsumerAgeBirthdaySweepResult,
} from "../services/consumer-age/consumer-age-birthday-sweep.service.js";

/**
 * A refused or failed sweep must fail the worker's HTTP call so BullMQ records
 * it. A disabled sweep is a successful no-op — the schedule may exist while the
 * flag is off.
 */
export function httpStatusForBirthdaySweep(result: ConsumerAgeBirthdaySweepResult): 200 | 500 {
  return result.ok ? 200 : 500;
}

export const adminConsumerAgeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/consumer-age/birthday-sweep/diagnostics", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    return reply.send({
      ok: true,
      flags: {
        enabled: isConsumerAgeBirthdaySweepEnabled(),
        intervalMinutes: getConsumerAgeBirthdaySweepIntervalMinutes(),
        batchSize: getConsumerAgeBirthdaySweepBatchSize(),
        maxScanRows: getConsumerAgeBirthdaySweepMaxScanRows(),
        expectedDbHostConfigured: getConsumerAgeBirthdaySweepExpectedDbHost() !== "",
      },
    });
  });

  /**
   * Internal worker entrypoint for one bounded sweep batch, protected by the
   * admin API key (same pattern as the facets snapshot rebuild). All policy
   * lives in the service so the worker holds no business rules.
   */
  app.post("/consumer-age/internal/birthday-sweep", async (request, reply) => {
    if (!(await verifyAdminApiKey(request, reply))) return;
    const body = (request.body ?? {}) as {
      cursor?: { afterGeneratedAt?: string; afterId?: string } | null;
      jobId?: string;
      requestedBy?: string;
    };
    const afterGeneratedAt = body.cursor?.afterGeneratedAt?.trim();
    const afterId = body.cursor?.afterId?.trim();
    if (Boolean(afterGeneratedAt) !== Boolean(afterId)) {
      return reply
        .status(400)
        .send({ ok: false, error: "invalid_cursor", reason: "requires_after_generated_at_and_after_id" });
    }

    const result = await runConsumerAgeBirthdaySweep({
      cursor: afterGeneratedAt && afterId ? { afterGeneratedAt, afterId } : null,
    });
    return reply.status(httpStatusForBirthdaySweep(result)).send({
      ...result,
      jobId: body.jobId ?? null,
      requestedBy: body.requestedBy ?? null,
    });
  });
};
