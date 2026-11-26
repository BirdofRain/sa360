/**
 * Infrastructure health for delivery.
 *
 * Queue reads use BullMQ `Queue` handles created with `skipMetasUpdate` and
 * only call count, list, and set-cardinality reads. A handle never adds a job,
 * pauses, cleans, drains, or removes anything. Every Redis wait has a deadline,
 * because the shared ioredis client queues commands without bound when Valkey
 * is unreachable.
 */

import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import {
  COMPANY_SHEETS_DISPATCH_QUEUE,
  DELIVERY_HEALTH_MONITOR_QUEUE,
  EXTERNAL_WEBHOOK_DELIVERY_QUEUE,
  GHL_ASSOCIATION_DISPATCH_QUEUE,
  BULK_IMPORT_DELIVERY_QUEUE,
} from "@sa360/shared";

import { getBuildVersionPayload } from "../../lib/build-version.js";
import { isOngoingGhlServiceEnabled } from "../../lib/ghl-ongoing-delivery-scope.js";
import { readDeliveryHealthConfig } from "../delivery-health/config.js";
import { sanitizeCode } from "./sanitize.js";
import { withDeadline, type DiagnosticsDb } from "./read-only.js";

export const REDIS_READ_DEADLINE_MS = 2_500;
const WAITING_SCAN = 1;

export type DiagnosticQueueName =
  | typeof COMPANY_SHEETS_DISPATCH_QUEUE
  | typeof GHL_ASSOCIATION_DISPATCH_QUEUE
  | typeof DELIVERY_HEALTH_MONITOR_QUEUE
  | typeof BULK_IMPORT_DELIVERY_QUEUE
  | typeof EXTERNAL_WEBHOOK_DELIVERY_QUEUE;

/** Queues whose repeat job is the worker's own clock when its flag is on. */
export const SCHEDULED_DRAIN_QUEUES: ReadonlyArray<{
  queue: DiagnosticQueueName;
  flag: "sheets" | "ghl" | "monitor";
}> = [
  { queue: COMPANY_SHEETS_DISPATCH_QUEUE, flag: "sheets" },
  { queue: GHL_ASSOCIATION_DISPATCH_QUEUE, flag: "ghl" },
  { queue: DELIVERY_HEALTH_MONITOR_QUEUE, flag: "monitor" },
];

export const DIAGNOSTIC_QUEUES: readonly DiagnosticQueueName[] = [
  COMPANY_SHEETS_DISPATCH_QUEUE,
  GHL_ASSOCIATION_DISPATCH_QUEUE,
  DELIVERY_HEALTH_MONITOR_QUEUE,
  BULK_IMPORT_DELIVERY_QUEUE,
  EXTERNAL_WEBHOOK_DELIVERY_QUEUE,
];

export type QueueSnapshot = {
  queue: string;
  available: boolean;
  error: string | null;
  waiting: number;
  active: number;
  delayed: number;
  prioritized: number;
  paused: number;
  failed: number;
  /** Jobs BullMQ has flagged as possibly stalled. It is not a lock-expiry scan. */
  stalledCandidates: number;
  repeatableJobs: number;
  oldestWaitingAt: string | null;
  lastCompletedAt: string | null;
  connectedWorkers: number | null;
};

export type QueueReader = (queue: DiagnosticQueueName) => Promise<QueueSnapshot>;

function emptySnapshot(queue: string, error: string): QueueSnapshot {
  return {
    queue,
    available: false,
    error,
    waiting: 0,
    active: 0,
    delayed: 0,
    prioritized: 0,
    paused: 0,
    failed: 0,
    stalledCandidates: 0,
    repeatableJobs: 0,
    oldestWaitingAt: null,
    lastCompletedAt: null,
    connectedWorkers: null,
  };
}

export function bullQueueReader(connection: Redis, deadlineMs = REDIS_READ_DEADLINE_MS): QueueReader {
  return async (name) => {
    const queue = new Queue(name, { connection, skipMetasUpdate: true, skipVersionCheck: true });
    try {
      return await withDeadline(readQueue(queue, name), deadlineMs, "queue_read");
    } catch (err) {
      const reason = err instanceof Error ? err.message : "queue_read_failed";
      return emptySnapshot(name, sanitizeCode(reason) ?? "queue_read_failed");
    } finally {
      await queue.close().catch(() => undefined);
    }
  };
}

