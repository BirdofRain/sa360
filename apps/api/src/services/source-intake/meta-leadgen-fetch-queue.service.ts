import { Queue } from "bullmq";
import { META_LEADGEN_FETCH_JOB, META_LEADGEN_FETCH_QUEUE } from "@sa360/shared";
import { redis } from "../../lib/redis.js";

/**
 * BullMQ 5.x (installed 5.71) does **not** throw a JobIdAlreadyExists class when
 * Queue.add reuses a custom jobId. Lua `handleDuplicatedJob` returns the existing
 * id and emits `duplicated`. Older BullMQ 3/4 threw
 * `Job with id <id> already exists`.
 *
 * Do not treat generic `/JobId/` message matches as duplicates — that can swallow
 * real errors such as `JobId cannot be '0' or start with 0:`.
 */
export function isDuplicateMetaLeadgenJobIdError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as { name?: string; message?: string };
  if (typeof rec.name === "string" && /JobIdAlreadyExists/i.test(rec.name)) {
    return true;
  }
  const message = typeof rec.message === "string" ? rec.message : "";
  return /job with (this )?id .+ already exists/i.test(message);
}

const RETAINED_DUPLICATE_JOB_STATES = new Set([
  "waiting",
  "delayed",
  "prioritized",
  "active",
  "paused",
  "waiting-children",
  "failed",
]);

/**
 * Deterministic BullMQ job identity for one Meta leadgen_id.
 *
 * Format: `meta-leadgen-fetch-<sanitizedLeadgenId>`
 * Colon is forbidden in BullMQ custom job IDs, so the conceptual
 * `meta-leadgen-fetch:<leadgen_id>` form is stored with a hyphen.
 *
 * Semantics (jobId is unique in the queue while the job row exists):
 * - waiting / delayed / active / failed: getJob finds the row → skip enqueue.
 *   Installed BullMQ 5.71 also no-ops a second Queue.add (no throw).
 * - completed + removeOnComplete:true: id is freed. A later Meta retry may enqueue
 *   a new job; the worker exits as idempotent success if the SourceLeadEvent is
 *   already normalized/routed (no second Graph on the successful path).
 * - failed + removeOnFail:false: id remains. Duplicate Meta POSTs do not create a
 *   second job. Operator (or BullMQ attempts) retries the same job. Worker retry
 *   after a genuine retryable Graph failure may call Graph again.
 * - retried (attempts remaining): same job, same id, backoff per defaultJobOptions.
 *
 * Two callback URLs + Meta retries + concurrent POSTs therefore cannot create
 * independent Graph-processing jobs for the same leadgen_id while a job exists.
 */
export function buildMetaLeadgenFetchJobId(leadgenId: string): string {
  const trimmed = leadgenId.trim();
  if (!trimmed) {
    throw new Error("leadgen_id_required");
  }
  const sanitized = trimmed.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180);
  if (!sanitized) {
    throw new Error("leadgen_id_invalid");
  }
  return `meta-leadgen-fetch-${sanitized}`;
}

export type MetaLeadgenFetchJobData = {
  leadgenId: string;
  sourceLeadEventId: string;
  fixture?: boolean;
};

export type EnqueueMetaLeadgenFetchResult = {
  enqueued: boolean;
  jobId: string;
  skipped?: boolean;
};

let metaLeadgenFetchQueue: Queue<MetaLeadgenFetchJobData> | null = null;
let metaLeadgenFetchQueueOpened = false;

function getMetaLeadgenFetchQueue(): Queue<MetaLeadgenFetchJobData> {
  if (!metaLeadgenFetchQueue) {
    metaLeadgenFetchQueue = new Queue(META_LEADGEN_FETCH_QUEUE, {
      connection: redis,
    });
    metaLeadgenFetchQueueOpened = true;
  }
  return metaLeadgenFetchQueue;
}

export function wasMetaLeadgenFetchQueueOpened(): boolean {
  return metaLeadgenFetchQueueOpened;
}

export async function enqueueMetaLeadgenFetch(
  data: MetaLeadgenFetchJobData
): Promise<EnqueueMetaLeadgenFetchResult> {
  const jobId = buildMetaLeadgenFetchJobId(data.leadgenId);
  const queue = getMetaLeadgenFetchQueue();
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (RETAINED_DUPLICATE_JOB_STATES.has(state)) {
      return { enqueued: false, jobId, skipped: true };
    }
  }
  try {
    await queue.add(META_LEADGEN_FETCH_JOB, data, {
      jobId,
      attempts: 5,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
    return { enqueued: true, jobId };
  } catch (err) {
    if (isDuplicateMetaLeadgenJobIdError(err)) {
      return { enqueued: false, jobId, skipped: true };
    }
    throw err;
  }
}

export async function closeMetaLeadgenFetchQueue(): Promise<void> {
  if (!metaLeadgenFetchQueue) return;
  await metaLeadgenFetchQueue.close();
  metaLeadgenFetchQueue = null;
  metaLeadgenFetchQueueOpened = false;
}
