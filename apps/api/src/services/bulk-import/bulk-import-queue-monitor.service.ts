import type { Job } from "bullmq";
import { BULK_IMPORT_DELIVERY_QUEUE } from "@sa360/shared";
import { redis } from "../../lib/redis.js";
import { bulkImportDeliveryQueue } from "./bulk-import-queue.service.js";
import {
  findBulkLeadImportById,
  listBulkLeadImportRows,
} from "../../repositories/bulk-lead-import.repository.js";
import { asWizardStepJson } from "./bulk-import-wizard-metadata.service.js";

export type BulkImportQueueJobState =
  | "waiting"
  | "delayed"
  | "active"
  | "completed"
  | "failed"
  | "missing";

export type BulkImportQueueJobSnapshot = {
  jobId: string;
  chunkIndex: number;
  rowCount: number;
  state: BulkImportQueueJobState;
  attemptsMade?: number;
  failedReason?: string | null;
  processedOn?: string | null;
  finishedOn?: string | null;
  delayUntil?: string | null;
};

export type BulkImportDeliveryMonitor = {
  batchId: string;
  batchStatus: string;
  approvedRowCount: number;
  approvedRowIds: string[];
  queueJobs: BulkImportQueueJobSnapshot[];
  rowsDelivering: number;
  rowsDelivered: number;
  rowsFailed: number;
  rowsWaiting: number;
  lastActivityAt: string | null;
  lastWorkerError: string | null;
  workerConfigured: boolean;
  queueReachable: boolean;
  queueStale: boolean;
  destinationClientAccountId: string | null;
  destinationLocationIdGhl: string | null;
  workflowStrategy: string | null;
};

const QUEUE_STALE_MS = 60_000;

function safeApiHostname(): string | null {
  const url = process.env.SA360_API_INTERNAL_URL?.trim();
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function getBulkImportWorkerDiagnostics(): {
  apiInternalHostnameConfigured: boolean;
  apiInternalHostname: string | null;
  adminKeyPresent: boolean;
  redisConnected: boolean;
  bulkImportQueueWorkerActive: boolean;
  configuredConcurrency: number;
} {
  return {
    apiInternalHostnameConfigured: Boolean(safeApiHostname()),
    apiInternalHostname: safeApiHostname(),
    adminKeyPresent: Boolean(process.env.ADMIN_API_KEY?.trim()),
    redisConnected: redis.status === "ready",
    bulkImportQueueWorkerActive: true,
    configuredConcurrency: Number(process.env.BULK_IMPORT_DELIVERY_CONCURRENCY || 2),
  };
}

async function snapshotJob(job: Job | undefined, fallback: {
  jobId: string;
  chunkIndex: number;
  rowCount: number;
}): Promise<BulkImportQueueJobSnapshot> {
  if (!job) {
    return {
      jobId: fallback.jobId,
      chunkIndex: fallback.chunkIndex,
      rowCount: fallback.rowCount,
      state: "missing",
    };
  }

  let state = (await job.getState()) as string;
  if (state === "unknown" || !state) state = "missing";
  const queueState = state as BulkImportQueueJobState;

  return {
    jobId: String(job.id),
    chunkIndex: fallback.chunkIndex,
    rowCount: fallback.rowCount,
    state: queueState,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason ?? null,
    processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    delayUntil: job.delay ? new Date(Date.now() + job.delay).toISOString() : null,
  };
}

export async function getBulkImportDeliveryMonitor(
  batchId: string
): Promise<BulkImportDeliveryMonitor | null> {
  const batch = await findBulkLeadImportById(batchId);
  if (!batch) return null;

  const wizard = asWizardStepJson(batch.wizardStepJson);
  const deliveryMonitor = (wizard.deliveryMonitor ?? {}) as {
    queueJobs?: Array<{ jobId: string; chunkIndex: number; rowCount: number }>;
    approvedRowIds?: string[];
    approvedAt?: string;
    lastActivityAt?: string;
    lastWorkerError?: string | null;
  };

  const approvedRowIds = deliveryMonitor.approvedRowIds ?? [];
  const storedJobs = deliveryMonitor.queueJobs ?? [];
  const queueJobs: BulkImportQueueJobSnapshot[] = [];

  for (const stored of storedJobs) {
    const job = await bulkImportDeliveryQueue.getJob(stored.jobId);
    queueJobs.push(
      await snapshotJob(job, {
        jobId: stored.jobId,
        chunkIndex: stored.chunkIndex,
        rowCount: stored.rowCount,
      })
    );
  }

  const rows = await listBulkLeadImportRows(batchId);
  const waveRows =
    approvedRowIds.length > 0
      ? rows.filter((r) => approvedRowIds.includes(r.id))
      : rows.filter((r) => r.deliveryStatus !== "pending" || r.deliveryAttempts > 0);

  const rowsDelivering = waveRows.filter((r) => r.deliveryStatus === "delivering").length;
  const rowsDelivered = waveRows.filter((r) => r.deliveryStatus === "delivered").length;
  const rowsFailed = waveRows.filter(
    (r) => r.deliveryStatus === "failed" && (r.deliveryAttempts ?? 0) > 0
  ).length;
  const rowsWaiting = waveRows.filter((r) => r.deliveryStatus === "simulated").length;

  const importOptions = (batch.importOptionsJson ?? {}) as { workflowStrategy?: string };
  let queueReachable = false;
  try {
    queueReachable = (await redis.ping()) === "PONG";
  } catch {
    queueReachable = false;
  }

  const approvedAtMs = deliveryMonitor.approvedAt
    ? Date.parse(deliveryMonitor.approvedAt)
    : batch.approvedAt
      ? batch.approvedAt.getTime()
      : null;
  const hasWaitingJob = queueJobs.some((j) => j.state === "waiting" || j.state === "delayed");
  const queueStale =
    hasWaitingJob &&
    approvedAtMs !== null &&
    Date.now() - approvedAtMs > QUEUE_STALE_MS &&
    rowsDelivering === 0 &&
    rowsDelivered === 0;

  return {
    batchId,
    batchStatus: batch.status,
    approvedRowCount: approvedRowIds.length || Number(wizard.approvedRowCount ?? 0),
    approvedRowIds,
    queueJobs,
    rowsDelivering,
    rowsDelivered,
    rowsFailed,
    rowsWaiting,
    lastActivityAt: deliveryMonitor.lastActivityAt ?? batch.updatedAt.toISOString(),
    lastWorkerError: deliveryMonitor.lastWorkerError ?? null,
    workerConfigured:
      Boolean(safeApiHostname()) && Boolean(process.env.ADMIN_API_KEY?.trim()),
    queueReachable,
    queueStale,
    destinationClientAccountId: batch.destinationClientAccountId,
    destinationLocationIdGhl: batch.destinationLocationIdGhl,
    workflowStrategy: importOptions.workflowStrategy ?? null,
  };
}

export function formatQueueJobIds(jobs: Job[]): Array<{
  jobId: string;
  chunkIndex: number;
  rowCount: number;
  state: BulkImportQueueJobState;
}> {
  return jobs.map((job) => ({
    jobId: String(job.id),
    chunkIndex: (job.data as { chunkIndex?: number }).chunkIndex ?? 0,
    rowCount: (job.data as { rowIds?: string[] }).rowIds?.length ?? 0,
    state: "waiting",
  }));
}