async function readQueue(queue: Queue, name: string): Promise<QueueSnapshot> {
  const counts = await queue.getJobCounts("wait", "active", "delayed", "prioritized", "paused", "failed");
  const client = await queue.client;
  const [stalled, repeatables, oldest, recentCompleted, workers] = await Promise.all([
    client.scard(queue.toKey("stalled")),
    queue.getRepeatableJobs(0, 49, true),
    queue.getJobs(["wait"], 0, WAITING_SCAN - 1, true),
    queue.getJobs(["completed"], 0, 0, false),
    queue.getWorkers().then(
      (list) => list.length,
      () => null
    ),
  ]);
  const oldestJob = oldest[0];
  const completedJob = recentCompleted[0];
  return {
    queue: name,
    available: true,
    error: null,
    waiting: counts.wait ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    prioritized: counts.prioritized ?? 0,
    paused: counts.paused ?? 0,
    failed: counts.failed ?? 0,
    stalledCandidates: stalled,
    repeatableJobs: repeatables.length,
    oldestWaitingAt: oldestJob?.timestamp ? new Date(oldestJob.timestamp).toISOString() : null,
    lastCompletedAt: completedJob?.finishedOn ? new Date(completedJob.finishedOn).toISOString() : null,
    connectedWorkers: workers,
  };
}

export type WorkerHeartbeatStatus = "ok" | "stale" | "no_completion_observed" | "not_scheduled" | "unknown";

export type InfrastructureHealth = {
  api: { ok: true; build: Record<string, string | null>; uptimeSeconds: number };
  postgres: { ok: boolean; latencyMs: number | null; error: string | null };
  valkey: { ok: boolean; latencyMs: number | null; error: string | null };
  queues: Array<QueueSnapshot & { oldestWaitingAgeSeconds: number | null }>;
  worker: {
    status: WorkerHeartbeatStatus;
    staleAfterSeconds: number;
    basis: string;
    drains: Array<{
      queue: string;
      expectedByApiFlag: boolean;
      status: WorkerHeartbeatStatus;
      lastCompletedAt: string | null;
      lastCompletedAgeSeconds: number | null;
    }>;
  };
  monitor: {
    enabledByApiFlag: boolean;
    heartbeat: {
      lastSucceededAt: string | null;
      lastFailedAt: string | null;
      consecutiveFailures: number;
    } | null;
    openIncidentsByClass: Record<string, number>;
  };
  runtime: {
    ongoingGhlDeliveryEnabled: boolean;
    sheetsDispatchEnabled: boolean;
    adapterMode: string | null;
    adapterMaxMode: string | null;
    persistedRuntimeMode: { configuredRuntimeMode: string; liveCanaryEnabledUntil: string | null } | null;
  };
};

function exactTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

const MODE_VALUES = new Set(["disabled", "simulate", "readonly_probe", "live_blocked", "live_canary"]);

function enumValue(raw: string | undefined): string | null {
  const value = raw?.trim().toLowerCase();
  return value && MODE_VALUES.has(value) ? value : value ? "other" : null;
}

function age(from: string | null, now: Date): number | null {
  if (!from) return null;
  return Math.max(0, Math.round((now.getTime() - new Date(from).getTime()) / 1000));
}

export function deriveDrainStatus(input: {
  expected: boolean;
  queue: QueueSnapshot;
  now: Date;
  staleMs: number;
}): WorkerHeartbeatStatus {
  if (!input.expected) return "not_scheduled";
  if (!input.queue.available) return "unknown";
  if (!input.queue.lastCompletedAt) return "no_completion_observed";
  const lastAge = input.now.getTime() - new Date(input.queue.lastCompletedAt).getTime();
  return lastAge > input.staleMs ? "stale" : "ok";
}

export async function loadInfrastructureHealth(
  db: DiagnosticsDb,
  input: {
    now: Date;
    env: NodeJS.ProcessEnv;
    redis: Pick<Redis, "ping">;
    readQueue: QueueReader;
    startedAt?: number;
  }
): Promise<InfrastructureHealth> {
  const { now, env } = input;
  const config = readDeliveryHealthConfig(env);

  const pgStarted = Date.now();
  let postgres: InfrastructureHealth["postgres"];
  try {
    await db.$queryRaw`SELECT 1`;
    postgres = { ok: true, latencyMs: Date.now() - pgStarted, error: null };
  } catch {
    postgres = { ok: false, latencyMs: null, error: "postgres_unavailable" };
  }

  const redisStarted = Date.now();
  let valkey: InfrastructureHealth["valkey"];
  try {
    const pong = await withDeadline(input.redis.ping(), REDIS_READ_DEADLINE_MS, "valkey_ping");
    valkey = pong === "PONG" ? { ok: true, latencyMs: Date.now() - redisStarted, error: null } : { ok: false, latencyMs: null, error: "valkey_unexpected_reply" };
  } catch (err) {
    valkey = { ok: false, latencyMs: null, error: sanitizeCode(err instanceof Error ? err.message : null) ?? "valkey_unavailable" };
  }

  const queues: InfrastructureHealth["queues"] = [];
  if (valkey.ok) {
    for (const name of DIAGNOSTIC_QUEUES) {
      const snapshot = await input.readQueue(name);
      queues.push({ ...snapshot, oldestWaitingAgeSeconds: age(snapshot.oldestWaitingAt, now) });
    }
  }

  const expected = {
    sheets: exactTrue(env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED),
    ghl: isOngoingGhlServiceEnabled(env),
    monitor: config.monitorEnabled,
  };
  const drains = SCHEDULED_DRAIN_QUEUES.map((entry) => {
    const snapshot = queues.find((queue) => queue.queue === entry.queue);
    const status: WorkerHeartbeatStatus = snapshot
      ? deriveDrainStatus({ expected: expected[entry.flag], queue: snapshot, now, staleMs: config.staleMs })
      : expected[entry.flag]
        ? "unknown"
        : "not_scheduled";
    return {
      queue: entry.queue,
      expectedByApiFlag: expected[entry.flag],
      status,
      lastCompletedAt: snapshot?.lastCompletedAt ?? null,
      lastCompletedAgeSeconds: snapshot ? age(snapshot.lastCompletedAt, now) : null,
    };
  });
  const expectedDrains = drains.filter((drain) => drain.expectedByApiFlag);
  const workerStatus: WorkerHeartbeatStatus =
    expectedDrains.length === 0
      ? "not_scheduled"
      : expectedDrains.some((drain) => drain.status === "stale")
        ? "stale"
        : expectedDrains.some((drain) => drain.status === "unknown")
          ? "unknown"
          : expectedDrains.some((drain) => drain.status === "no_completion_observed")
            ? "no_completion_observed"
            : "ok";

  const [heartbeat, incidents, runtimeMode] = await Promise.all([
    db.deliveryHealthMonitorHeartbeat.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { lastSucceededAt: true, lastFailedAt: true, consecutiveFailures: true },
    }),
    db.deliveryHealthIncident.groupBy({
      by: ["failureClass"],
      where: { resolvedAt: null },
      _count: { _all: true },
    }),
    db.deliveryRuntimeModeSetting.findUnique({
      where: { id: "default" },
      select: { configuredRuntimeMode: true, liveCanaryEnabledUntil: true },
    }),
  ]);
  const openIncidentsByClass: Record<string, number> = {};
  for (const group of incidents) openIncidentsByClass[group.failureClass] = group._count._all;

  return {
    api: { ok: true, build: getBuildVersionPayload(), uptimeSeconds: Math.round(process.uptime()) },
    postgres,
    valkey,
    queues,
    worker: {
      status: workerStatus,
      staleAfterSeconds: Math.round(config.staleMs / 1000),
      basis:
        "Latest completed repeatable drain job in Valkey for each queue the API flags expect to be scheduled. The worker writes no heartbeat of its own. The API flags can differ from the worker environment.",
      drains,
    },
    monitor: {
      enabledByApiFlag: config.monitorEnabled,
      heartbeat: heartbeat
        ? {
            lastSucceededAt: heartbeat.lastSucceededAt?.toISOString() ?? null,
            lastFailedAt: heartbeat.lastFailedAt?.toISOString() ?? null,
            consecutiveFailures: heartbeat.consecutiveFailures,
          }
        : null,
      openIncidentsByClass,
    },
    runtime: {
      ongoingGhlDeliveryEnabled: expected.ghl,
      sheetsDispatchEnabled: expected.sheets,
      adapterMode: enumValue(env.GHL_DELIVERY_ADAPTER_MODE),
      adapterMaxMode: enumValue(env.GHL_DELIVERY_ADAPTER_MAX_MODE),
      persistedRuntimeMode: runtimeMode
        ? {
            configuredRuntimeMode: runtimeMode.configuredRuntimeMode,
            liveCanaryEnabledUntil: runtimeMode.liveCanaryEnabledUntil?.toISOString() ?? null,
          }
        : null,
    },
  };
}
